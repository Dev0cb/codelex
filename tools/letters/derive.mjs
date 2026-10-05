#!/usr/bin/env node
// Letter-table derivation (docs/game/BALANCE.md "Letter values & distribution derivation", R-BAG-001 steps 1–5).
// Offline tool owned by game-designer. The engine never runs it: its output is copied by hand into
// packages/game-engine/src/rules/constants.ts as a frozen table of one engineRulesVersion (ADR-0013 §D5,
// ADR-0014 §D1), together with a derivation record in BALANCE.md.
//
// Usage:
//   node tools/letters/derive.mjs [--data <packages/lexicon/data dir>] [--json]
// Prints the record (inputs, every step, adjustments, final table). Deterministic: same lexicon data → same
// output, byte for byte. Pure functions are exported for tests (tools/letters/derive.test.mjs).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Step 4: the eight letters that anchor value 1 (`f_min` is the smallest `f` among them). */
export const ANCHORS = "EAIONRST";
/** Step 5b: vowels for the vowel cap (Y is not a vowel here, as in letters-v1). */
export const VOWELS = "AEIOU";
export const LETTERED_TILES = 98;
export const BLANKS = 2;
export const EXPONENT = 0.75;
export const K_FACTOR = 1.49;
export const VOWEL_CAP = 2;
export const TOP_CAP = 8;
export const MAX_VALUE = 10;
/** Step 5a threshold: `98 · f ≥ 1.5` earns a second tile. */
export const ANTI_SINGLETON = 1.5;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Step 1: the corpus. Every distinct playable form (canonical and curated inflections), counted once.
 * @param {Iterable<string>} forms
 * @returns {string[]} sorted, unique
 */
export function corpus(forms) {
  const set = new Set();
  for (const form of forms) {
    if (!/^[A-Z]{2,15}$/.test(form))
      throw new RangeError(`form outside [A-Z]{2,15}: ${form}`);
    set.add(form);
  }
  return [...set].sort(byCodeUnit);
}

/** Step 2 input: occurrences per letter over the corpus. */
export function letterOccurrences(forms) {
  const occ = Object.fromEntries([...LETTERS].map((l) => [l, 0]));
  for (const form of forms) for (const ch of form) occ[ch] += 1;
  return occ;
}

/**
 * Steps 2–5 from letter occurrences. Every adjustment is listed in `adjustments`, in the order applied.
 * @param {Record<string, number>} occ occurrences per letter A–Z (every letter ≥ 1)
 */
