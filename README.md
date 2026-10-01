# CODELEX

> **Play the language of technology.**
> Plateforme de jeu compétitif construite autour du langage, des concepts et de la culture de la technologie.

Ce dépôt contient le **framework agentique** qui permet à une équipe d'agents Claude Code (pilotée par un humain)
de construire CODELEX de bout en bout — du game design à la production — avec des garde-fous de niveau production.

> Langue : la vision et ce guide sont en français ; le code, les prompts d'agents et les standards sont en anglais
> (convention d'une équipe internationale).

---

## 1. Ce que contient le framework

| Brique | Emplacement | Rôle |
|---|---|---|
| Constitution | `CLAUDE.md` | Principes non négociables, carte du dépôt, stack, table de routage des agents, règles |
| 20 agents spécialisés | `.claude/agents/` | Produit, game design, architecture, moteur de jeu, lexicon (contenu + ingénierie), backend, temps réel, mobile, web, UX, IA, sécurité/anti-triche, SRE, QA, data, monétisation/LiveOps, conformité, revue, documentation |
| 14 workflows (skills) | `.claude/skills/` | `/sprint-plan` `/feature-spec` `/design` `/adr` `/threat-model` `/implement` `/review` `/ship` `/release-mobile` `/lexicon-add` `/balance-check` `/season-plan` `/scaffold` `/incident` |
| Garde-fous déterministes | `.claude/hooks/` + `.claude/settings.json` | Bloquent force-push / push direct sur main, `terraform apply`, `--no-verify`, lecture/écriture de secrets, édition des lockfiles, clés API dans le code ; revalident automatiquement le lexicon et le framework après chaque édition |
| Vision produit | `docs/vision/PRODUCT_VISION.md` | Les 28 sections de la vision, avec des IDs stables `V-xx` |
| Architecture & décisions | `docs/architecture/`, `docs/adr/` | Architecture cible + 10 ADR fondatrices |
| Roadmap | `docs/roadmap/ROADMAP.md` | Phases 0 → 6, épics, critères de sortie mesurables |
| Game design | `docs/game/` | Règles (IDs testables `R-…`), équilibrage, spécification du lexicon, progression |
| Standards | `docs/standards/` | Ingénierie, Definition of Done, tests, production readiness, catalogue analytics |
| Lexicon seed | `packages/lexicon/` | Schéma JSON, formules, validateur, 108 termes EN/FR sur 9 catégories, graphe de relations |
| Auto-validation | `tools/framework/` | Valide agents/skills/hooks/références croisées ; tests des hooks |
| CI | `.github/workflows/ci.yml` | Validation framework + lexicon, lint/typecheck/test des paquets affectés, audit des dépendances |

## 2. Démarrage

```bash
nvm use            # Node 22
pnpm install
pnpm validate      # framework + lexicon + tests des garde-fous
```

Puis ouvrez Claude Code à la racine du dépôt. Le hook `SessionStart` affiche la branche, le sprint courant et le
workflow à suivre.

## 3. Le cycle de travail

```
/sprint-plan  → choisit le prochain épic de la roadmap et le découpe en tâches assignées aux agents
/feature-spec → spec produit (stories, critères d'acceptation, KPI, events, flags)
/design       → design technique, contrats, ADR, threat model, plan de test
/implement    → l'agent propriétaire code en test-first jusqu'à la Definition of Done
/review       → revue parallèle : code-reviewer + sécurité + QA (+ game design, conformité)
/ship         → checklist de production, rollout progressif, GO/NO-GO humain
```

Workflows spécialisés : `/lexicon-add` (contenu), `/balance-check` (simulation ≥ 10 000 parties),
`/season-plan` (saisons), `/release-mobile` (stores), `/incident` (production), `/scaffold` (nouveau paquet).

**Exemples de demandes**
- « /sprint-plan » → reprend la Phase 0 (outillage monorepo, stack locale, protocol).
- « /feature-spec Mode Blitz 60 secondes classé »
- « /lexicon-add 40 termes Cybersecurity pour la Season 03 Cyber War »
- « /balance-check réduire le bonus Full Stack de 50 à 40 »

## 4. Décisions humaines (portes de validation)

Les agents s'arrêtent et demandent votre accord pour : l'objectif de sprint, l'acceptation d'une ADR, un
changement de cible d'équilibrage, un rollout à 100 % en production, toute soumission aux stores, et tout point
marqué `LEGAL_REVIEW_REQUIRED`.

## 5. Étendre le framework

Voir `docs/framework/AGENTIC_WORKFLOW.md` §5. Toute modification sous `.claude/` est revalidée automatiquement par
le hook post-édition et en CI (`pnpm framework:validate`).

Limite connue : `guard-bash` filtre par motifs le texte des commandes (corps de heredoc ignorés). C'est un filet de
sécurité contre les erreurs, pas un bac à sable — la protection de branche GitHub et les droits cloud restent les
vrais contrôles. Il peut produire de rares faux positifs (texte cité dans une chaîne) : écrire alors le fichier
avec l'outil d'édition.

## 6. État

Phase 0 (fondations) en cours : framework agentique ☑, CI ◐, lexicon seed ◐ (108/300 termes). Prochaine étape :
`/sprint-plan` pour l'outillage monorepo (E-0.2), la stack locale (E-0.3) et `packages/protocol` (E-0.5), puis la
Phase 1 — le moteur de jeu.
