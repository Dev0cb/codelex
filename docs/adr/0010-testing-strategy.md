# 0010 — Testing strategy and tools

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door

## Decision
Vitest (unit/integration), fast-check (property tests, mandatory in game-engine & protocol), Testcontainers
(integration with real Postgres/Redis/Kafka), golden replays for determinism, contract tests for protocol and
events, Playwright (web E2E), Maestro (mobile E2E), k6 (load), chaos experiments in staging, Stryker mutation
testing on scoring/placement before major releases. Coverage floors: 90% game-engine/protocol, 80% elsewhere.
Details: `docs/standards/TESTING.md`.
