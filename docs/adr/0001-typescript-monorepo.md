# 0001 — TypeScript monorepo with pnpm workspaces and Turborepo

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door (costly)

## Context
CODELEX needs one rules engine shared by mobile, web and servers (server authority + client prediction), many
services and an agentic team that benefits from one language, one toolchain and atomic cross-package changes.

## Options considered
- **A. TypeScript monorepo (pnpm + Turborepo)** — one language end to end, shared types/zod schemas, affected-only
  builds, remote cache. Risk: Node performance for hot paths.
- **B. Polyglot (Go/Rust servers, TS clients)** — top performance, but rules duplicated or compiled to WASM,
  two toolchains, slower iteration.
- **C. Polyrepo** — isolation but no atomic contract changes; high coordination cost.

## Decision
A. Hot paths are bounded (engine apply < 1 ms is achievable in V8). If load tests prove otherwise, only
`services/realtime` may move to Go (see 0004) while the engine stays TS (or compiles to WASM).

## Consequences
Strict TS everywhere; shared `packages/config`; Turborepo remote cache in CI; dependency boundaries enforced by
lint rules (no app importing another app; services never import each other's code).
