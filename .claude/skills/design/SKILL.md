---
name: design
description: Produce the technical design for a ready spec — architecture note, contracts (protocol messages, events, APIs, DB schema), NFR budgets, ADRs for irreversible choices, threat model, and an owner-assigned task breakdown. Use after /feature-spec and before /implement.
argument-hint: "<path to spec>"
---

# Technical design

Spec: $ARGUMENTS

1. Delegate to `solution-architect` to write `docs/specs/<epic>/<feature>.design.md` covering components,
   sequence diagrams (Mermaid), contracts, data model and migrations, NFR budget, failure modes, observability,
   rollout and rollback. Any one-way-door decision → `/adr`.
2. In parallel:
   - `security-engineer` → `/threat-model` for the feature.
   - Owner engineer agents (from the routing table in CLAUDE.md) review feasibility of their part and estimate.
   - `qa-engineer` drafts the test plan (traceability: acceptance criterion → test).
3. Architect integrates feedback and ends the design with a task list per owner, each with acceptance criteria.
4. Output: design path, ADRs created, top risks, the task list. Status of spec → `Ready for implementation`.
