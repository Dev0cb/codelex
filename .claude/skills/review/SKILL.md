---
name: review
description: Multi-agent review of the current diff (or a branch/PR) — correctness, security, tests and domain rules in parallel — and a consolidated verdict. Use before every commit to main or PR.
argument-hint: "[base ref, default origin/main]"
---

# Review

Base: ${ARGUMENTS:-origin/main}

1. Collect the diff: `git diff <base>...HEAD` plus uncommitted changes. List touched packages.
2. Launch in parallel (single message, multiple agents):
   - `code-reviewer` — always.
   - `security-engineer` — if auth, commerce, protocol, integrity, PII, infra, dependencies or results of ranked
     play are touched.
   - `qa-engineer` — verify each acceptance criterion has a test; propose missing cases.
   - `game-designer` — if `packages/game-engine`, `packages/bots`, lexicon values or balance are touched.
   - `privacy-compliance` — if new personal data or analytics events.
3. Deduplicate findings; verify each Blocker/Major yourself by reading the code (drop false positives, say why).
4. Output one table: Severity | path:line | finding | fix | raised by. Verdict: APPROVE / REQUEST_CHANGES.
