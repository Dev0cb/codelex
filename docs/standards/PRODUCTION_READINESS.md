# Production Readiness Checklist

Used by `/ship`. Every item PASS or explicitly N/A with justification.

## Reliability
- [ ] SLOs defined (`infra/slo/<service>.yaml`) and burn-rate alerts wired to on-call.
- [ ] Runbook for every paging alert in `docs/runbooks/`.
- [ ] Health, readiness and startup probes; graceful shutdown (drain WebSockets, finish in-flight commands).
- [ ] Timeouts, retries with jitter, circuit breakers on every outbound call; idempotent consumers.
- [ ] Load test at 2× forecast peak passed; capacity plan and autoscaling limits set.
- [ ] Degradation behaviour verified (dependency down → feature degrades, game continues).

## Deploy & rollback
- [ ] Migration order documented (expand → deploy → migrate → contract) and rehearsed in staging.
- [ ] Rollback tested; feature flag kill switch tested.
- [ ] Progressive rollout plan with guardrail metrics and automatic halt.

## Security & privacy
- [ ] Threat model mitigations done; security sign-off.
- [ ] Secrets in secret manager; least-privilege service accounts; network policies.
- [ ] DATA_MAP updated; retention and deletion paths cover the new data.

## Observability & product
- [ ] Dashboards (technical + business) exist and are linked from the runbook.
- [ ] Analytics events verified in staging.
- [ ] Support/moderation tooling updated (admin) and support macros written.
- [ ] Release notes EN/FR.

## Cost
- [ ] Cost estimate per 1k DAU; resource tags; budget alert.
