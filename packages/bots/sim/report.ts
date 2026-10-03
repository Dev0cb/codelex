/**
 * Report output for the B2 simulator: an indented JSON document and markdown tables, built from integers and
 * strings only. `JSON.stringify` is banned in `packages/bots` (ADR-0013 §D4.2: key order and number format are not
 * canonical), so the JSON writer is explicit: keys in insertion order, safe integers, ASCII-escaped strings.
 */
import type { PairingReport, PersonalityStats, SuiteReport } from './simulate.js';
import { fixed, pct } from './stats.js';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

function quote(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const ch = text.charAt(i);
    if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

function write(value: Json, indent: string): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${String(value)}`);
    return String(value);
  }
  if (typeof value === 'string') return quote(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value as readonly Json[];
    if (items.length === 0) return '[]';
    if (items.every((v) => typeof v !== 'object' || v === null)) {
      return `[${items.map((v) => write(v, inner)).join(', ')}]`;
    }
    return `[\n${items.map((v) => `${inner}${write(v, inner)}`).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value as { readonly [key: string]: Json });
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}${quote(k)}: ${write(v, inner)}`).join(',\n')}\n${indent}}`;
}

/** Indented JSON of plain report data (objects, arrays, safe integers, strings, booleans). */
export function toJson(value: unknown): string {
  return `${write(value as Json, '')}\n`;
}

const tenths = (x: number): string => fixed(x, 1);
const ci = (r: PairingReport['firstPlayerWin']): string =>
  `${pct(r.bp)} [${fixed(r.ci95.lo, 2)}, ${fixed(r.ci95.hi, 2)}] (${String(r.k)}/${String(r.n)})`;

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function pairingTable(pairings: readonly PairingReport[]): string[] {
  const lines = [
    row([
      'Pairing',
      'Matches',
      'Draws',
      'First-player win, 95 % CI',
      'A win, 95 % CI',
      'going_out / scoreless',
      'No-word turns (all / bag not empty)',
      'Bag empty at end',
      'Rack tiles at end p50 / p95',
      'Mean total score',
      'First-mover lead',
      'Words / match',
      'Top-20 share',
      'Inflection share',
      'C-05 term-bonus share',
      'C-09 hook share',
    ]),
    row(Array.from({ length: 16 }, () => '---')),
  ];
  for (const p of pairings) {
    lines.push(
      row([
        `${p.id} (A = ${p.a}, B = ${p.b})`,
        String(p.matches),
        String(p.draws),
        ci(p.firstPlayerWin),
        p.a === p.b ? 'n/a (mirror)' : ci(p.aWin),
        `${String(p.endReasons.going_out)} / ${String(p.endReasons.scoreless_turns)} (${pct(p.scorelessEndingBp)})`,
        `${pct(p.noWordTurnBp)} / ${pct(p.noWordTurnBagNotEmptyBp)}`,
        pct(p.bagEmptyAtEndBp),
        `${String(p.rackTilesAtEnd.p50)} / ${String(p.rackTilesAtEnd.p95)}`,
        tenths(p.meanTotalScoreTenths),
        tenths(p.meanFirstMoverLeadTenths),
        tenths(p.wordsPerMatchTenths),
        pct(p.top20TermShareBp),
        pct(p.inflectionShareBp),
        pct(p.termBonusShareBp),
        pct(p.hookTermBonusShareBp),
      ]),
    );
  }
  return lines;
}

function personalityTable(pairings: readonly PairingReport[]): string[] {
  const lines = [
    row([
      'Pairing',
      'Bot',
      'Decisions',
      'No-word decisions',
      'Points / word',
      'Mean score',
      'Novice+intermediate main words',
      'Budget exhausted',
      'Nodes p50 / p95 / max',
      'Evaluated p50 / p95 / max',
    ]),
    row(Array.from({ length: 10 }, () => '---')),
  ];
  for (const p of pairings) {
    for (const s of p.personalities) lines.push(personalityRow(p.id, s));
  }
  return lines;
}

function personalityRow(pairing: string, s: PersonalityStats): string {
  return row([
    pairing,
    s.personality,
    String(s.decisions),
    pct(s.noWordBp),
    tenths(s.pointsPerWordTenths),
    tenths(s.meanScoreTenths),
    pct(s.noviceOrIntermediateBp),
    `${String(s.budgetExhausted)} (${pct(s.budgetExhaustedBp)})`,
    `${String(s.nodes.p50)} / ${String(s.nodes.p95)} / ${String(s.nodes.max)}`,
    `${String(s.candidatesEvaluated.p50)} / ${String(s.candidatesEvaluated.p95)} / ${String(s.candidatesEvaluated.max)}`,
  ]);
}

/** Markdown tables of a suite report (pasted into the readout under docs/). */
export function toMarkdown(report: SuiteReport): string {
  const lines: string[] = [
    `BOT_VERSION ${String(report.botVersion)}, engineRulesVersion ${String(report.engineRulesVersion)}, master seed \`${report.masterSeed}\`, ${String(report.matches)} matches, every match replayed to identical hashes.`,
    '',
  ];
  for (const v of report.variants) {
    lines.push(
      `### ${v.id}`,
      '',
      `Lexicon \`${v.lexiconVersion}\`, profile \`${v.profileId}\` (\`${v.definitionHash}\`), ${String(v.forms)} forms / ${String(v.terms)} terms, ${v.automaton} generation.`,
      '',
      ...pairingTable(v.pairings),
      '',
      ...personalityTable(v.pairings),
      '',
    );
  }
  return lines.join('\n');
}
