---
name: sprint-plan
description: Plan the next increment of CODELEX from docs/roadmap/ROADMAP.md — pick the next epic(s) of the current phase, break them into ordered, owner-assigned tasks with acceptance criteria and dependencies, and write the sprint file. Use at the start of each iteration or when asked "what's next?".
argument-hint: "[phase or epic id, optional]"
---

# Sprint planning

Target: $ARGUMENTS (default: the first unfinished epic of the current phase in `docs/roadmap/ROADMAP.md`).

1. Read `docs/roadmap/ROADMAP.md`, the latest file in `docs/sprints/` (if any) and `git log --oneline -30` to know
   what is done. Never re-plan finished work.
2. Select the epic(s). Check exit criteria of the current phase; if all are met, propose moving to the next phase
   and stop for confirmation.
3. For each epic, delegate in parallel:
   - `product-strategist`: confirm scope/slicing and KPIs (does a spec exist in `docs/specs/`? if not, the first
     task is `/feature-spec`).
   - `solution-architect`: identify design/ADR prerequisites and cross-service contracts.
4. Produce `docs/sprints/YYYY-MM-DD-<slug>.md` with a table:
   `ID | Task | Owner agent | Depends on | Acceptance criteria | Size (S/M/L) | Status`.
   Order tasks so contracts (protocol, schemas, ADRs) come before implementations, and tests before code.
5. Create tasks with TaskCreate mirroring the table so progress is tracked in-session.
6. Reply with the sprint goal (one sentence), the table, and the recommended first 3 tasks to start in parallel.