export function deriveFromOccurrences(occ) {
  const total = [...LETTERS].reduce((s, l) => s + occ[l], 0);
  const missing = [...LETTERS].filter((l) => !(occ[l] >= 1));
  if (missing.length > 0)
    throw new RangeError(`letters absent from the corpus: ${missing.join("")}`);

  // Step 2: frequency. Step 3: counts (floor with a one-tile minimum, then largest remainder).
  const f = Object.fromEntries([...LETTERS].map((l) => [l, occ[l] / total]));
  const quota = Object.fromEntries(
    [...LETTERS].map((l) => [l, LETTERED_TILES * f[l]]),
  );
  const step3 = Object.fromEntries(
    [...LETTERS].map((l) => [l, Math.max(1, Math.floor(quota[l]))]),
  );
  let remaining =
    LETTERED_TILES - [...LETTERS].reduce((s, l) => s + step3[l], 0);
  if (remaining < 0)
    throw new RangeError("one-tile floor exceeds the lettered tiles");
  const remainderOrder = [...LETTERS]
    .filter((l) => quota[l] >= 1)
    .sort(
      (a, b) =>
        quota[b] - Math.floor(quota[b]) - (quota[a] - Math.floor(quota[a])) ||
        byCodeUnit(a, b),
    );
  const roundedUp = new Set();
  for (const l of remainderOrder) {
    if (remaining === 0) break;
    step3[l] += 1;
    roundedUp.add(l);
    remaining -= 1;
  }
  if (remaining !== 0)
    throw new RangeError("largest remainder could not place every tile");

  // Step 4: values.
  const fMin = Math.min(...[...ANCHORS].map((l) => f[l]));
  const k = K_FACTOR * fMin ** EXPONENT;
  const step4 = Object.fromEntries(
    [...LETTERS].map((l) => [
      l,
      Math.min(MAX_VALUE, Math.max(1, Math.round(k / f[l] ** EXPONENT))),
    ]),
  );

  const counts = { ...step3 };
  const values = { ...step4 };
  const adjustments = [];

  // 5a anti-singleton. Donor: a letter rounded up in step 3, highest count; ties: larger quota, then A–Z.
  const singletons = [...LETTERS]
    .filter((l) => counts[l] === 1 && quota[l] >= ANTI_SINGLETON)
    .sort((a, b) => quota[b] - quota[a] || byCodeUnit(a, b));
  for (const l of singletons) {
    const donor = [...roundedUp]
      .filter((d) => counts[d] > 2 && d !== l)
      .sort(
        (a, b) =>
          counts[b] - counts[a] || quota[b] - quota[a] || byCodeUnit(a, b),
      )[0];
    if (donor === undefined)
      throw new RangeError(`no donor for the anti-singleton tile of ${l}`);
    roundedUp.delete(donor);
    counts[donor] -= 1;
    counts[l] += 1;
    adjustments.push({
      rule: "5a",
      letter: l,
      field: "count",
      from: 1,
      to: 2,
      note: `98·f = ${quota[l].toFixed(2)}; tile taken from ${donor} (${counts[donor] + 1} → ${counts[donor]}, 98·f = ${quota[donor].toFixed(2)})`,
    });
  }

  // 5b vowel cap.
  for (const l of VOWELS) {
    if (values[l] > VOWEL_CAP) {
      adjustments.push({
        rule: "5b",
        letter: l,
        field: "value",
        from: values[l],
        to: VOWEL_CAP,
      });
      values[l] = VOWEL_CAP;
    }
  }

  // 5c top cap: 10 only for the single rarest letter (a tie for rarest leaves no letter at 10).
  const rarest = [...LETTERS].filter(
    (l) => occ[l] === Math.min(...[...LETTERS].map((x) => occ[x])),
  );
  for (const l of LETTERS) {
    const keeps10 = rarest.length === 1 && rarest[0] === l;
    if (!keeps10 && values[l] > TOP_CAP) {
      adjustments.push({
        rule: "5c",
        letter: l,
        field: "value",
        from: values[l],
        to: TOP_CAP,
      });
      values[l] = TOP_CAP;
    }
  }

  // 5d monotonic: walking from frequent to rare, a value never drops (vowels capped by 5b are exempt and listed).
  const byFrequency = [...LETTERS].sort(
    (a, b) => occ[b] - occ[a] || byCodeUnit(a, b),
  );
  const monotonicExceptions = [];
  let floor = 1;
  for (const l of byFrequency) {
    if (VOWELS.includes(l) && values[l] === VOWEL_CAP && step4[l] > VOWEL_CAP) {
      if (floor > values[l]) monotonicExceptions.push(l);
      continue;
    }
    if (values[l] < floor) {
      adjustments.push({
        rule: "5d",
        letter: l,
        field: "value",
        from: values[l],
        to: floor,
      });
      values[l] = floor;
    }
    floor = Math.max(floor, values[l]);
  }

  const countList = [...LETTERS].map((l) => counts[l]);
  const valueList = [...LETTERS].map((l) => values[l]);
  const vowelTiles = [...VOWELS].reduce((s, l) => s + counts[l], 0);
  const letteredValueSum = [...LETTERS].reduce(
    (s, l) => s + counts[l] * values[l],
    0,
  );
  return {
    totalLetters: total,
    occurrences: occ,
    frequency: f,
    quota,
    fMin,
    k,
    step3Counts: step3,
    step4Values: step4,
    adjustments,
    monotonicExceptions,
    counts: countList,
    values: valueList,
    blanks: BLANKS,
    blankValue: 0,
    summary: {
      tiles: countList.reduce((s, n) => s + n, 0) + BLANKS,
      vowelTiles,
      letteredValueSum,
      meanLetteredValue: letteredValueSum / LETTERED_TILES,
      valueRange: [Math.min(...valueList), Math.max(...valueList)],
    },
  };
}

