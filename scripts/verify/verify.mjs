import fs from 'node:fs';
import path from 'node:path';
import {
  findRepoRoot,
  npmInvocation,
  runProcess,
  runQuickChecks,
  verifyGitLfs,
  verifyZipContents,
} from './repo-policy.mjs';

const repoRoot = findRepoRoot();
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

function heading(label) {
  console.log(`\n[verify] ${label}`);
}

function run(command, args, label, timeout = 600_000) {
  heading(label);
  const result = runProcess(command, args, { cwd: repoRoot, allowFailure: true, timeout });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status || 1);
}

function runNpm(args, label, timeout = 600_000) {
  const invocation = npmInvocation(args);
  run(invocation.command, invocation.args, label, timeout);
}

try {
  heading('repository guardrails');
  const quick = runQuickChecks(repoRoot);
  console.log(`read-only changes: ${quick.readOnly.violations}`);
  console.log(`modified D2R TSV files: ${quick.tsv.checked}`);
  console.log(`cadastre nodes: ${quick.cartography.checked}`);

  heading('cadastre schema');
  runProcess(process.execPath, ['scripts/validate-cartographie/validate.mjs'], { cwd: repoRoot });
  console.log('VALID');

  heading('active mission pointer');
  run(process.execPath, ['scripts/validate-current-mission/validate.mjs'], 'Mission/CURRENT.md');

  heading('ZIP contents');
  const zip = verifyZipContents(repoRoot);
  console.log(`archives checked: ${zip.checked}`);

  heading('Git LFS');
  const lfs = verifyGitLfs(repoRoot);
  console.log(`LFS candidates checked: ${lfs.checked}; tracked LFS files: ${lfs.tracked}`);

  run(process.execPath, [
    '--test',
    'scripts/verify/repo-policy.test.mjs',
    'scripts/validate-current-mission/validate.test.mjs',
    '.codex/hooks/diablo-guard.test.mjs',
  ], 'repository guardrail tests');
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', 'scripts/runtime/Sync-BKVince.Tests.ps1',
    ], 'BKVince runtime sync tests');
  }
  runNpm(['test', '--workspaces', '--if-present'], 'workspace tests');

  if (packageJson.scripts?.['verify:data']) {
    runNpm(['run', 'verify:data'], 'governed data tests');
  } else {
    for (const scriptName of Object.keys(packageJson.scripts || {}).filter((name) => name.startsWith('test:'))) {
      runNpm(['run', scriptName], scriptName);
    }
  }

  runNpm(['run', 'build'], 'build');
  console.log('\n[verify] ALL CHECKS PASSED');
} catch (error) {
  console.error(`\n[verify] FAILED\n${error.message}`);
  process.exit(1);
}
