import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accessForPath,
  buildAccessRules,
  classifyProtectedGitActions,
  commandReferencesReadOnly,
  extractApplyPatchPaths,
  isLikelyMutatingShell,
  readOnlyRoots,
} from './repo-policy.mjs';

const cadastre = {
  root: {
    path: '.',
    meta: { agentAccess: 'read-write' },
    children: [
      { path: 'data-BK', meta: { agentAccess: 'read-only' }, children: [] },
      { path: 'data-TCP', children: [] },
    ],
  },
};

test('inherits cadastre access and isolates read-only roots', () => {
  const rules = buildAccessRules(cadastre);
  assert.equal(accessForPath('data-BK/global/excel/skills.txt', rules), 'read-only');
  assert.equal(accessForPath('data-TCP/global/excel/skills.txt', rules), 'read-write');
  assert.deepEqual(readOnlyRoots(rules), ['data-BK']);
});

test('extracts every apply_patch target', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: data-BK/global/excel/skills.txt',
    '*** Move to File: data-TCP/global/excel/skills.txt',
    '*** Add File: scripts/new.mjs',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(extractApplyPatchPaths(patch), [
    'data-BK/global/excel/skills.txt',
    'data-TCP/global/excel/skills.txt',
    'scripts/new.mjs',
  ]);
});

test('classifies protected Git writes but not read-only Git commands', () => {
  assert.deepEqual(classifyProtectedGitActions('git status --short'), []);
  assert.deepEqual(classifyProtectedGitActions('git branch --show-current'), []);
  assert.deepEqual(classifyProtectedGitActions('git branch -vv'), []);
  assert.deepEqual(classifyProtectedGitActions('git checkout -- package.json'), []);
  assert.deepEqual(classifyProtectedGitActions('git commit -m "message"'), [{ action: 'commit', target: null }]);
  assert.deepEqual(classifyProtectedGitActions('git push origin main'), [{ action: 'push', target: null }]);
  assert.deepEqual(classifyProtectedGitActions('git switch -c codex/guardrails'), [{ action: 'branch', target: 'codex/guardrails' }]);
  assert.deepEqual(classifyProtectedGitActions('git branch codex/guardrails'), [{ action: 'branch', target: 'codex/guardrails' }]);
});

test('spots mutating shell commands that mention read-only zones', () => {
  assert.equal(isLikelyMutatingShell("Set-Content data-BK/global/excel/skills.txt 'x'"), true);
  assert.deepEqual(
    commandReferencesReadOnly('Set-Content C:\\repo\\data-BK\\global\\skills.txt x', ['data-BK']),
    ['data-BK'],
  );
  assert.equal(isLikelyMutatingShell("Get-Content data-BK/global/excel/skills.txt"), false);
});
