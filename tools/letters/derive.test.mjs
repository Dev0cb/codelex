import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeLexiconVersion } from "../../packages/lexicon/scripts/canonical.mjs";
import {
  loadLexicon,
  playableForms,
} from "../../packages/lexicon/scripts/validate.mjs";
import { corpus, deriveFromOccurrences, deriveLetterTable } from "./derive.mjs";

const CLI = fileURLToPath(new URL("./derive.mjs", import.meta.url));

// BALANCE.md "Derivation record — letters-v1": occurrences of the 310-form corpus (commit 9ab12ff).
const V1_OCCURRENCES = {
  E: 186,
  R: 176,
  A: 167,
  T: 160,
  O: 152,
  I: 145,
  N: 131,
  S: 129,
  C: 102,
  L: 93,
  P: 77,
  U: 58,
  D: 57,
  M: 54,
  G: 53,
  H: 51,
  B: 46,
  Y: 32,
  F: 30,
  K: 29,
  W: 25,
  V: 21,
  X: 12,
  Q: 9,
  J: 8,
  Z: 4,
};

test("the procedure reproduces the frozen letters-v1 table and its recorded adjustments exactly", () => {
  const d = deriveFromOccurrences(V1_OCCURRENCES);
  assert.deepEqual(
    d.counts,
    [
      8, 2, 5, 3, 9, 1, 3, 2, 7, 1, 1, 4, 3, 6, 7, 4, 1, 8, 6, 8, 3, 1, 1, 1, 2,
      1,
    ],
  );
  assert.deepEqual(
    d.values,
    [
      1, 3, 2, 3, 1, 4, 3, 3, 1, 8, 5, 2, 3, 1, 1, 2, 8, 1, 1, 1, 2, 6, 5, 8, 4,
      10,
    ],
  );
  assert.deepEqual(
    d.adjustments.map((a) => `${a.rule} ${a.letter} ${a.from}→${a.to}`),
    ["5a Y 1→2", "5b U 3→2", "5c J 10→8", "5c Q 10→8", "5c X 9→8"],
  );
  assert.equal(d.summary.tiles, 100);
  assert.equal(d.summary.vowelTiles, 34);
  assert.equal(d.summary.letteredValueSum, 192);
});

// L7 record (BALANCE.md "Derivation record — letters-v2"), pinned to its input lexiconVersion.
const V2_INPUT = "e568477b5592a994";
const V2 = {
  counts: [
    8, 2, 5, 4, 10, 1, 2, 2, 6, 1, 2, 4, 3, 5, 7, 4, 1, 7, 9, 7, 3, 1, 1, 1, 1,
    1,
  ],
  values: [
    1, 3, 2, 2, 1, 4, 3, 3, 1, 8, 4, 2, 2, 1, 1, 2, 10, 1, 1, 1, 2, 6, 5, 8, 5,
    8,
  ],
};

test("letters-v2 reproduces from the batch-3 lexicon it was derived from", (t) => {
  const lex = loadLexicon();
  const version = computeLexiconVersion(lex);
  if (version !== V2_INPUT) {
    // The record names its input; a later lexicon is a re-derivation (new review), not a regression.
    t.skip(`lexiconVersion ${version} is not the letters-v2 input ${V2_INPUT}`);
    return;
  }
  const d = deriveLetterTable(playableForms(lex).map((p) => p.form));
  assert.equal(d.forms, 2154);
  assert.equal(d.totalLetters, 14745);
  assert.deepEqual(d.counts, V2.counts);
  assert.deepEqual(d.values, V2.values);
  assert.deepEqual(
    d.adjustments.map((a) => `${a.rule} ${a.letter} ${a.from}→${a.to}`),
    ["5a K 1→2", "5c J 10→8", "5c X 9→8", "5c Z 10→8"],
  );
  assert.deepEqual(d.monotonicExceptions, []);
});

test("the CLI output is deterministic", () => {
  const run = () =>
    execFileSync(process.execPath, [CLI, "--json"], { encoding: "utf8" });
  const a = run();
  assert.equal(run(), a);
  assert.ok(JSON.parse(a).lexiconVersion.length === 16);
});

test("corpus counts each form once and rejects non A–Z forms", () => {
  assert.deepEqual(corpus(["API", "AI", "API"]), ["AI", "API"]);
  assert.throws(() => corpus(["K8S"]), RangeError);
});

test("a letter missing from the corpus is refused (every letter needs at least one tile)", () => {
  assert.throws(
    () => deriveFromOccurrences({ ...V1_OCCURRENCES, Q: 0 }),
    RangeError,
  );
});

test("5c with a tie for the rarest letter leaves no letter at 10", () => {
  const d = deriveFromOccurrences({ ...V1_OCCURRENCES, J: 4 });
  assert.equal(d.values.filter((v) => v === 10).length, 0);
  assert.ok(d.adjustments.some((a) => a.rule === "5c" && a.letter === "Z"));
});