/** Steps 1–5 from a list of playable forms. */
export function deriveLetterTable(forms) {
  const unique = corpus(forms);
  return {
    forms: unique.length,
    ...deriveFromOccurrences(letterOccurrences(unique)),
  };
}

const pct = (x) => (100 * x).toFixed(2);

/** Human-readable record, ordered by descending occurrences (the BALANCE.md record layout). */
export function formatRecord(meta, d) {
  const order = [...LETTERS].sort(
    (a, b) => d.occurrences[b] - d.occurrences[a] || byCodeUnit(a, b),
  );
  const row = (label, fn) => `| ${label} | ${order.map(fn).join(" | ")} |`;
  const lines = [
    `lexiconVersion ${meta.lexiconVersion}, profile ${meta.profileId} (definitionHash ${meta.definitionHash})`,
    `corpus: ${d.forms} distinct playable forms, ${d.totalLetters} letters, unweighted`,
    `f_min ${pct(d.fMin)} %, k ${d.k.toFixed(6)}`,
    "",
    `| | ${order.join(" | ")} |`,
    `|---|${order.map(() => "---").join("|")}|`,
    row("occurrences", (l) => String(d.occurrences[l])),
    row("f (%)", (l) => pct(d.frequency[l])),
    row("98·f", (l) => d.quota[l].toFixed(2)),
    row("counts (step 3)", (l) => String(d.step3Counts[l])),
    row("**counts v2**", (l) => String(d.counts[LETTERS.indexOf(l)])),
    row("values (step 4)", (l) => String(d.step4Values[l])),
    row("**values v2**", (l) => String(d.values[LETTERS.indexOf(l)])),
    "",
    "adjustments:",
    ...d.adjustments.map(
      (a) =>
        `  ${a.rule} ${a.letter} ${a.field} ${a.from} → ${a.to}${a.note ? ` (${a.note})` : ""}`,
    ),
    `monotonic exceptions (vowel cap wins): ${d.monotonicExceptions.join(", ") || "none"}`,
    "",
    `A–Z counts: [${d.counts.join(", ")}]`,
    `A–Z values: [${d.values.join(", ")}]`,
    `tiles ${d.summary.tiles} (${d.blanks} blanks), vowels ${d.summary.vowelTiles}, lettered value sum ` +
      `${d.summary.letteredValueSum} (mean ${d.summary.meanLetteredValue.toFixed(2)}), range ` +
      `${d.summary.valueRange[0]}–${d.summary.valueRange[1]}`,
  ];
  return lines.join("\n");
}

export const USAGE =
  "usage: node tools/letters/derive.mjs [--data <packages/lexicon/data dir>] [--json]";

/** Parses the CLI arguments; throws a usage error (never a TypeError) on a bad command line. */
export function parseArgs(argv) {
  const opts = { data: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--data") {
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("--"))
        throw new Error(`--data needs a directory path\n${USAGE}`);
      opts.data = resolve(value);
      i++;
    } else throw new Error(`unknown argument: ${arg}\n${USAGE}`);
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const lexicon = await import("../../packages/lexicon/scripts/validate.mjs");
  const canonical =
    await import("../../packages/lexicon/scripts/canonical.mjs");
  const lex = lexicon.loadLexicon(opts.data);
  const { errors } = lexicon.validateLexicon(lex);
  if (errors.length > 0)
    throw new Error(
      `lexicon invalid (${errors.length} errors): run pnpm lexicon:validate`,
    );
  // Global ranked profile (`include.all`): every playable form, inflections included (step 1).
  const forms = lexicon.playableForms(lex).map((p) => p.form);
  const meta = {
    lexiconVersion: canonical.computeLexiconVersion(lex),
    profileId: canonical.GLOBAL_PROFILE.id,
    definitionHash: canonical.profileDefinitionHash(canonical.GLOBAL_PROFILE),
  };
  const derived = deriveLetterTable(forms);
  process.stdout.write(
    opts.json
      ? `${JSON.stringify({ ...meta, ...derived }, null, 2)}\n`
      : `${formatRecord(meta, derived)}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
