import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  check,
  findViolations,
  globToRegExp,
  loadConfig,
  preserves,
  resolveBase,
} from "./immutability.mjs";

const G = "packages/game-engine/test/golden";
const config = loadConfig();

describe("globToRegExp", () => {
  it("handles * and **", () => {
    assert.ok(globToRegExp("a/v*/**").test("a/v1/x/y.json"));
    assert.ok(!globToRegExp("a/v*/**").test("a/drafts/v1/x.json"));
    assert.ok(globToRegExp("a/**/b").test("a/b"));
    assert.ok(!globToRegExp("a/*.json").test("a/x/y.json"));
  });
});

describe("preserves", () => {
  it("allows additions, rejects edits and removals", () => {
    assert.deepEqual(
      preserves({ a: 1, l: [1] }, { a: 1, b: 2, l: [1, 2] }),
      [],
    );
    assert.equal(preserves({ a: 1 }, { a: 2 }).length, 1);
    assert.equal(preserves({ a: 1 }, {}).length, 1);
    assert.equal(preserves({ l: [1, 2] }, { l: [1] }).length, 1);
    assert.equal(preserves({ a: {} }, { a: [] }).length, 1);
  });
});

describe("findViolations (pure)", () => {
  const none = () => undefined;
  it("allows added files, even under protected paths", () => {
    assert.deepEqual(
      findViolations(
        [{ status: "A", path: `${G}/replays/v1/new.json` }],
        config,
        none,
      ),
      [],
    );
  });
  it("flags modify/delete/type-change of replays/v1, scoring and the three vectors", () => {
    const paths = [
      "replays/v1/gc-det-01.json",
      "scoring/v1/classic.json",
      "rng.json",
      "sha256.json",
      "jcs.json",
    ];
    for (const p of paths) {
      for (const status of ["M", "D", "T"]) {
        assert.equal(
          findViolations([{ status, path: `${G}/${p}` }], config, none).length,
          1,
          `${status} ${p}`,
        );
      }
    }
  });
  it("treats a future frozen version folder as protected and drafts as mutable", () => {
    assert.equal(
      findViolations(
        [{ status: "M", path: `${G}/replays/v2/a.json` }],
        config,
        none,
      ).length,
      1,
    );
    assert.deepEqual(
      findViolations(
        [{ status: "M", path: `${G}/drafts/v2/a.json` }],
        config,
        none,
      ),
      [],
    );
  });
  it("ignores unrelated files", () => {
    assert.deepEqual(
      findViolations([{ status: "M", path: "README.md" }], config, none),
      [],
    );
  });
  it("append-only JSON: growth ok, edit/removal/delete flagged, absent base ok", () => {
    const p = `${G}/rules-digests.json`;
    const run = (b, h, status = "M") =>
      findViolations([{ status, path: p }], config, (side) =>
        side === "base" ? b : h,
      );
    assert.deepEqual(run({ 1: "aa" }, { 1: "aa", 2: "bb" }), []);
    assert.equal(run({ 1: "aa" }, { 1: "zz" }).length, 1);
    assert.equal(run({ 1: "aa" }, {}).length, 1);
    assert.equal(run({ 1: "aa" }, undefined, "D").length, 1);
    assert.deepEqual(run(undefined, { 1: "aa" }), []);
  });
});

describe("check (real repository)", () => {
  let dir;
  const vcs = (...a) =>
    execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const commit = (msg) => {
    vcs("add", "-A");
    vcs("commit", "-q", "-m", msg);
    return vcs("rev-parse", "HEAD");
  };
  let base;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "golden-"));
    vcs("init", "-q", "-b", "main");
    vcs("config", "user.email", "t@example.com");
    vcs("config", "user.name", "t");
    vcs("config", "commit.gpgsign", "false");
    write(`${G}/replays/v1/a.json`, '{"x":1}');
    write(`${G}/rules-digests.json`, '{"1":"aa"}');
    write(`${G}/drafts/v2/d.json`, '{"d":1}');
    base = commit("base");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (head) => check({ base, head, cwd: dir, config });

  it("passes: additions, draft edits, digest append", () => {
    vcs("checkout", "-q", "-b", "ok", base);
    write(`${G}/replays/v1/b.json`, "{}");
    write(`${G}/drafts/v2/d.json`, '{"d":2}');
    write(`${G}/rules-digests.json`, '{"1":"aa","2":"bb"}');
    assert.deepEqual(run(commit("ok")).violations, []);
  });
  it("fails: edit of replays/v1", () => {
    vcs("checkout", "-q", "-b", "edit", base);
    write(`${G}/replays/v1/a.json`, '{"x":2}');
    assert.equal(run(commit("edit")).violations.length, 1);
  });
  it("fails: delete and rename (rename = delete + add)", () => {
    vcs("checkout", "-q", "-b", "del", base);
    unlinkSync(join(dir, `${G}/replays/v1/a.json`));
    assert.equal(run(commit("del")).violations.length, 1);
    vcs("checkout", "-q", "-b", "mv", base);
    renameSync(
      join(dir, `${G}/replays/v1/a.json`),
      join(dir, `${G}/replays/v1/renamed.json`),
    );
    assert.equal(run(commit("mv")).violations.length, 1);
  });
  it("fails: editing a frozen digest; whitespace-only reformat is fine", () => {
    vcs("checkout", "-q", "-b", "dig", base);
    write(`${G}/rules-digests.json`, '{"1":"changed"}');
    assert.equal(run(commit("dig")).violations.length, 1);
    vcs("checkout", "-q", "-b", "ws", base);
    write(`${G}/rules-digests.json`, '{ "1": "aa" }\n');
    assert.deepEqual(run(commit("ws")).violations, []);
  });
  it("resolveBase: PR uses the merge base, push uses BEFORE_SHA then the parent", () => {
    vcs("update-ref", "refs/remotes/origin/main", base);
    vcs("checkout", "-q", "ok");
    assert.equal(
      resolveBase({ eventName: "pull_request", baseRef: "main" }, dir),
      base,
    );
    assert.equal(
      resolveBase({ eventName: "push", beforeSha: base }, dir),
      base,
    );
    const parent = vcs("rev-parse", "HEAD~1");
    assert.equal(
      resolveBase({ eventName: "push", beforeSha: "0".repeat(40) }, dir),
      parent,
    );
    assert.equal(
      resolveBase({ eventName: "push", beforeSha: "f".repeat(40) }, dir),
      parent,
    );
  });
});
