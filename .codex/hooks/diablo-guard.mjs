import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accessForPath,
  buildAccessRules,
  classifyProtectedGitActions,
  collectStringValues,
  commandReferencesReadOnly,
  extractApplyPatchPaths,
  findRepoRoot,
  isLikelyMutatingShell,
  loadCadastre,
  normalizeRepoPath,
  npmInvocation,
  readOnlyRoots,
  runProcess,
  runQuickChecks,
} from '../../scripts/verify/repo-policy.mjs';

const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

async function readInput() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input.trim() ? JSON.parse(input) : {};
}

function emit(value) {
  if (value && Object.keys(value).length) process.stdout.write(`${JSON.stringify(value)}\n`);
}

function denyPreTool(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function blockAfterTool(reason) {
  emit({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: reason,
    },
  });
}

function authorizationPath(repoRoot, sessionId) {
  const safeSession = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_');
  const resolved = runProcess('git', [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'codex-diablo-guard',
  ], { cwd: repoRoot, allowFailure: true });
  const authorizationRoot = resolved.status === 0 && resolved.stdout.trim()
    ? resolved.stdout.trim()
    : path.join(repoRoot, '.git', 'codex-diablo-guard');
  return path.join(authorizationRoot, `${safeSession}.json`);
}

function recordGitAuthorization(repoRoot, input) {
  const prompt = String(input.prompt || '').trim();
  const match = /^GO\s+(COMMIT|PUSH)$|^GO\s+BRANCH\s+([^\r\n]+)$/i.exec(prompt);
  if (!match) return false;
  const action = match[1]?.toLowerCase() || 'branch';
  const branch = match[2]?.trim() || null;
  const filePath = authorizationPath(repoRoot, input.session_id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const authorization = {
    action,
    branch,
    sessionId: input.session_id,
    expiresAt: Date.now() + AUTHORIZATION_TTL_MS,
  };
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(authorization)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
  emit({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `One ${action} Git operation is authorized for 15 minutes in this session.`,
    },
  });
  return true;
}

function consumeGitAuthorization(repoRoot, input, requested) {
  const filePath = authorizationPath(repoRoot, input.session_id);
  if (!fs.existsSync(filePath)) return false;
  let authorization;
  try {
    authorization = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fs.rmSync(filePath, { force: true });
    return false;
  }
  const valid = authorization.sessionId === input.session_id
    && authorization.expiresAt >= Date.now()
    && authorization.action === requested.action
    && (requested.action !== 'branch' || authorization.branch === requested.target);
  if (valid || authorization.expiresAt < Date.now()) fs.rmSync(filePath, { force: true });
  return valid;
}

function mutatingMcpTool(toolName) {
  return /^mcp__/i.test(toolName)
    && /(?:filesystem|file|fs__)/i.test(toolName)
    && /(?:write|edit|create|delete|remove|move|rename|update|upload|patch)/i.test(toolName);
}

function preToolUse(repoRoot, input) {
  const toolName = String(input.tool_name || '');
  const toolInput = input.tool_input || {};
  const command = String(toolInput.command || '');

  if (toolName === 'Bash') {
    const protectedActions = classifyProtectedGitActions(command);
    if (protectedActions.length) {
      if (protectedActions.length !== 1 || !consumeGitAuthorization(repoRoot, input, protectedActions[0])) {
        const requested = protectedActions.map(({ action, target }) => `${action}${target ? ` ${target}` : ''}`).join(', ');
        denyPreTool(`Git ${requested} is blocked by default. Ask Guillaume for a dedicated prompt: GO COMMIT, GO PUSH, or GO BRANCH <name>.`);
        return;
      }
    }
  }

  const rules = buildAccessRules(loadCadastre(repoRoot));
  let candidatePaths = [];
  if (toolName === 'apply_patch') {
    candidatePaths = extractApplyPatchPaths(command);
  } else if (mutatingMcpTool(toolName)) {
    candidatePaths = collectStringValues(toolInput)
      .map((value) => normalizeRepoPath(value, repoRoot))
      .filter(Boolean);
  }
  const deniedPaths = candidatePaths.filter((filePath) => accessForPath(filePath, rules) === 'read-only');
  if (deniedPaths.length) {
    denyPreTool(`Write blocked by ai-cartographie.json: ${deniedPaths.join(', ')} is read-only.`);
    return;
  }

  if (toolName === 'Bash' && isLikelyMutatingShell(command)) {
    const referenced = commandReferencesReadOnly(command, readOnlyRoots(rules));
    if (referenced.length) {
      denyPreTool(`Mutating shell command references read-only cadastre zone(s): ${referenced.join(', ')}.`);
    }
  }
}

function postToolUse(repoRoot, input) {
  const toolName = String(input.tool_name || '');
  const command = String(input.tool_input?.command || '');
  const relevant = toolName === 'apply_patch'
    || mutatingMcpTool(toolName)
    || (toolName === 'Bash' && isLikelyMutatingShell(command));
  if (!relevant) return;
  try {
    runQuickChecks(repoRoot);
  } catch (error) {
    blockAfterTool(error.message);
  }
}

export function messageClaimsCompletion(message) {
  const text = String(message || '').normalize('NFD').replace(/\p{Mark}/gu, '');
  return /(?:^|\n)\s*(?:c['’]est fait|termine[es]?|livre[es]?|done|completed|finished)\b/im.test(text)
    || /\b(?:j['’]ai|nous avons|i(?:'ve| have))\s+(?:termine[es]?|livre[es]?|implemente[es]?|completed|finished|implemented)\b/i.test(text)
    || /\b(?:tache|travail|implementation|request)\b.{0,50}\b(?:termine[es]?|livre[es]?|complete[es]?|done|completed)\b/i.test(text);
}

function stop(repoRoot, input) {
  if (!messageClaimsCompletion(input.last_assistant_message)) return;
  const invocation = npmInvocation(['run', 'verify']);
  const result = runProcess(invocation.command, invocation.args, {
    cwd: repoRoot,
    allowFailure: true,
    timeout: 600_000,
  });
  if (result.status === 0) return;
  const raw = String(result.stderr || result.stdout || '').trim();
  const tail = raw.length > 5_000 ? raw.slice(-5_000) : raw;
  const reason = `Mandatory npm run verify failed; the task cannot be declared complete.\n${tail}`;
  if (input.stop_hook_active) {
    emit({ continue: false, stopReason: reason, systemMessage: reason });
  } else {
    emit({ decision: 'block', reason });
  }
}

export async function main() {
  const input = await readInput();
  const repoRoot = findRepoRoot(input.cwd || process.cwd());
  try {
    if (input.hook_event_name === 'UserPromptSubmit') recordGitAuthorization(repoRoot, input);
    else if (input.hook_event_name === 'PreToolUse') preToolUse(repoRoot, input);
    else if (input.hook_event_name === 'PostToolUse') postToolUse(repoRoot, input);
    else if (input.hook_event_name === 'Stop') stop(repoRoot, input);
  } catch (error) {
    const reason = `Diablo repository guard failed closed: ${error.message}`;
    if (input.hook_event_name === 'PreToolUse') denyPreTool(reason);
    else if (input.hook_event_name === 'PostToolUse') blockAfterTool(reason);
    else if (input.hook_event_name === 'Stop') emit({ decision: 'block', reason });
    else emit({ systemMessage: reason });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
