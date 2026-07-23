import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { parseTable, serializeTable } = require('../build-data/tsv.js');

const MAX_BUFFER = 128 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'guide',
  'dist',
  '.turbo',
  '.netlify',
  'analysis-cache',
  '__pycache__',
]);
const SELECTIVE_SUBTREES = ['data-vanilla3.2/data/data/global/excel'];
const D2R_TXT_ROOTS = [
  'data-TCP',
  'data-BKVince',
  'data-BK',
  'data-BT',
  'data-VNP',
  'excel-vanilla2.4',
  'data-vanilla3.2',
];
const CRLF_TXT_ROOTS = [
  'data-TCP',
  'data-BKVince',
  'data-BK',
  'data-BT',
  'excel-vanilla2.4',
];
const LFS_EXTENSIONS = new Set([
  '.sprite',
  '.texture',
  '.flac',
  '.ttf',
  '.otf',
  '.timelines',
  '.particles',
  '.model',
  '.skeleton',
  '.webm',
]);

export class VerificationError extends Error {
  constructor(title, details = []) {
    const lines = Array.isArray(details) ? details : [details];
    super([title, ...lines.map((line) => `  - ${line}`)].join('\n'));
    this.name = 'VerificationError';
    this.title = title;
    this.details = lines;
  }
}

export function normalizeRepoPath(value, repoRoot = null) {
  if (typeof value !== 'string') return '';
  let candidate = value.trim().replace(/^['"]|['"]$/g, '');
  if (!candidate) return '';
  candidate = candidate.replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(candidate) || candidate.startsWith('/')) {
    if (!repoRoot) return candidate;
    candidate = path.relative(repoRoot, candidate).replaceAll('\\', '/');
  }
  candidate = candidate.replace(/^\.\//, '').replace(/^(?:a|b)\//, '');
  const normalized = path.posix.normalize(candidate);
  return normalized === '.' ? '.' : normalized.replace(/^\/+/, '');
}

export function isWithin(candidate, root) {
  const value = normalizeRepoPath(candidate).toLowerCase();
  const scope = normalizeRepoPath(root).toLowerCase();
  return scope === '.' || value === scope || value.startsWith(`${scope}/`);
}

export function findRepoRoot(start = process.cwd()) {
  const result = runProcess('git', ['rev-parse', '--show-toplevel'], {
    cwd: start,
    allowFailure: true,
  });
  if (result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  throw new VerificationError('Git repository root not found.', [start]);
}

export function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding ?? 'utf8',
    input: options.input,
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? MAX_BUFFER,
    shell: false,
    timeout: options.timeout,
  });
  if (result.error) throw result.error;
  if (!options.allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new VerificationError(
      `Command failed (${result.status}): ${command} ${args.join(' ')}`,
      detail ? [detail] : [],
    );
  }
  return result;
}

export function npmInvocation(args) {
  const inheritedCli = process.env.npm_execpath;
  if (inheritedCli && fs.existsSync(inheritedCli)) {
    return { command: process.execPath, args: [inheritedCli, ...args] };
  }
  if (process.platform === 'win32') {
    const bundledCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(bundledCli)) return { command: process.execPath, args: [bundledCli, ...args] };
  }
  return { command: 'npm', args };
}

function runGit(repoRoot, args, options = {}) {
  return runProcess('git', args, { cwd: repoRoot, ...options });
}

function zeroSeparated(value) {
  return String(value || '').split('\0').filter(Boolean);
}

