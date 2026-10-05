/**
 * Readout CLI (`pnpm --filter @codelex/bots readout -- --merge <results.json…> [options]`): joins the results JSON
 * of split balance-check jobs (v2-balance-check §5.3-2) and writes the single V1 readout. See `merge.ts`.
 *
 * Options: --out <file> (JSON: merged readout + suite), --markdown <file> (readout tables),
 * --wall-time-s <n> (total wall time measured by the workflow, §6),
 * --lexicon-version <v> / --definition-hash <h> (§4.3 values of the lexicon commit; I-3 compares them).
 *
 * Reads only the files named in `argv`; no environment, no clock (ADR-0013 §D4.6).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv } from 'node:process';
import { mergeResults, parseMergeArgs } from './merge.js';
import { readoutMarkdown } from './readout.js';
import { toJson, toMarkdown } from './report.js';

function write(file: string, text: string): void {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}

function main(): void {
  const args = parseMergeArgs(argv.slice(2));
  const merged = mergeResults(args.inputs.map((f) => readFileSync(resolve(f), 'utf8')));
  const result = merged.readout(args.wallTimeSeconds, args.expected);
  write(args.out, toJson({ readout: result, suite: merged.suite }));
  write(args.markdown, `${readoutMarkdown(result)}\n${toMarkdown(merged.suite)}`);
  console.log(`decision: ${result.outcome.decision}`);
}

main();
