---
name: adr
description: Write an Architecture Decision Record for a costly-to-reverse technical choice (new datastore, protocol, framework, provider, data model, security model). Use whenever a decision would be hard to undo.
argument-hint: "<decision title>"
---

# ADR

1. Find the next number: `ls docs/adr | sort | tail -1`.
2. Delegate to `solution-architect` to write `docs/adr/NNNN-kebab-title.md` from `docs/adr/0000-template.md`, with
   at least two real options, explicit trade-offs (cost, complexity, latency, team skills, lock-in), the decision,
   consequences, and reversibility. Status `Proposed`.
3. Ask the relevant owner agents and `security-engineer` to comment; integrate.
4. If it supersedes an ADR, set the old one to `Superseded by NNNN` (only the status line changes).
5. Update `CLAUDE.md` §3 table and `docs/architecture/ARCHITECTURE.md` if the stack changes.
6. Status becomes `Accepted` only after the human confirms; ask if not already approved.
