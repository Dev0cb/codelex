#!/usr/bin/env bash
# ADR-0016 §D2: build the `hermes` CLI from the pinned source (tools/hermes/hermes-pin.json).
#
#   build-hermes.sh --check-pin               pin tag == react-native sdks/.hermesv1version; tag still -> pinned commit
#   build-hermes.sh <out-dir>                 check the pin, shallow-clone, verify HEAD, build `hermes`, install <out-dir>/hermes
#   build-hermes.sh --check-version <hermes>  bytecode version of <hermes> == the pinned hermesc's (§D2.5)
#
# Needs (apt): git cmake ninja-build g++ libicu-dev python3; and `pnpm install` (react-native, hermes-compiler).
# The hash of THIS FILE is part of the CI cache key: any change here is a cold build. Keep build inputs in this file.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
pin="$here/hermes-pin.json"
REPIN="Re-pin the Hermes VM per ADR-0016 section D6 and the SDK upgrade checklist, docs/architecture/notes/mobile-app-foundation.md section 2.1 (read sdks/.hermesv1version, resolve the tag to its commit, update tools/hermes/hermes-pin.json)"
repo_url="https://github.com/facebook/hermes.git"

fail() {
  echo "::error::$1"
  echo "$1" >&2
  exit 1
}

tag="$(node -p "require(process.argv[1]).tag" "$pin")"
commit="$(node -p "require(process.argv[1]).commit" "$pin")"
[[ "$tag" =~ ^hermes-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "pin tag '$tag' is malformed"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "pin commit '$commit' is not a full SHA"

# Resolve a module file the way apps/mobile does: "react-native/package.json" from the app,
# anything else (hermes-compiler/package.json) from react-native.
resolve_from_mobile() {
  node -e '
    const { createRequire } = require("node:module");
    const app = createRequire(process.argv[1] + "/apps/mobile/package.json");
    const rn = app.resolve("react-native/package.json");
    const target = process.argv[2];
    process.stdout.write(target === "react-native/package.json" ? rn : createRequire(rn).resolve(target));
  ' "$repo" "$1"
}

check_pin() {
  local rn_pkg rn_tag remote
  rn_pkg="$(resolve_from_mobile react-native/package.json 2>/dev/null)" || fail "react-native does not resolve from apps/mobile (run pnpm install --frozen-lockfile)"
  [[ -f "$(dirname "$rn_pkg")/sdks/.hermesv1version" ]] || fail "react-native sdks/.hermesv1version is missing (the SDK changed how it names the VM tag). $REPIN"
  rn_tag="$(tr -d '[:space:]' < "$(dirname "$rn_pkg")/sdks/.hermesv1version")"
  [[ "$rn_tag" == "$tag" ]] || fail "Hermes pin mismatch: tools/hermes/hermes-pin.json has '$tag' but react-native resolves to '$rn_tag'. $REPIN"
  # Tags can move; the commit is the pin. An annotated tag lists a peeled ^{} line last.
  remote="$(git ls-remote --tags "$repo_url" "refs/tags/$tag" "refs/tags/$tag^{}" | awk '{print $1}' | tail -n 1)"
  [[ "$remote" == "$commit" ]] || fail "tag $tag resolves to '${remote:-nothing}' on $repo_url but the pin says $commit. $REPIN"
  echo "pin ok: $tag -> $commit (equals react-native sdks/.hermesv1version)"
}

pinned_hermesc() {
  local pkg
  pkg="$(resolve_from_mobile hermes-compiler/package.json)" || fail "hermes-compiler does not resolve from react-native"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "$(dirname "$pkg")/hermesc/linux64-bin/hermesc" ;;
    *) fail "no pinned hermesc for $(uname -s)-$(uname -m)" ;;
  esac
}

bytecode_version() { "$1" -version 2>&1 | sed -n 's/.*HBC bytecode version: *\([0-9][0-9]*\).*/\1/p' | head -n 1; }

check_version() {
  local hermes="$1" hermesc a b
  hermesc="$(pinned_hermesc)"
  a="$(bytecode_version "$hermes")"
  b="$(bytecode_version "$hermesc")"
  [[ -n "$a" && -n "$b" ]] || fail "could not read the bytecode version (hermes='$a', hermesc='$b')"
  [[ "$a" == "$b" ]] || fail "re-pin needed: built hermes emits bytecode version $a but the pinned hermesc emits $b. $REPIN"
  echo "bytecode version ok: hermes $a == hermesc $b"
}

case "${1:-}" in
  --check-pin) check_pin; exit 0 ;;
  --check-version) [[ -n "${2:-}" ]] || fail "usage: $0 --check-version <hermes>"; check_version "$2"; exit 0 ;;
  "" | -*) fail "usage: $0 --check-pin | <out-dir> | --check-version <hermes>" ;;
esac

out="$1"
check_pin

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git clone --quiet --depth 1 --branch "$tag" "$repo_url" "$work/src"
head="$(git -C "$work/src" rev-parse HEAD)"
[[ "$head" == "$commit" ]] || fail "cloned $tag is at $head, not the pinned $commit. $REPIN"

cmake -S "$work/src" -B "$work/build" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$work/build" --target hermes -- -j "$(nproc)"

mkdir -p "$out"
install -m 0755 "$work/build/bin/hermes" "$out/hermes"
# The cache holds only this binary: it must run without the build tree.
"$out/hermes" -version
if ldd "$out/hermes" | grep -q "not found"; then fail "hermes has unresolved shared libraries"; fi
ls -l "$out/hermes"
