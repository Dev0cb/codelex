# 0004 — Server-authoritative turn engine over WebSockets

- Status: Accepted · Date: 2026-10-01 · Reversibility: One-way door

## Context
Ranked play, tournaments, Daily and Arena must be cheat-resistant; Blitz needs low latency; mobile networks drop.

## Options considered
- **A. Server-authoritative, event-sourced matches, WebSocket edge, client prediction** — fair, auditable,
  replayable.
- **B. Peer-to-peer / client-authoritative with validation after the fact** — cheaper, but cheating and disputes.
- **C. HTTP polling** — simple, poor latency for Blitz and spectating.

## Decision
A. Match state machine in `services/game` uses `packages/game-engine`; every action validated server-side; match
log = seed + ordered actions (replayable, hash-checked). WebSocket edge is stateless and resumable.

## Consequences
Server cost per match; need for consistent routing by `matchId`; Redis for hot state with Postgres log as source
of truth; timers are server-owned with bounded latency compensation.
