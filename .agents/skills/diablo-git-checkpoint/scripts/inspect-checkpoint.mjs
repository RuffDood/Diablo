#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const json = process.argv.includes('--json');
const failOnMixed = process.argv.includes('--fail-on-mixed');
const allowed = new Set(['--json', '--fail-on-mixed']);
const unknown = process.argv.slice(2).filter((arg) => !allowed.has(arg));

if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(', ')}`);
  process.exit(64);
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return result;
}

function zlist(args) {
  const output = git(args).stdout;
  return [...new Set(output.split('\0').filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'en'),
  );
}

function lines(args) {
  return git(args).stdout.trim().split(/\r?\n/).filter(Boolean);
}

try {
  git(['rev-parse', '--show-toplevel']);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const upstreamResult = git(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { allowFailure: true },
  );
  const upstream = upstreamResult.status === 0 ? upstreamResult.stdout.trim() : null;
  let ahead = null;
  let behind = null;

  if (upstream) {
    const counts = git(['rev-list', '--left-right', '--count', `HEAD...${upstream}`])
      .stdout.trim().split(/\s+/).map(Number);
    [ahead, behind] = counts;
  }

  const staged = zlist(['diff', '--cached', '--name-only', '-z']);
  const unstaged = zlist(['diff', '--name-only', '-z']);
  const untracked = zlist(['ls-files', '--others', '--exclude-standard', '-z']);
  const conflicts = zlist(['diff', '--name-only', '--diff-filter=U', '-z']);
  const unstagedSet = new Set(unstaged);
  const mixed = staged.filter((path) => unstagedSet.has(path));
  const whitespace = git(['diff', '--cached', '--check'], { allowFailure: true });

  const report = {
    branch,
    upstream,
    ahead,
    behind,
    staged: { count: staged.length, files: staged },
    unstaged: { count: unstaged.length, files: unstaged },
    untracked: { count: untracked.length, files: untracked },
    mixed: { count: mixed.length, files: mixed },
    conflicts: { count: conflicts.length, files: conflicts },
    cachedWhitespaceClean: whitespace.status === 0,
    cachedWhitespaceErrors: whitespace.stdout.trim(),
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`branch: ${branch}`);
    console.log(`upstream: ${upstream || '(none)'}`);
    if (upstream) console.log(`ahead/behind: ${ahead}/${behind}`);
    console.log(`staged: ${staged.length}`);
    console.log(`unstaged: ${unstaged.length}`);
    console.log(`untracked: ${untracked.length}`);
    console.log(`mixed: ${mixed.length}`);
    console.log(`conflicts: ${conflicts.length}`);
    console.log(`cached diff check: ${report.cachedWhitespaceClean ? 'clean' : 'FAILED'}`);
    if (mixed.length) {
      console.log('\nmixed files:');
      for (const path of mixed) console.log(`  ${path}`);
    }
    if (conflicts.length) {
      console.log('\nconflicts:');
      for (const path of conflicts) console.log(`  ${path}`);
    }
    if (!report.cachedWhitespaceClean && report.cachedWhitespaceErrors) {
      console.log(`\ncached diff errors:\n${report.cachedWhitespaceErrors}`);
    }
  }

  if (conflicts.length || !report.cachedWhitespaceClean || (failOnMixed && mixed.length)) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`inspect-checkpoint: ${error.message}`);
  process.exitCode = 1;
}
