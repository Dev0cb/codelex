/**
 * Simulator CLI (`pnpm --filter @codelex/bots simulate -- [options]`): seeded bot-vs-bot Classic matches on the
 * real lexicon (`packages/lexicon/data`, profile `global-ranked`), built as a `.clxi` artefact with the GADDAG
 * section and decoded (what ships). Not part of `pnpm test` (the smoke tests in `sim/*.test.ts` are).
 *
 * Suite `b2` (default; B2 grid, plus the E-1.7 AC-20 variant without inflections):
 *   --rules v1|v2          rules version (default v1)
 *   --candidate <id>       with --rules v2: tb-0-2-4-8 or tb-0-3-6-12 (required: the candidate is not in the log)
 *   --layout <id>          with --rules v2: classic-v2 (default) or classic-v1 (D4 diagnostic: DW start)
 *   --seed <16 hex>        master seed (default 2026100300000b02)
 *   --mirror <n>           Beginner mirror matches per variant (default 1000)
 *   --pair <n>             matches for Beginner vs random-legal and greedy vs Beginner (default 500 each)
 *   --variants <list>      with,without (default both; `without` runs the mirror only, same seeds)
 *
 * Suite `balance-check` (`--suite balance-check`; docs/specs/E-1.6-balance/v2-balance-check.md, all inputs fixed
 * by the pre-registration; the readout is written next to the results):
 *   --primary <bot>        strategist (default) or greedy (§5.2 Strategist-late path, provisional decision)
 *   --diagnostics on|off   dx-dw-* diagnostics on pairing 0 (default on)
 *   --variants <list>      subset of v1,v2-3612,v2-248,dx-dw-3612,dx-dw-248 (job splitting, §5.3-2)
 *   --code-commit <sha>, --lexicon-commit <sha>, --prereg-blob <sha>   workflow inputs recorded for I-3 (§6)
 *   --seed, --mirror, --pair   smoke runs only: any change makes the readout INVALID (I-3)
 *
 * Both: --out <file> (JSON), --markdown <file> (tables / readout).
 *
 * The only use of the process is reading explicit arguments (`argv`): no environment, no clock. Wall time is
 * measured by the caller (`time pnpm … simulate`), never inside the package (ADR-0013 §D4.6).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv } from 'node:process';
import { balanceSuite } from './balance-check.js';
import { readout, readoutMarkdown } from './readout.js';
import { toJson, toMarkdown } from './report.js';
import { runSuite, type SuiteSpec, type Variant } from './simulate.js';
import { pairingsFor, parseOptions, realVariants, type Options } from './variants.js';

function b2Spec(options: Options): SuiteSpec {
  const lexicons = realVariants();
  const pairings = pairingsFor(options);
  const variants: Variant[] = [];
  if (options.variants.includes('with')) {
    variants.push({
      id: 'with-inflections',
      lexicon: lexicons.with,
      rules: options.rules,
      pairings: pairings.with,
    });
  }
  if (options.variants.includes('without')) {
    variants.push({
      id: 'without-inflections',
      lexicon: lexicons.without,
      rules: options.rules,
      pairings: pairings.without,
    });
  }
  return { masterSeed: options.seed, variants };
}

function write(file: string, text: string): void {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${path}`);
}

function main(): void {
  const options = parseOptions(argv.slice(2));
  const balance = options.suite === 'balance-check';
  const spec = balance
    ? balanceSuite(realVariants().with, {
        masterSeed: options.seed,
        primary: options.primary,
        mirror: options.mirror,
        pair: options.pair,
        diagnostics: options.diagnostics,
        only: options.variants,
      })
    : b2Spec(options);
  const report = runSuite(spec, {
    onMatch: (variant, pairing, index) => {
      if ((index + 1) % 100 === 0)
        console.log(`${variant} ${pairing}: ${String(index + 1)} matches`);
    },
  });
  if (!balance) {
    write(options.out, toJson(report));
    write(options.markdown, toMarkdown(report));
    return;
  }
  const result = readout(report, options.primary, {
    codeCommit: options.codeCommit,
    lexiconCommit: options.lexiconCommit,
    preRegistrationBlob: options.preRegistrationBlob,
  });
  write(options.out, toJson({ readout: result, suite: report }));
  write(options.markdown, `${readoutMarkdown(result)}\n${toMarkdown(report)}`);
  console.log(`decision: ${result.outcome.decision}`);
}

main();
