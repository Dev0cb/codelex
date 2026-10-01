# Testing Standard

See ADR 0010. Owner: `qa-engineer`.

| Level | Tool | Where | Runs |
|---|---|---|---|
| Unit | Vitest | `*.test.ts` next to code | every PR (affected) |
| Property | fast-check | game-engine, protocol, lexicon, bots | every PR |
| Golden replays | Vitest + fixtures | `packages/game-engine/test/golden` | every PR |
| Integration | Vitest + Testcontainers | `services/*/test/integration` | every PR (affected) |
| Contract | zod schemas + recorded fixtures, both sides | `packages/protocol/test` | every PR |
| E2E web | Playwright | `apps/web/e2e`, `apps/admin/e2e` | PR (smoke), main (full) |
| E2E mobile | Maestro | `apps/mobile/e2e` | main + release |
| Two-client realtime | Node WebSocket clients | `services/realtime/test/e2e` | every PR touching realtime/game |
| Load | k6 | `tools/load` | nightly + before release |
| Chaos | Litmus/Chaos Mesh | staging | weekly |
| Mutation | Stryker | game-engine scoring/placement | before major release |
| LLM evals | custom runner | `services/ai/evals` | PR touching prompts/models |

Rules:
1. A bug fix starts with a failing test reproducing it.
2. Tests assert behaviour, not implementation details; no snapshot-only tests for logic.
3. No sleeping in tests; use fake timers or awaitable conditions.
4. Flaky tests: fix or quarantine with an issue + owner within 24 h; never silently retry.
5. Test data is synthetic; never production personal data.
