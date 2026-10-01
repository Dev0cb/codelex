#!/usr/bin/env node
// Validates the CODELEX agentic framework: agents, skills, hooks, settings and cross-references.
// Zero dependencies so it runs before `pnpm install` (CI bootstrap, hooks).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = process.env.CODELEX_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const errors = [];
const err = (file, msg) => errors.push(`${relative(ROOT, file) || file}: ${msg}`);

export const ALLOWED_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'Agent',
]);
export const ALLOWED_MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable', 'inherit']);
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Minimal frontmatter parser: `key: value` lines between leading `---` fences. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

function listMd(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [];
}

// ---------- agents ----------
const agentsDir = join(ROOT, '.claude/agents');
const agents = new Map();
for (const f of listMd(agentsDir)) {
  const file = join(agentsDir, f);
  const fm = parseFrontmatter(readFileSync(file, 'utf8'));
  if (!fm) { err(file, 'missing YAML frontmatter'); continue; }
  const { name, description, tools, model } = fm.data;
  if (!name || !KEBAB.test(name)) err(file, `invalid or missing name "${name ?? ''}"`);
  if (name && `${name}.md` !== f) err(file, `name "${name}" must match file name`);
  if (!description || description.length < 40) err(file, 'description missing or too short (< 40 chars) for reliable routing');
  if (tools) {
    for (const t of tools.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!ALLOWED_TOOLS.has(t) && !t.startsWith('mcp__')) err(file, `unknown tool "${t}"`);
    }
  }
  if (model && !ALLOWED_MODELS.has(model)) err(file, `unknown model "${model}"`);
  if (fm.body.trim().length < 300) err(file, 'system prompt body is too thin (< 300 chars)');
  if (name) {
    if (agents.has(name)) err(file, `duplicate agent name "${name}"`);
    agents.set(name, { file, body: fm.body, tools: tools ?? '' });
  }
}
if (agents.size === 0) err(agentsDir, 'no agents defined');
// Reviewers must stay read-only so they cannot "fix" what they review.
const reviewer = agents.get('code-reviewer');
if (reviewer && /\b(Write|Edit|MultiEdit)\b/.test(reviewer.tools)) err(reviewer.file, 'code-reviewer must be read-only');

// ---------- skills ----------
const skillsDir = join(ROOT, '.claude/skills');
const skills = new Map();
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir).sort()) {
    const dir = join(skillsDir, d);
    if (!statSync(dir).isDirectory()) continue;
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file)) { err(dir, 'skill directory without SKILL.md'); continue; }
    const fm = parseFrontmatter(readFileSync(file, 'utf8'));
    if (!fm) { err(file, 'missing YAML frontmatter'); continue; }
    if (fm.data.name !== d) err(file, `name "${fm.data.name}" must equal directory "${d}"`);
    if (!fm.data.description || fm.data.description.length < 40) err(file, 'description missing or too short');
    skills.set(d, { file, body: fm.body });
  }
}

// ---------- cross references ----------
const claudeMdPath = join(ROOT, 'CLAUDE.md');
const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : '';
if (!claudeMd) err(claudeMdPath, 'CLAUDE.md is missing');
for (const name of agents.keys()) {
  if (!claudeMd.includes(`\`${name}\``)) err(claudeMdPath, `agent "${name}" is not referenced in the routing table`);
}

const docs = [
  [claudeMdPath, claudeMd],
  ...[...agents.values()].map((a) => [a.file, a.body]),
  ...[...skills.values()].map((s) => [s.file, s.body]),
];
const looksLikeAgent = (tok) => /-(engineer|designer|strategist|architect|curator|analyst|reviewer|writer|compliance|liveops|sre)$/.test(tok);
for (const [file, text] of docs) {
  // Agent mentions like `game-designer` must exist.
  for (const [, tok] of text.matchAll(/`([a-z][a-z0-9-]+)`/g)) {
    if (looksLikeAgent(tok) && !agents.has(tok)) err(file, `references unknown agent "${tok}"`);
  }
  // Skill invocations like `/design` must exist (ignore paths such as /docs/...).
  for (const [, tok] of text.matchAll(/(?:^|[\s(`])\/([a-z][a-z0-9-]+)(?=[\s`),.]|$)/gm)) {
    if (!skills.has(tok) && !['clear', 'help', 'config', 'compact', 'model'].includes(tok)) err(file, `references unknown skill "/${tok}"`);
  }
  // Concrete repository paths under docs/ and tools/ must exist (placeholders are skipped).
  for (const [, p] of text.matchAll(/`((?:docs|tools)\/[A-Za-z0-9_./-]+)`/g)) {
    if (/[<>*]|NNNN|SXX|YYYY/.test(p)) continue;
    if (!existsSync(join(ROOT, p))) err(file, `references missing path "${p}"`);
  }
}

// ---------- settings & hooks ----------
const settingsPath = join(ROOT, '.claude/settings.json');
let settings = null;
try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch (e) { err(settingsPath, `invalid JSON: ${e.message}`); }
if (settings?.hooks) {
  for (const [event, groups] of Object.entries(settings.hooks)) {
    for (const g of groups) {
      for (const h of g.hooks ?? []) {
        const m = /\.claude\/hooks\/([\w.-]+)/.exec(h.command ?? '');
        if (!m) { err(settingsPath, `${event} hook without a repository script: ${h.command}`); continue; }
        const script = join(ROOT, '.claude/hooks', m[1]);
        if (!existsSync(script)) { err(settingsPath, `${event} hook script missing: ${m[1]}`); continue; }
        const check = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' });
        if (check.status !== 0) err(script, `syntax error:\n${check.stderr}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Framework validation FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`Framework OK — ${agents.size} agents, ${skills.size} skills, hooks & settings valid.`);
