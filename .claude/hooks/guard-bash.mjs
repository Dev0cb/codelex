#!/usr/bin/env node
// PreToolUse(Bash): blocks destructive or policy-violating shell commands.
import { readPayload, block } from './lib.mjs';

// Heredoc bodies are data written to files, not executed commands: strip them to avoid false positives
// (e.g. docs that mention `terraform apply`). The heredoc's opening line is kept and still checked.
export function stripHeredocs(command) {
  return command.replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n\s*\3[ \t]*(?=\n|$)/g, '$1');
}

const cmd = stripHeredocs(String(readPayload()?.tool_input?.command ?? ''));

export const RULES = [
  [/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME|\.\.?\/?)(\s|$)/i, 'recursive delete of root/home/repo root is forbidden'],
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease\b)[^\n]*\b(main|master|release\/\S+)\b/, 'force-push to a protected branch is forbidden'],
  [/\bgit\s+push\b[^\n]*\s(origin\s+)?:?(main|master)\s*$/, 'direct push to main is forbidden; open a PR from a feature branch'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f[a-z]*d)\b[^\n]*origin\/(main|master)/, 'hard reset onto main discards work; do it manually if really intended'],
  [/\bgit\s+commit\b[^\n]*--no-verify\b/, 'bypassing git hooks (--no-verify) is forbidden'],
  [/\bterraform\s+(apply|destroy)\b/, 'terraform apply/destroy only runs from CI with approval'],
  [/\b(tofu)\s+(apply|destroy)\b/, 'tofu apply/destroy only runs from CI with approval'],
  [/\bkubectl\b[^\n]*\b(delete|drain|cordon|scale)\b[^\n]*(--context[= ]\S*prod|-n\s+\S*prod)/, 'mutating kubectl on production contexts is forbidden'],
  [/\bhelm\s+(uninstall|delete)\b/, 'helm uninstall must go through ArgoCD/CI'],
  [/\b(DROP\s+(DATABASE|SCHEMA|TABLE)|TRUNCATE\s+TABLE)\b/i, 'destructive SQL must be a reviewed migration, not an ad-hoc command'],
  [/\b(eas\s+submit|fastlane\s+(deliver|supply|release)|eas\s+update\b[^\n]*--channel\s+production)\b/, 'store submissions / production OTA are human-only'],
  [/\bnpm\s+publish\b|\bpnpm\s+publish\b/, 'publishing packages is human-only'],
  [/curl[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'piping remote scripts into a shell is forbidden'],
  [/\b(cat|less|more|head|tail|bat)\s+([^\n|;&]*\s)?(\S*\/)?\.env(?!\.example\b)(\.[\w-]+)?(\s|$|[|;&])/, 'reading .env files would leak secrets into the transcript'],
];

for (const [re, why] of RULES) {
  if (re.test(cmd)) block(`${why}. Command: ${cmd.slice(0, 200)}`);
}
process.exit(0);
