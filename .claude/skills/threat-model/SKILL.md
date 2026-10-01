---
name: threat-model
description: STRIDE threat model for a feature or component, with abuse cases specific to a competitive game (cheating, collusion, bots, multi-accounting, purchase fraud, harassment) and mitigations turned into owned tasks. Use for anything exposed to clients, money, PII, ranked results or UGC.
argument-hint: "<feature or component>"
---

# Threat model

Target: $ARGUMENTS

Delegate to `security-engineer` to write `docs/security/threat-models/<slug>.md` from
`docs/templates/THREAT_MODEL.md`: assets, actors (incl. cheaters, colluding players, scripted clients, malicious
org admins, compromised staff), trust boundaries diagram (Mermaid), STRIDE table, game-integrity abuse cases,
likelihood × impact, mitigations with owner agents and acceptance tests, residual risk. Involve
`privacy-compliance` when personal data or minors are involved. Output the top 5 risks and the mitigation tasks.
