#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit|NotebookEdit): protects secrets, generated files and immutable records.
import { readPayload, block } from './lib.mjs';
import { basename } from 'node:path';

const input = readPayload()?.tool_input ?? {};
const file = String(input.file_path ?? input.notebook_path ?? '');
const name = basename(file);
const content = [input.content, input.new_string, ...(input.edits ?? []).map((e) => e?.new_string)]
  .filter((v) => typeof v === 'string')
  .join('\n');

if (/^\.env(\.(?!example$)[\w.-]+)?$/.test(name)) block(`writing ${name} is forbidden; use .env.example and the secret manager`);
if (/\.(pem|p12|pfx|key|keystore|jks|mobileprovision|p8)$/i.test(name)) block(`writing key/certificate material (${name}) is forbidden`);
if (/(^|\/)(google-services\.json|GoogleService-Info\.plist|credentials\.json|serviceAccount.*\.json)$/.test(file)) block(`${name} contains credentials and must not be written by agents`);
if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file)) block('lockfiles are generated: run pnpm install instead of editing them');
if (/\/docs\/postmortems\/.+\.md$/.test(file) && input.old_string !== undefined) block('postmortems are immutable records; add a dated addendum section instead');

const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'private key'],
  [/sk-ant-[a-zA-Z0-9_-]{20,}/, 'Anthropic API key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/sk_live_[0-9a-zA-Z]{24,}/, 'Stripe live key'],
];
for (const [re, kind] of SECRET_PATTERNS) {
  if (re.test(content)) block(`content for ${file} looks like it contains a ${kind}; secrets belong in the secret manager`);
}
process.exit(0);
