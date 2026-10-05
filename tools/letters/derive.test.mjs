import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computeLexiconVersion } from "../../packages/lexicon/scripts/canonical.mjs";
import {
  loadLexicon,
  playableForms,
} from "../../packages/lexicon/scripts/validate.mjs";
import {
  corpus,
  deriveFromOccurrences,
  deriveLetterTable,
  parseArgs,
} from "./derive.mjs";

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

// BALANCE.md "Derivation record — letters-v2": occurrences of the 2,154-form batch-3 corpus (14,745 letters).
// Pinned so that the reproduction holds forever, whatever the lexicon in the tree becomes.
const V2_OCCURRENCES = {
  E: 1540,
  S: 1459,
  A: 1176,
  T: 1140,
  R: 1103,
  O: 1051,
  I: 963,
  N: 817,
  C: 716,
  L: 631,
  P: 581,
  D: 565,
  M: 449,
  U: 417,
  G: 404,
  B: 324,
  H: 321,
  K: 251,
  F: 224,
  Y: 164,
  W: 146,
  V: 128,
  X: 70,
  J: 43,
  Z: 34,
  Q: 28,
};
const V2_ADJUSTMENTS = ["5a K 1→2", "5c J 10→8", "5c X 9→8", "5c Z 10→8"];

test("the procedure reproduces letters-v2 and its adjustments from the recorded occurrences (always runs)", () => {
  const d = deriveFromOccurrences(V2_OCCURRENCES);
  assert.equal(d.totalLetters, 14745);
  assert.deepEqual(d.counts, V2.counts);
  assert.deepEqual(d.values, V2.values);
  assert.deepEqual(
    d.adjustments.map((a) => `${a.rule} ${a.letter} ${a.from}→${a.to}`),
    V2_ADJUSTMENTS,
  );
  assert.deepEqual(d.monotonicExceptions, []);
  assert.equal(d.summary.tiles, 100);
  assert.equal(d.summary.vowelTiles, 34);
  assert.equal(d.summary.letteredValueSum, 185);
});

// Extra check while the tree still holds the input lexicon: the recorded occurrences are the lexicon's.
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
  assert.deepEqual(d.occurrences, V2_OCCURRENCES);
  assert.deepEqual(d.counts, V2.counts);
  assert.deepEqual(d.values, V2.values);
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

test("--data without a path is a usage error, not a TypeError (CLI exits 1 with usage)", () => {
  for (const argv of [["--data"], ["--data", ""], ["--data", "--json"]]) {
    assert.throws(
      () => parseArgs(argv),
      (e) =>
        !(e instanceof TypeError) &&
        /--data needs a directory path/.test(e.message) &&
        /usage:/.test(e.message),
    );
  }
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument: --bogus/);
  assert.deepEqual(parseArgs(["--json"]), { data: undefined, json: true });
  let failed;
  try {
    execFileSync(process.execPath, [CLI, "--data"], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (e) {
    failed = e;
  }
  assert.ok(failed, "the CLI must fail");
  assert.equal(failed.status, 1);
  assert.match(String(failed.stderr), /--data needs a directory path/);
  assert.match(String(failed.stderr), /usage:/);
  assert.doesNotMatch(String(failed.stderr), /TypeError/);
});
