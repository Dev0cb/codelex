---
name: implement
description: Implement a designed task end-to-end with the owner agent, test-first, then self-verify against the Definition of Done. Use for any coding task that has a spec/design or a clear sprint task.
argument-hint: "<task id or description>"
---

# Implement

Task: $ARGUMENTS

1. Locate the task in the latest `docs/sprints/*.md` or design file; read its acceptance criteria and the design.
   If there is no design and the task crosses services or adds a dependency, run `/design` first.
2. Pick the owner agent from the routing table in `CLAUDE.md`. If several packages are touched, split into
   sub-tasks per owner, contracts first (`packages/protocol`, schemas), then producers, then consumers. Independent
   sub-tasks run in parallel agents; dependent ones sequentially.
3. Instruct each owner agent to: write failing tests from the acceptance criteria → implement minimal code → make
   tests pass → refactor → run `pnpm turbo run lint typecheck test --filter=<pkg>...` and `pnpm validate`.
4. Verify `docs/standards/DEFINITION_OF_DONE.md` item by item; fix gaps (docs, flags, events, i18n, a11y).
5. Run `/review` on the diff. Address all Blocker/Major findings, re-run checks.
6. Commit with Conventional Commits, one logical change per commit. Update the sprint table status.
