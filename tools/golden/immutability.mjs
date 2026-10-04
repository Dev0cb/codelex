#!/usr/bin/env node
// Golden-immutability check (ADR-0013 §D8, ADR-0014 §D3, sprint task P3). Fails when a change set modifies, deletes,
// renames or type-changes a published golden file, or removes/edits an existing entry of an append-only JSON file.
// Added files are allowed. Zero dependencies: runs before `pnpm install`. Protected paths: tools/golden/protected-paths.json.
//
//   node tools/golden/immutability.mjs                      CI: base from env (see resolveBase), head = HEAD
//   node tools/golden/immutability.mjs --base <ref> [--head <ref>]
//
// CI env: EVENT_NAME (pull_request | push), BASE_REF (PR target branch), BEFORE_SHA (push: previous tip).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = join(HERE, "protected-paths.json");
const ZERO_SHA = /^0+$/;

export function loadConfig(path = CONFIG_PATH) {
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  for (const key of ["immutable", "appendOnlyJson"]) {
    if (
      !Array.isArray(cfg[key]) ||
      cfg[key].some((p) => typeof p !== "string")
    ) {
      throw new Error(`${path}: "${key}" must be an array of strings`);
    }
  }
  return cfg;
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++; // `a/**/b` also matches `a/b`
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Reasons `b` (head value) does not preserve `a` (base value): leaves equal, objects may gain keys, arrays may grow at the end. */
export function preserves(a, b, path = "$") {
  if (a !== null && typeof a === "object") {
    if (
      b === null ||
      typeof b !== "object" ||
      Array.isArray(a) !== Array.isArray(b)
    )
      return [`${path} changed type`];
    if (Array.isArray(a)) {
      if (b.length < a.length)
        return [`${path} lost entries (${a.length} -> ${b.length})`];
      return a.flatMap((v, i) => preserves(v, b[i], `${path}[${i}]`));
    }
    return Object.keys(a).flatMap((k) =>
      k in b
        ? preserves(a[k], b[k], `${path}.${k}`)
        : [`${path}.${k} was removed`],
    );
  }
  return Object.is(a, b)
    ? []
    : [`${path} changed (${JSON.stringify(a)} -> ${JSON.stringify(b)})`];
}

/** Pure core. `changes`: [{status, path}] from `diff --name-status --no-renames`; `readJson(side, path)` returns parsed JSON or undefined. */
export function findViolations(changes, config, readJson) {
  const immutable = config.immutable.map(globToRegExp);
  const appendOnly = new Set(config.appendOnlyJson);
  const out = [];
  for (const { status, path } of changes) {
    if (status === "A") continue;
    if (immutable.some((re) => re.test(path))) {
      out.push(
        `${path}: ${status === "D" ? "deleted" : "modified"} (published golden files are immutable)`,
      );
    } else if (appendOnly.has(path)) {
      if (status === "D") {
        out.push(`${path}: deleted (append-only file)`);
        continue;
      }
      let before;
      let after;
      try {
        before = readJson("base", path);
        after = readJson("head", path);
      } catch (error) {
        out.push(`${path}: not valid JSON on one side (${error.message})`);
        continue;
      }
      if (before === undefined) continue;
      for (const why of preserves(before, after))
        out.push(`${path}: ${why} (frozen entries never change)`);
    }
  }
  return out;
}

function vcs(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function resolveBase(
  { eventName, baseRef, beforeSha },
  cwd,
  head = "HEAD",
) {
  if (eventName === "pull_request") {
    if (!baseRef) throw new Error("pull_request without BASE_REF");
    return vcs(["merge-base", `origin/${baseRef}`, head], cwd).trim();
  }
  if (beforeSha && !ZERO_SHA.test(beforeSha)) {
    try {
      vcs(["cat-file", "-e", `${beforeSha}^{commit}`], cwd);
      return beforeSha;
    } catch {
      // force-push or shallow history: fall through to the parent commit
    }
  }
  return vcs(["rev-parse", `${head}~1`], cwd).trim();
}

export function diffChanges(base, head, cwd) {
  const raw = vcs(
    ["diff", "--name-status", "--no-renames", "-z", base, head],
    cwd,
  );
  const parts = raw.split("\0").filter(Boolean);
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2)
    changes.push({ status: parts[i][0], path: parts[i + 1] });
  return changes;
}

export function check({
  base,
  head = "HEAD",
  cwd = process.cwd(),
  config = loadConfig(),
}) {
  const changes = diffChanges(base, head, cwd);
  const readJson = (side, path) => {
    const ref = side === "base" ? base : head;
    let text;
    try {
      text = vcs(["show", `${ref}:${path}`], cwd);
    } catch {
      return undefined;
    }
    return JSON.parse(text);
  };
  return {
    changes: changes.length,
    violations: findViolations(changes, config, readJson),
  };
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const head = opt("--head") ?? "HEAD";
  const base =
    opt("--base") ??
    resolveBase(
      {
        eventName: process.env.EVENT_NAME,
        baseRef: process.env.BASE_REF,
        beforeSha: process.env.BEFORE_SHA,
      },
      process.cwd(),
      head,
    );
  const { changes, violations } = check({ base, head });
  if (violations.length > 0) {
    for (const v of violations)
      console.error(`::error::golden-immutability: ${v}`);
    console.error(
      `\nPublished goldens are immutable (ADR-0013 §D8, ADR-0014 §D3). Add a new file or a new rules version instead; ` +
        `draft goldens live in test/golden/drafts/.`,
    );
    return 1;
  }
  console.log(
    `golden-immutability: ok (${changes} changed file(s) since ${base.slice(0, 12)})`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)));
