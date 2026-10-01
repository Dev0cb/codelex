---
name: ship
description: Production-readiness and rollout for a finished feature or service — flags, migrations order, dashboards, alerts, runbooks, load test, rollback plan, release notes. Use before enabling anything for real players.
argument-hint: "<feature or service>"
---

# Ship

Target: $ARGUMENTS

Run the checklist in `docs/standards/PRODUCTION_READINESS.md` with these agents in parallel:
- `devops-sre`: deploy plan (expand → deploy → migrate → contract), SLOs, dashboards, burn-rate alerts, runbook,
  capacity and cost estimate, rollback rehearsal.
- `qa-engineer`: release QA and go/no-go criteria; load test at 2× forecast peak for realtime-facing changes.
- `security-engineer`: final security sign-off (threat model mitigations done).
- `data-analyst`: events verified in staging, dashboard ready, experiment configured if any.
- `tech-writer`: changelog, player-facing release notes EN/FR.

Rollout: internal → 1% → 10% → 50% → 100% with explicit guardrail metrics and automatic halt conditions.
Output: the filled checklist with PASS/FAIL per item and a GO / NO-GO recommendation. Never enable to 100%
without the human's explicit approval.
