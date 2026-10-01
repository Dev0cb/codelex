# services

Backend bounded contexts: gateway, identity, game, realtime, matchmaking, knowledge, progression, ai, integrity, commerce.
Each is created with `/scaffold services/<name>` by its owner agent (routing table in `CLAUDE.md`). Services never import each other; they integrate through `packages/protocol` contracts and Kafka events.
