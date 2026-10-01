# 0003 — GraphQL BFF for clients, Connect/gRPC between services, zod at boundaries

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door

## Context
Mobile screens aggregate data from many contexts (profile, progression, social, knowledge); services need typed,
evolvable contracts.

## Options considered
- **A. GraphQL gateway (client-facing) + Connect RPC (internal) + Kafka events** — flexible client queries,
  persisted queries for mobile, typed internal calls.
- **B. REST everywhere** — simple, but chatty mobile screens and weaker typing.
- **C. tRPC** — great DX inside TS, but couples clients to server internals and is weak for public/B2B APIs.

## Decision
A. Realtime game traffic does **not** go through GraphQL: it uses the WebSocket protocol in `packages/protocol`.
Public B2B APIs are REST (OpenAPI) generated from the same schemas. All untrusted input is parsed with zod.

## Consequences
Persisted queries only from mobile in production; query cost limits; schema checks in CI to detect breaking
changes.
