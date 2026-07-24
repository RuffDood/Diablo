import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const defaultRepoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const defaultStatePath = 'analysis-cache/checkpoint/state.json';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} ${args.join(' ')} failed.`);
  return result;
}

function extractCurrentMission(markdown) {
  const link = markdown.match(/^\[([^\]]+)\]\(([^)]+)\)/m);
  const gateSection = markdown.split(/^## Prochain gate\s*$/m)[1] || '';
  const gate = gateSection.split(/^## |^Gates suivants :/m)[0];
  return {
    name: link?.[1] || null,
    path: link ? `Mission/${link[2]}`.replaceAll('\\', '/') : null,
    nextGate: gate.trim().replace(/\s+/g, ' ') || null,
  };
}

export function buildState({ inspector, registry, currentMission, head, generatedAt }) {
  const selected = registry.workstreams.find((stream) => stream.mission === currentMission.path) || null;
  const selectedReport = inspector.workstreams.streams.find((stream) => stream.id === selected?.id) || null;
  const blockers = [];
  if (inspector.conflicts.count) blockers.push(`${inspector.conflicts.count} conflict(s)`);
  if (inspector.mixed.count) blockers.push(`${inspector.mixed.count} mixed staged/worktree file(s)`);
  if (!inspector.cachedWhitespaceClean) blockers.push('staged whitespace errors');
  if (inspector.workstreams.validationErrors.length) blockers.push('invalid workstream registry');
  if (inspector.workstreams.unassigned.length) blockers.push(`${inspector.workstreams.unassigned.length} unassigned file(s)`);
  if (inspector.workstreams.overlaps.length) blockers.push(`${inspector.workstreams.overlaps.length} overlapping file(s)`);

  return {
    schemaVersion: 1,
    generatedAt,
    repository: {
      branch: inspector.branch, upstream: inspector.upstream, ahead: inspector.ahead, behind: inspector.behind, head,
    },
    currentMission: {
      ...currentMission,
      workstreamId: selected?.id || null,
      registryStatus: selected?.status || null,
      registryNextGate: selected?.nextGate || null,
      changedFiles: selectedReport?.count || 0,
    },
    worktree: {
      staged: inspector.staged.count,
      unstaged: inspector.unstaged.count,
      untracked: inspector.untracked.count,
      mixed: inspector.mixed.count,
      conflicts: inspector.conflicts.count,
      shared: inspector.workstreams.shared.length,
      unassigned: inspector.workstreams.unassigned.length,
      overlaps: inspector.workstreams.overlaps.length,
      streams: inspector.workstreams.streams.map(({ id, name, status, count }) => ({ id, name, status, count })),
    },
    checkpoint: {
      ready: blockers.length === 0,
      blockers,
      recommendedWorkstream: selected?.id || null,
      authorization: 'Commit and push require an explicit user request; keep the commit push go ritual.',
    },
  };
}

export function writeStateAtomic(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function printSummary(state, statePath, wroteState) {
  console.log('AUTOMATIC CHECKPOINT');
  console.log(`mission: ${state.currentMission.name || '(not resolved)'}`);
  console.log(`workstream: ${state.checkpoint.recommendedWorkstream || '(not resolved)'}`);
  console.log(`next gate: ${state.currentMission.nextGate || state.currentMission.registryNextGate || '(not resolved)'}`);
  console.log(`changed files in mission: ${state.currentMission.changedFiles}`);
  console.log(`staged/unstaged/untracked: ${state.worktree.staged}/${state.worktree.unstaged}/${state.worktree.untracked}`);
  console.log(`shared/unassigned/overlaps: ${state.worktree.shared}/${state.worktree.unassigned}/${state.worktree.overlaps}`);
  console.log(`checkpoint ready: ${state.checkpoint.ready ? 'yes' : 'no'}`);
  for (const blocker of state.checkpoint.blockers) console.log(`blocker: ${blocker}`);
  if (wroteState) console.log(`persistent state: ${path.relative(defaultRepoRoot, statePath).replaceAll('\\', '/')}`);
}

export function main(argv = process.argv.slice(2), repoRoot = defaultRepoRoot) {
  const allowed = new Set(['--json', '--check', '--no-write']);
  const unknown = argv.filter((arg) => !allowed.has(arg));
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  const inspector = JSON.parse(run(process.execPath, [
    '.agents/skills/diablo-git-checkpoint/scripts/inspect-checkpoint.mjs', '--json',
  ], repoRoot).stdout);
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'Mission', 'WORKSTREAMS.json'), 'utf8'));
  const currentMission = extractCurrentMission(fs.readFileSync(path.join(repoRoot, 'Mission', 'CURRENT.md'), 'utf8'));
  const headParts = run('git', ['log', '-1', '--format=%H%x00%s%x00%cI'], repoRoot).stdout.trim().split('\0');
  const state = buildState({
    inspector, registry, currentMission,
    head: { sha: headParts[0], subject: headParts[1], committedAt: headParts[2] },
    generatedAt: new Date().toISOString(),
  });
  const statePath = path.join(repoRoot, defaultStatePath);
  const shouldWrite = !argv.includes('--no-write') && !argv.includes('--check');
  if (shouldWrite) writeStateAtomic(statePath, state);
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  else printSummary(state, statePath, shouldWrite);
  if (argv.includes('--check') && !state.checkpoint.ready) return 1;
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`checkpoint: ${error.message}`); process.exitCode = 1; }
}
