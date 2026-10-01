# 0005 — PostgreSQL, Redis, Kafka and object storage as the data platform

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door (costly)

## Context
Transactional domains (accounts, purchases, matches), hot state (queues, leaderboards, live matches), an event
backbone (progression, integrity, analytics) and blobs (replays, lexicon indexes).

## Decision
PostgreSQL (managed, PITR, one schema per service), Redis (managed, replicas), Kafka (managed; Redpanda locally),
S3-compatible object storage behind a CDN. Transactional outbox for event publishing. Warehouse fed from Kafka.

## Options rejected
Single document DB for everything (weak for ledger/relations); Cassandra (operational cost before scale needs it).

## Consequences
Strict schema migrations discipline; per-service credentials; event schemas versioned in `packages/protocol/events`.