export function listChangedPaths(repoRoot) {
  const paths = new Set();
  const commands = [
    ['diff', '--no-renames', '--name-only', '-z', '--'],
    ['diff', '--cached', '--no-renames', '--name-only', '-z', '--'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ];
  for (const args of commands) {
    for (const item of zeroSeparated(runGit(repoRoot, args).stdout)) {
      paths.add(normalizeRepoPath(item, repoRoot));
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

export function loadCadastre(repoRoot) {
  const filePath = path.join(repoRoot, 'ai-cartographie.json');
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new VerificationError('The governed cadastre cannot be read.', [error.message]);
  }
  if (!document?.root) {
    throw new VerificationError('The governed cadastre has no root node.');
  }
  return document;
}

export function buildAccessRules(cadastre) {
  const rules = [];
  const stack = [{ node: cadastre.root, inherited: null }];
  while (stack.length) {
    const { node, inherited } = stack.pop();
    const declared = node.meta?.agentAccess;
    const access = declared || inherited;
    if (declared) {
      rules.push({ path: normalizeRepoPath(node.path), access: declared });
    }
    for (const child of node.children || []) {
      stack.push({ node: child, inherited: access });
    }
  }
  return rules.sort((left, right) => right.path.length - left.path.length);
}

export function accessForPath(candidate, accessRules) {
  const match = accessRules.find((rule) => isWithin(candidate, rule.path));
  return match?.access || null;
}

export function readOnlyRoots(accessRules) {
  return accessRules
    .filter((rule) => rule.access === 'read-only')
    .filter((rule) => !accessRules.some((parent) => (
      parent !== rule
      && parent.access === 'read-only'
      && parent.path.length < rule.path.length
      && isWithin(rule.path, parent.path)
    )))
    .map((rule) => rule.path)
    .sort();
}

export function verifyNoReadOnlyChanges(repoRoot) {
  const accessRules = buildAccessRules(loadCadastre(repoRoot));
  const changedPaths = listChangedPaths(repoRoot);
  const violations = changedPaths
    .filter((filePath) => accessForPath(filePath, accessRules) === 'read-only');
  if (violations.length) {
    throw new VerificationError('Read-only cadastre zones contain changes.', violations);
  }
  return { checked: changedPaths.length, violations: 0 };
}

function isD2rTxt(filePath) {
  const lower = normalizeRepoPath(filePath).toLowerCase();
  if (!lower.endsWith('.txt') || !D2R_TXT_ROOTS.some((root) => isWithin(lower, root))) return false;
  return isWithin(lower, 'excel-vanilla2.4')
    || lower.includes('/global/excel/');
}

function requiresCrlf(filePath) {
  return CRLF_TXT_ROOTS.some((root) => isWithin(filePath, root));
}

function validateTsvFile(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return;
  const bytes = fs.readFileSync(absolutePath);
  const problems = [];
  if (bytes.length === 0) problems.push('file is empty');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push('UTF-8 BOM is forbidden');
  }
  if (bytes.includes(0)) problems.push('NUL byte found');
  if (requiresCrlf(relativePath)) {
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0x0a && (index === 0 || bytes[index - 1] !== 0x0d)) {
        problems.push('bare LF found; D2R tables require CRLF');
        break;
      }
      if (bytes[index] === 0x0d && (index + 1 >= bytes.length || bytes[index + 1] !== 0x0a)) {
        problems.push('bare CR found; D2R tables require CRLF');
        break;
      }
    }
  }

  let table;
  try {
    table = parseTable(absolutePath);
    const serialized = Buffer.from(serializeTable(table), 'latin1');
    if (!bytes.equals(serialized)) problems.push('TSV parser round-trip is not byte-exact');
  } catch (error) {
    problems.push(`TSV parser failed: ${error.message}`);
  }
  if (table) {
    if (!table.headers.length || table.headers.every((header) => header === '')) {
      problems.push('header row is missing');
    }
    const expectedColumns = table.headers.length;
    const mismatches = [];
    table.rows.forEach((row, index) => {
      if (row.length !== expectedColumns && mismatches.length < 5) {
        mismatches.push(`line ${index + 2}: ${row.length} columns instead of ${expectedColumns}`);
      }
    });
    problems.push(...mismatches);
  }
  if (problems.length) {
    throw new VerificationError(`Invalid D2R TSV: ${relativePath}`, problems);
  }
}

