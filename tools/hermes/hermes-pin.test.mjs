// ADR-0016 §D2.1: the Hermes pin must match what apps/mobile ships. Offline only: it reads the installed
// react-native and hermes-compiler packages; the tag → commit resolution (`git ls-remote`) and the npm `gitHead`
// (absent from the installed package.json) are checked by the CI job and the re-pin step (§D6), not here.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const pin = JSON.parse(readFileSync(join(here, "hermes-pin.json"), "utf8"));
const RE_PIN =
  "Re-pin: see ADR-0016 §D6 and docs/architecture/notes/mobile-app-foundation.md §2.1";

/** react-native and hermes-compiler as resolved from apps/mobile, or undefined before `pnpm install`. */
function installed() {
  const mobile = join(repo, "apps", "mobile", "package.json");
  const fromMobile = createRequire(mobile);
  let rnPackage;
  try {
    rnPackage = fromMobile.resolve("react-native/package.json");
  } catch {
    return undefined;
  }
  const rnRoot = dirname(rnPackage);
  const compiler = JSON.parse(
    readFileSync(
      createRequire(rnPackage).resolve("hermes-compiler/package.json"),
      "utf8",
    ),
  );
  return { rnRoot, compiler };
}

test("the pin has a tag of the V1 line and a full commit SHA", () => {
  assert.deepEqual(Object.keys(pin).sort(), ["$comment", "commit", "tag"]);
  assert.match(pin.tag, /^hermes-v\d+\.\d+\.\d+$/);
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
});

test("the tag equals react-native sdks/.hermesv1version of apps/mobile", (t) => {
  const found = installed();
  if (found === undefined)
    return t.skip("react-native is not installed (run pnpm install)");
  const file = join(found.rnRoot, "sdks", ".hermesv1version");
  assert.ok(
    existsSync(file),
    `${file} missing: the SDK may have changed which file names the VM tag (ADR-0016 revisit trigger)`,
  );
  assert.equal(readFileSync(file, "utf8").trim(), pin.tag, RE_PIN);
});

test("the tag names the hermes-compiler version react-native depends on (same release as hermesc)", (t) => {
  const found = installed();
  if (found === undefined)
    return t.skip("react-native is not installed (run pnpm install)");
  assert.equal(`hermes-v${found.compiler.version}`, pin.tag, RE_PIN);
});

test("the commit equals the hermes-compiler gitHead when the installed package records it", (t) => {
  const found = installed();
  if (found === undefined)
    return t.skip("react-native is not installed (run pnpm install)");
  if (typeof found.compiler.gitHead !== "string") {
    return t.skip(
      "hermes-compiler package.json has no gitHead offline (npm view hermes-compiler gitHead)",
    );
  }
  assert.equal(found.compiler.gitHead, pin.commit, RE_PIN);
});
