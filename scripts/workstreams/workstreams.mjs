import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const defaultRepoRoot = fileURLToPath(new URL('../../', import.meta.url));

function normalize(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function globMatches(pattern, filePath) {
  const source = normalize(pattern);
  let regex = '^';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '*' && source[index + 1] === '*') {
      regex += '.*';
      index += 1;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${regex}$`).test(normalize(filePath));
}

export function validateRegistry(registry, repoRoot) {
  const errors = [];
  if (registry?.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!Array.isArray(registry?.workstreams) || registry.workstreams.length === 0) {
    errors.push('workstreams must be a non-empty array.');
    return errors;
  }
  const ids = new Set();
  for (const stream of registry.workstreams) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stream.id || '')) errors.push(`Invalid workstream id: ${stream.id}`);
    if (ids.has(stream.id)) errors.push(`Duplicate workstream id: ${stream.id}`);
    ids.add(stream.id);
    if (!['active', 'paused', 'maintenance'].includes(stream.status)) errors.push(`Invalid status for ${stream.id}.`);
    if (!stream.name || !stream.owner || !stream.nextGate) errors.push(`Missing metadata for ${stream.id}.`);
    if (!Array.isArray(stream.include) || stream.include.length === 0) errors.push(`No include patterns for ${stream.id}.`);
    if (stream.status === 'active' && !stream.mission) errors.push(`Active workstream ${stream.id} has no mission.`);
    if (stream.mission && !fs.existsSync(path.join(repoRoot, normalize(stream.mission)))) {
      errors.push(`Mission does not exist for ${stream.id}: ${stream.mission}`);
    }
    for (const pattern of stream.include || []) {
      if (path.isAbsolute(pattern) || normalize(pattern).split('/').includes('..')) {
        errors.push(`Unsafe include pattern for ${stream.id}: ${pattern}`);
      }
    }
  }
  if (!Array.isArray(registry.sharedPaths)) errors.push('sharedPaths must be an array.');
  for (const shared of registry.sharedPaths || []) {
    if (!shared.pattern || !shared.reason) errors.push('A shared path is missing pattern or reason.');
    for (const id of shared.workstreams || []) {
      if (id !== '*' && !ids.has(id)) errors.push(`Unknown shared workstream: ${id}`);
    }
  }
  return errors;
}

export function classifyPaths(registry, paths) {
  const result = {
    streams: Object.fromEntries(registry.workstreams.map((stream) => [stream.id, []])),
    shared: [],
    overlaps: [],
    unassigned: [],
  };
  for (const filePath of [...new Set(paths.map(normalize))].sort()) {
    const shared = registry.sharedPaths.filter((entry) => globMatches(entry.pattern, filePath));
    if (shared.length > 0) {
      result.shared.push({ path: filePath, rules: shared });
      continue;
    }
    const owners = registry.workstreams.filter((stream) => stream.include.some((pattern) => globMatches(pattern, filePath)));
    if (owners.length === 0) result.unassigned.push(filePath);
    else if (owners.length > 1) result.overlaps.push({ path: filePath, owners: owners.map((owner) => owner.id) });
    else result.streams[owners[0].id].push(filePath);
  }
  return result;
}

export function getWorkstreamReport(repoRoot, paths) {
  const registryPath = path.join(repoRoot, 'Mission', 'WORKSTREAMS.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  return {
    registry,
    validationErrors: validateRegistry(registry, repoRoot),
    classified: classifyPaths(registry, paths),
  };
}

function changedPaths(repoRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'git status failed.');
  const records = result.stdout.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (/[RC]/.test(status) && records[index + 1]) index += 1;
  }
  return paths;
}

function printReport(registry, classified) {
  console.log('WORKSTREAMS');
  for (const stream of registry.workstreams) {
    const count = classified.streams[stream.id].length;
    console.log(`${stream.name.padEnd(28)} ${String(count).padStart(3)}  ${stream.status}`);
  }
  console.log(`${'Shared files'.padEnd(28)} ${String(classified.shared.length).padStart(3)}`);
  console.log(`${'Unassigned files'.padEnd(28)} ${String(classified.unassigned.length).padStart(3)}`);
  console.log(`${'Overlaps'.padEnd(28)} ${String(classified.overlaps.length).padStart(3)}`);
  for (const entry of classified.shared) console.log(`SHARED     ${entry.path}`);
  for (const entry of classified.unassigned) console.log(`UNASSIGNED ${entry}`);
  for (const entry of classified.overlaps) console.log(`OVERLAP    ${entry.path} -> ${entry.owners.join(', ')}`);
}

export function main(argv = process.argv.slice(2), repoRoot = defaultRepoRoot) {
  const { registry, validationErrors, classified } = getWorkstreamReport(repoRoot, changedPaths(repoRoot));
  if (argv.includes('--json')) console.log(JSON.stringify({ validationErrors, ...classified }, null, 2));
  else printReport(registry, classified);
  if (validationErrors.length > 0) {
    for (const error of validationErrors) console.error(`INVALID ${error}`);
    return 1;
  }
  if (argv.includes('--check') && (classified.unassigned.length > 0 || classified.overlaps.length > 0)) return 1;
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
