// Shared helpers for CODELEX Claude Code hooks. Hooks receive a JSON payload on stdin.
// Exit code 2 blocks the tool call (PreToolUse) or feeds stderr back to Claude (PostToolUse).
import { readFileSync } from 'node:fs';

export function readPayload() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function block(message) {
  process.stderr.write(`[codelex-guard] ${message}\n`);
  process.exit(2);
}

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
