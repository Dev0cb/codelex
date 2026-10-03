/**
 * B2 simulator CLI (`pnpm --filter @codelex/bots simulate -- [options]`): seeded bot-vs-bot Classic matches on the
 * real lexicon (`packages/lexicon/data`, profile `global-ranked`), built as a `.clxi` artefact with the GADDAG
 * section and decoded (what ships), plus the E-1.7 AC-20 variant without inflections. Writes a JSON report and
 * markdown tables. Not part of `pnpm test` (the smoke test `sim/simulate.test.ts` is).
 *
 * Options (all optional):
 *   --seed <16 hex>       master seed (default 2026100300000b02)
 *   --mirror <n>          Beginner mirror matches per variant (default 1000)
 *   --pair <n>            matches for Beginner vs random-legal and greedy vs Beginner (default 500 each)
 *   --variants <list>     with,without (default both; `without` runs the mirror only, same seeds)
 *   --out <file>          JSON report (default sim-results/b2-report.json)
 *   --markdown <file>     markdown tables (default sim-results/b2-tables.md)
 *
 * The only use of the process is reading explicit arguments (`argv`): no environment, no clock. Wall time is
 * measured by the caller (`time pnpm … simulate`), never inside the package (ADR-0013 §D4.6).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv } from 'node:process';
import { toJson, toMarkdown } from './report.js';
import { runSuite, type Variant } from './simulate.js';
import { pairingsFor, parseOptions, realVariants } from './variants.js';

function main(): void {
  const options = parseOptions(argv.slice(2));
  const lexicons = realVariants();
  const pairings = pairingsFor(options);
  const variants: Variant[] = [];
  if (options.variants.includes('with')) {
    variants.push({ id: 'with-inflections', lexicon: lexicons.with, pairings: pairings.with });
  }
  if (options.variants.includes('without')) {
    variants.push({
      id: 'without-inflections',
      lexicon: lexicons.without,
      pairings: pairings.without,
    });
  }
  const report = runSuite(
    { masterSeed: options.seed, variants },
    {
      onMatch: (variant, pairing, index) => {
        if ((index + 1) % 100 === 0)
          console.log(`${variant} ${pairing}: ${String(index + 1)} matches`);
      },
    },
  );
  for (const [file, text] of [
    [options.out, toJson(report)],
    [options.markdown, toMarkdown(report)],
  ] as const) {
    const path = resolve(file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    console.log(`wrote ${path}`);
  }
}

main();
