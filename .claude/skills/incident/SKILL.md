---
name: incident
description: Structured incident response and blameless postmortem for production issues (outage, latency, matchmaking stuck, cheating wave, bad lexicon publish, payment failures). Use when something is broken for players.
argument-hint: "<symptom>"
---

# Incident

Symptom: $ARGUMENTS

1. Severity: SEV1 (ranked/realtime down, payments broken, data leak) · SEV2 (degraded for many) · SEV3 (minor).
2. `devops-sre` leads: find the runbook in `docs/runbooks/`, gather dashboards/traces/logs, identify the last
   change (deploys, flags, lexicon versions, season config). Prefer mitigation first: flag off / rollback /
   scale / failover. Do not run destructive prod commands; prepare them for a human to execute.
3. Involve `security-engineer` immediately for any suspected breach or cheating wave; `privacy-compliance` for
   personal data exposure (72 h GDPR notification clock).
4. After mitigation: write `docs/postmortems/YYYY-MM-DD-<slug>.md` from `docs/templates/POSTMORTEM.md` (timeline,
   impact, root cause via 5 whys, what went well/poorly, action items with owners), update/create the runbook.
