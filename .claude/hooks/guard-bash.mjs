#!/usr/bin/env node
// PreToolUse(Bash): blocks destructive or policy-violating shell commands.
//
// The command is analysed per pipeline (split on unquoted `;`, `&&`, `||`, newlines) so a rule never matches
// across two unrelated commands. Quoted text is ignored only for pure-data commands (echo, printf, grep,
// git commit -m …); for everything else — including `bash -c "…"`, `eval`, `psql -c "…"` — it is checked.
// This is a safety net against mistakes, not a sandbox: branch protection and cloud IAM are the real controls.
import { pathToFileURL } from 'node:url';
import { readPayload, block } from './lib.mjs';

// Heredoc bodies are data written to files, not executed commands. The opening line is kept and still checked.
export function stripHeredocs(command) {
  return command.replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n\s*\3[ \t]*(?=\n|$)/g, '$1');
}

/** Splits on unquoted separators. Returns pipelines, each an array of commands (split on unquoted `|`). */
export function splitCommand(command) {
  const pipelines = [];
  let pipeline = [];
  let cur = '';
  let quote = null;
  const flushCmd = () => { pipeline.push(cur.trim()); cur = ''; };
  const flushPipe = () => { flushCmd(); if (pipeline.some(Boolean)) pipelines.push(pipeline.filter(Boolean)); pipeline = []; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const next = command[i + 1];
    if (quote) {
      if (c === '\\' && quote === '"' && next !== undefined) { cur += c + next; i++; continue; }
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '\\' && next !== undefined) { cur += c + next; i++; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '\n' || c === ';') { flushPipe(); continue; }
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) { flushPipe(); i++; continue; }
    if (c === '|') { flushCmd(); continue; }
    cur += c;
  }
  flushPipe();
  return pipelines;
}

const DATA_COMMANDS = new Set(['echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg', 'test', '[']);
const WRAPPERS = new Set(['sudo', 'command', 'time', 'nohup', 'env']);

/** First meaningful words of a simple command (skips VAR=value prefixes and wrappers like sudo). */
function leadingWords(cmd) {
  const words = cmd.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
  return words.slice(i);
}

/** Blanks quoted text of pure-data commands; leaves executable commands untouched. */
export function sanitize(cmd) {
  const [w0, w1] = leadingWords(cmd);
  const isData = DATA_COMMANDS.has(w0 ?? '') || (w0 === 'git' && ['commit', 'tag', 'notes'].includes(w1 ?? ''));
  return isData ? cmd.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''") : cmd;
}

const RULES = [
  [/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|\.\.?\/?)(\s|$)/i, 'recursive delete of root/home/repo root is forbidden'],
  [/\bgit\s+push\b.*(--force\b|\s-f\b|--force-with-lease\b).*\b(main|master|release\/\S+)\b/, 'force-push to a protected branch is forbidden'],
  [/\bgit\s+push\b.*\s(\S+\s+)?(HEAD:)?(refs\/heads\/)?(main|master)['"]?\s*$/, 'direct push to main is forbidden; open a PR from a feature branch'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f[a-z]*d)\b.*origin\/(main|master)/, 'hard reset onto main discards work; do it manually if really intended'],
  [/\bgit\s+commit\b.*\s--no-verify\b/, 'bypassing git hooks (--no-verify) is forbidden'],
  [/\b(terraform|tofu)\s+(apply|destroy)\b/, 'terraform/tofu apply and destroy only run from CI with approval'],
  [/\bkubectl\b.*\b(delete|drain|cordon|scale)\b.*(--context[= ]\S*prod|-n\s+\S*prod)/, 'mutating kubectl on production contexts is forbidden'],
  [/\bhelm\s+(uninstall|delete)\b/, 'helm uninstall must go through ArgoCD/CI'],
  [/\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b/i, 'destructive SQL must be a reviewed migration, not an ad-hoc command'],
  [/\b(eas\s+submit|fastlane\s+(deliver|supply|release)|eas\s+update\b.*--channel\s+production)\b/, 'store submissions / production OTA are human-only'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, 'publishing packages is human-only'],
  [/\b(cat|less|more|head|tail|bat)\s+([^|;&]*\s)?(\S*\/)?\.env(?!\.example\b)(\.[\w-]+)?(\s|$)/, 'reading .env files would leak secrets into the transcript'],
];
const PIPE_RULES = [
  [/\b(curl|wget)\b.*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'piping remote scripts into a shell is forbidden'],
];

/** Returns the reason the command must be blocked, or null. */
export function check(command) {
  for (const pipeline of splitCommand(stripHeredocs(command))) {
    const cmds = pipeline.map(sanitize);
    for (const c of cmds) for (const [re, why] of RULES) if (re.test(c)) return `${why}. Command: ${c.slice(0, 200)}`;
    const joined = cmds.join(' | ');
    for (const [re, why] of PIPE_RULES) if (re.test(joined)) return `${why}. Command: ${joined.slice(0, 200)}`;
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const reason = check(String(readPayload()?.tool_input?.command ?? ''));
  if (reason) block(reason);
  process.exit(0);
}
