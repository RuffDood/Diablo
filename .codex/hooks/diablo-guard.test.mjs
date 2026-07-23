import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { messageClaimsCompletion } from './diablo-guard.mjs';

const hookPath = fileURLToPath(new URL('./diablo-guard.mjs', import.meta.url));
const repoRoot = path.resolve(path.dirname(hookPath), '..', '..');

function runHook(input) {
  const result = spawnSync(process.execPath, [hookPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: JSON.stringify({
      cwd: repoRoot,
      session_id: `guard-test-${process.pid}`,
      ...input,
    }),
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

test('recognizes French and English completion claims', () => {
  for (const message of [
    'C’est fait',
    'Terminé',
    'La tâche est terminée',
    'J’ai implémenté le changement',
    'Done',
    'Implementation completed',
  ]) {
    assert.equal(messageClaimsCompletion(message), true, message);
  }
  assert.equal(messageClaimsCompletion('Je prépare la validation.'), false);
});

test('blocks apply_patch writes in a read-only cadastre zone', () => {
  const output = runHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: {
      command: [
        '*** Begin Patch',
        '*** Update File: data-BK/global/excel/skills.txt',
        '*** End Patch',
      ].join('\n'),
    },
  });
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /read-only/);
});

test('blocks Git commit unless a dedicated authorization is consumed', () => {
  const sessionId = `guard-git-test-${process.pid}`;
  const denied = runHook({
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "test"' },
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');

  runHook({
    session_id: sessionId,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'GO COMMIT',
  });
  const allowed = runHook({
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "test"' },
  });
  assert.equal(allowed, null);

  const consumed = runHook({
    session_id: sessionId,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "test"' },
  });
  assert.equal(consumed.hookSpecificOutput.permissionDecision, 'deny');
});