export function verifyModifiedTsv(repoRoot) {
  const files = listChangedPaths(repoRoot).filter(isD2rTxt);
  const failures = [];
  for (const filePath of files) {
    try {
      validateTsvFile(repoRoot, filePath);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw new VerificationError('Modified D2R TSV validation failed.', failures);
  return { checked: files.length };
}

function selectivePathIncluded(relativePath) {
  for (const subtree of SELECTIVE_SUBTREES) {
    const scopeRoot = subtree.split('/')[0];
    if (!isWithin(relativePath, scopeRoot)) continue;
    return isWithin(relativePath, subtree) || isWithin(subtree, relativePath);
  }
  return true;
}

function excludedPath(relativePath) {
  return normalizeRepoPath(relativePath)
    .split('/')
    .some((segment) => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()));
}

function inventoryWorkspace(repoRoot) {
  const nodes = new Map([['.', 'directory']]);
  const repositoryFiles = zeroSeparated(runGit(repoRoot, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]).stdout);
  for (const candidate of repositoryFiles) {
    const relativePath = normalizeRepoPath(candidate, repoRoot);
    if (!relativePath || excludedPath(relativePath) || !selectivePathIncluded(relativePath)) continue;
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    const stat = fs.lstatSync(absolutePath);
    nodes.set(relativePath, stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file');
    let parent = path.posix.dirname(relativePath);
    while (parent && parent !== '.') {
      if (!excludedPath(parent) && selectivePathIncluded(parent)) nodes.set(parent, 'directory');
      parent = path.posix.dirname(parent);
    }
  }
  return nodes;
}

function inventoryCadastre(cadastre) {
  const nodes = new Map();
  const pending = [cadastre.root];
  while (pending.length) {
    const node = pending.pop();
    nodes.set(normalizeRepoPath(node.path), node.kind);
    pending.push(...(node.children || []));
  }
  return nodes;
}

export function verifyCartographyFresh(repoRoot) {
  const filesystem = inventoryWorkspace(repoRoot);
  const cadastre = inventoryCadastre(loadCadastre(repoRoot));
  const missing = [];
  const extra = [];
  const wrongKind = [];
  for (const [filePath, kind] of filesystem) {
    if (!cadastre.has(filePath)) missing.push(filePath);
    else if (cadastre.get(filePath) !== kind) wrongKind.push(`${filePath}: ${cadastre.get(filePath)} -> ${kind}`);
  }
  for (const filePath of cadastre.keys()) {
    if (!filesystem.has(filePath)) extra.push(filePath);
  }
  if (missing.length || extra.length || wrongKind.length) {
    const details = [
      ...missing.slice(0, 20).map((item) => `missing from cadastre: ${item}`),
      ...extra.slice(0, 20).map((item) => `absent from workspace: ${item}`),
      ...wrongKind.slice(0, 20).map((item) => `kind changed: ${item}`),
    ];
    const remaining = missing.length + extra.length + wrongKind.length - details.length;
    if (remaining > 0) details.push(`${remaining} additional structural difference(s)`);
    details.push('Run: powershell -File scripts/generate-architecture.ps1');
    throw new VerificationError('The cadastre is stale after structural changes.', details);
  }
  return { checked: filesystem.size };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readZipEntries(filePath) {
  const bytes = fs.readFileSync(filePath);
  const minimum = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('end-of-central-directory record not found');
  const totalEntries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error(`invalid central directory entry ${index + 1}`);
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) {
      throw new Error('ZIP64 archives are not supported by the repository verifier');
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = nameBytes.toString((flags & 0x0800) ? 'utf8' : 'latin1').replaceAll('\\', '/');
    if (flags & 0x0001) throw new Error(`encrypted entry is forbidden: ${name}`);
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`invalid local header: ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (method === 0) content = compressed;
    else if (method === 8) content = inflateRawSync(compressed);
    else throw new Error(`unsupported compression method ${method}: ${name}`);
    if (content.length !== uncompressedSize) throw new Error(`size mismatch: ${name}`);
    if (crc32(content) !== expectedCrc) throw new Error(`CRC mismatch: ${name}`);
    entries.push({ name, bytes: uncompressedSize });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function discoverZipFiles(repoRoot) {
  return zeroSeparated(runGit(repoRoot, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    '*.zip',
  ]).stdout).map(normalizeRepoPath).sort();
}

export function verifyZipContents(repoRoot) {
  const policyPath = path.join(repoRoot, 'scripts', 'verify', 'zip-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const discovered = discoverZipFiles(repoRoot);
  const expectedArchives = Object.keys(policy.archives || {}).sort();
  const failures = [];
  for (const filePath of discovered) {
    const definition = policy.archives[filePath];
    if (!definition) {
      failures.push(`${filePath}: archive is not declared in zip-policy.json`);
      continue;
    }
    try {
      const entries = readZipEntries(path.join(repoRoot, filePath));
      const names = entries.map((entry) => entry.name);
      const duplicateNames = names.filter((name, index) => (
        names.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) !== index
      ));
      if (duplicateNames.length) failures.push(`${filePath}: duplicate entries: ${duplicateNames.join(', ')}`);
      const unsafe = names.filter((name) => (
        name.startsWith('/')
        || /^[A-Za-z]:\//.test(name)
        || name.split('/').includes('..')
        || name.includes('\\')
      ));
      if (unsafe.length) failures.push(`${filePath}: unsafe paths: ${unsafe.join(', ')}`);
      const actual = [...names].sort((left, right) => left.localeCompare(right));
      const expected = [...definition.entries].sort((left, right) => left.localeCompare(right));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        failures.push(`${filePath}: expected [${expected.join(', ')}], found [${actual.join(', ')}]`);
      }
      if (definition.kind === 'plugin' && !definition.legacy) {
        const forbidden = names.filter((name) => !/\.(?:dll|json)$/i.test(name));
        if (forbidden.length) failures.push(`${filePath}: incubated plugin ZIP contains forbidden files: ${forbidden.join(', ')}`);
      }
    } catch (error) {
      failures.push(`${filePath}: ${error.message}`);
    }
  }
  for (const filePath of expectedArchives) {
    if (!discovered.includes(filePath)) failures.push(`${filePath}: policy entry has no versioned or pending archive`);
  }
  if (failures.length) throw new VerificationError('ZIP content validation failed.', failures);
  return { checked: discovered.length };
}

function isLfsCandidate(filePath) {
  const normalized = normalizeRepoPath(filePath);
  const inScope = isWithin(normalized, 'data-TCP/hd')
    || isWithin(normalized, 'data-BK/hd')
    || isWithin(normalized, 'data-BKVince');
  if (!inScope) return false;
  const lower = normalized.toLowerCase();
  if (LFS_EXTENSIONS.has(path.posix.extname(lower))) return true;
  if (/^data-tcp\/hd\/env\/preset\/act1\/court\/court[^/]*\.json$/i.test(normalized)) return true;
  return lower.endsWith('/texture_desc_cache.json');
}

export function verifyGitLfs(repoRoot) {
  const installed = runGit(repoRoot, ['lfs', 'version'], { allowFailure: true });
  if (installed.status !== 0) throw new VerificationError('Git LFS is not installed.');
  const tracked = new Set(zeroSeparated(runGit(repoRoot, ['ls-files', '-z']).stdout).map(normalizeRepoPath));
  const allFiles = new Set([
    ...tracked,
    ...zeroSeparated(runGit(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']).stdout).map(normalizeRepoPath),
  ]);
  const candidates = [...allFiles].filter(isLfsCandidate).sort();
  const input = candidates.length ? `${candidates.join('\0')}\0` : '';
  const attributes = runGit(repoRoot, ['check-attr', '-z', '--stdin', 'filter'], { input }).stdout;
  const fields = zeroSeparated(attributes);
  const missingAttributes = [];
  for (let index = 0; index < fields.length; index += 3) {
    if (fields[index + 2] !== 'lfs') missingAttributes.push(fields[index]);
  }
  const lfsTracked = new Set(
    runGit(repoRoot, ['lfs', 'ls-files', '--name-only']).stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(normalizeRepoPath),
  );
  const missingPointers = candidates.filter((filePath) => {
    if (!tracked.has(filePath) || lfsTracked.has(filePath)) return false;
    const blob = runGit(repoRoot, ['cat-file', '-s', `HEAD:${filePath}`], { allowFailure: true });
    return blob.status === 0 && Number.parseInt(blob.stdout.trim(), 10) > 0;
  });
  const fsck = runGit(repoRoot, ['lfs', 'fsck', '--pointers', 'HEAD'], { allowFailure: true, timeout: 120_000 });
  const failures = [
    ...missingAttributes.map((filePath) => `${filePath}: filter=lfs attribute is missing`),
    ...missingPointers.map((filePath) => `${filePath}: tracked Git blob is not managed by LFS`),
  ];
  if (fsck.status !== 0) failures.push(String(fsck.stderr || fsck.stdout).trim());
  if (failures.length) throw new VerificationError('Git LFS validation failed.', failures);
  return { checked: candidates.length, tracked: lfsTracked.size };
}

export function extractApplyPatchPaths(command) {
  if (typeof command !== 'string') return [];
  const paths = [];
  const pattern = /^\*\*\* (?:Add|Update|Delete|Move to) File:\s*(.+)$/gm;
  let match;
  while ((match = pattern.exec(command)) !== null) paths.push(normalizeRepoPath(match[1]));
  return paths;
}

export function isLikelyMutatingShell(command) {
  if (typeof command !== 'string') return false;
  return /\b(?:Set|Add|Clear|Remove|Move|Copy|Rename|New)-(?:Content|Item)\b/i.test(command)
    || /\b(?:Out-File|Tee-Object)\b/i.test(command)
    || /\[System\.IO\.(?:File|Directory)\]::(?:Write|Append|Delete|Move|Copy|Create)/i.test(command)
    || /(?:^|[\s;&|])(?:rm|del|erase|rmdir|mv|move|cp|copy|touch|mkdir|truncate)\b/i.test(command)
    || /\b(?:sed\s+-i|perl\s+-pi)\b/i.test(command)
    || /(?:^|[^<])>{1,2}(?![>&])/m.test(command)
    || /\b(?:generate|migrate|apply|install|format|write|delete|remove|rename|sync|publish)(?=[:\s-])/i.test(command);
}

function gitInvocations(command) {
  const invocations = [];
  const pattern = /(?:^|[;&|]\s*)git(?:\.exe)?(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))*\s+(commit|push|switch|checkout|branch)\b([^;&|]*)/gim;
  let match;
  while ((match = pattern.exec(command)) !== null) {
    invocations.push({ verb: match[1].toLowerCase(), rest: match[2].trim() });
  }
  return invocations;
}

function branchTarget(verb, rest) {
  const tokens = rest.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const cleaned = tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
  if (verb === 'switch') {
    const createIndex = cleaned.findIndex((token) => ['-c', '-C', '--create', '--force-create'].includes(token));
    if (createIndex >= 0) return cleaned[createIndex + 1] || null;
    return cleaned.find((token) => !token.startsWith('-')) || null;
  }
  if (verb === 'checkout') {
    if (cleaned.includes('--')) return null;
    const createIndex = cleaned.findIndex((token) => ['-b', '-B', '--orphan'].includes(token));
    if (createIndex >= 0) return cleaned[createIndex + 1] || null;
    return cleaned.find((token) => !token.startsWith('-')) || null;
  }
  if (verb === 'branch') {
    const mutationIndex = cleaned.findIndex((token) => [
      '-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move', '--copy',
    ].includes(token));
    if (mutationIndex >= 0) {
      const positional = cleaned.slice(mutationIndex + 1).filter((token) => !token.startsWith('-'));
      return positional.at(-1) || null;
    }
    return cleaned.find((token) => !token.startsWith('-')) || null;
  }
  return null;
}

export function classifyProtectedGitActions(command) {
  const actions = [];
  for (const invocation of gitInvocations(command || '')) {
    if (invocation.verb === 'commit' || invocation.verb === 'push') {
      actions.push({ action: invocation.verb, target: null });
      continue;
    }
    if (invocation.verb === 'switch' || invocation.verb === 'checkout') {
      const target = branchTarget(invocation.verb, invocation.rest);
      if (target) actions.push({ action: 'branch', target });
      continue;
    }
    if (invocation.verb === 'branch') {
      const query = invocation.rest === ''
        || /^(?:--list\b|-l\b|--show-current\b|--contains\b|--no-contains\b|--merged\b|--no-merged\b|-a\b|--all\b|-r\b|--remotes\b|-v{1,2}\b|--verbose\b|--sort\b|--format\b|--points-at\b|--column\b|--no-column\b)/i.test(invocation.rest);
      const readOnly = query
        && !/(?:^|\s)(?:-d|-D|-m|-M|-c|-C|--delete|--move|--copy|--edit-description|--set-upstream-to)\b/.test(invocation.rest);
      if (!readOnly) actions.push({ action: 'branch', target: branchTarget('branch', invocation.rest) });
    }
  }
  return actions;
}

export function commandReferencesReadOnly(command, readOnlyPaths) {
  const normalized = String(command || '').replaceAll('\\', '/').toLowerCase();
  return readOnlyPaths.filter((root) => {
    const scope = root.toLowerCase();
    const pattern = new RegExp(`(^|[^a-z0-9_.-])${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/|[^a-z0-9_.-]|$)`, 'i');
    return pattern.test(normalized);
  });
}

export function collectStringValues(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStringValues(item, output));
  return output;
}

export function runQuickChecks(repoRoot) {
  return {
    readOnly: verifyNoReadOnlyChanges(repoRoot),
    tsv: verifyModifiedTsv(repoRoot),
    cartography: verifyCartographyFresh(repoRoot),
  };
}
