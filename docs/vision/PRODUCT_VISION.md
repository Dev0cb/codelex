# CODELEX — Product Vision

> **CODELEX — Play the language of technology.**
> *CODELEX is a competitive gaming platform built around the language, concepts and culture of technology.*

Status: **Canonical** · Owner: `product-strategist` · Each section has a stable ID (`V-xx`) referenced by specs,
epics and the roadmap. Changes to this file require the human product owner's approval.

---

## V-00 Positioning

- **Not** "a Scrabble for developers". **A worldwide mobile game franchise** around technology culture.
- The letter game is the front door; the product is the ecosystem:
  **Game + Competition + Knowledge Graph + Community + AI + Education + Esports + Enterprise.**
- Platforms: iOS and Android, mobile-first; a web platform for community, profiles, B2B/EDU.
- Brand tone: intelligent but not academic · competitive but not aggressive · tech but accessible · international.

## V-01 The core loop

```
PLAY → DISCOVER → LEARN → IMPROVE → COMPETE → RANK UP → PLAY
```
The player thinks they come to play a letter game; after months they have met thousands of terms across
programming, systems, cloud, data, AI, cybersecurity, networking, hardware and software. Learning is embedded,
never imposed.

## V-02 Home experience

```
                 CODELEX
       PLAY THE LANGUAGE OF TECHNOLOGY
               [ PLAY NOW ]
   ⚔ Battle · 🧩 Classic · ⚡ Blitz · 🧠 Knowledge · 🏆 Tournaments
```
The player sees a real competitive game, not an educational app.

## V-03 CODELEX Board (signature mode)

A letter board belonging to the tech universe. Players place tiles to form technology terms (e.g. DOCKER crossing
KERNEL). Requires vocabulary **and** board strategy. Rules: `docs/game/GAME_RULES.md`.

## V-04 Global Lexicon

Multi-dimensional dictionary of technology terminology, structured by category, with no limitation to English
words (EN/FR at launch, more later). Starter categories:

| Category | Examples |
|---|---|
| Programming | PYTHON · JAVA · RUST · CLASS · THREAD · ARRAY |
| Systems | KERNEL · PROCESS · MEMORY · THREAD · SOCKET |
| Networking | TCP · UDP · HTTP · DNS · ROUTER |
| Cloud | AWS · AZURE · CLOUD · EC2 · VPC |
| DevOps | DOCKER · KUBERNETES · HELM · TERRAFORM |
| Data | SQL · SPARK · KAFKA · REDIS · INDEX |
| AI | MODEL · TOKEN · VECTOR · EMBEDDING · AGENT |
| Cybersecurity | HASH · FIREWALL · MALWARE · PHISHING |
| Hardware | CPU · GPU · RAM · CACHE · SSD |

Ambition: one of the largest structured, game-usable corpora of technology terminology.

## V-05 Lexicon Engine

Each term carries metadata: category, difficulty, definition, related terms, aliases (e.g. K8S), languages,
Knowledge XP, game value. The engine understands relations between concepts and can generate progression
chains (KUBERNETES → DOCKER → CONTAINER → POD → CLUSTER). Spec: `docs/game/LEXICON_SPEC.md`.

## V-06 Technology profile

Not just "Level 42": a per-category mastery profile (Programming, Data, Cloud, DevOps, AI, Cybersecurity,
Networking, Systems…) measuring vocabulary discovered, term difficulty, categories, speed, accuracy,
competitive performance, knowledge and progression. Spec: `docs/game/PROGRESSION.md`.

## V-07 Game modes

| Mode | Summary |
|---|---|
| 🧩 Classic | The strategic mode. Long games. 1v1, 2v2, free-for-all. |
| ⚡ Blitz | Fast games: 30 / 60 / 120 seconds. Time is decisive. |
| ⚔️ Arena | Competitive mode where words deal damage (HP bars); some words have special effects. |
| 🧠 Knowledge | Knowledge challenges built on the graph. |
| 📅 Daily | Same 5 challenges for everyone each day, global daily ranking. |

## V-08 Tech Powers

Balanced abilities that keep strategy central: 🔥 Compile (multiplies next word), 🐛 Debug (change one letter),
⚡ Cache (keep a letter for next turn), 🐳 Container (protect a word from attack), 🔀 Refactor (rearrange
letters), 🧠 AI Assist (limited hint). Earned in play, never sold.

## V-09 Seasons

S01 The Cloud · S02 Artificial Intelligence · S03 Cyber War · S04 The Web · … Each brings new words, challenges,
content, rewards, leaderboard, events, cosmetics.

## V-10 CODELEX World

World map of competition: countries (XP totals), universities (UCAD, MIT, Stanford, EPFL…), communities
(developer communities, tech clubs, open source), companies (engineering teams). Each community can have a
private space.

## V-11 Tournaments

Qualifiers → Regional → National → Continental → World Championship. Brackets, matchmaking, spectators,
statistics, replays, rankings, rewards. A light esport around tech culture.

## V-12 Clans

E.g. *CLOUD NATIVE DAKAR* — members, clan XP, wins, tournaments, global rank. Members contribute to the
collective score.

## V-13 Knowledge mode & Knowledge Cards

After a word (e.g. KAFKA) the player can open a Knowledge Card (definition + related terms: EVENT, BROKER, TOPIC,
PARTITION, CONSUMER) and explore the graph.

## V-14 Knowledge Graph (most strategic asset)

Typed relations between concepts (Kafka → topic, broker, stream; topic → partition; broker → producer →
consumer). Feeds challenges, chains, missions, coach and recommendations.

## V-15 CODELEX AI

- **Coach**: analyses behaviour ("fast on programming, more errors on networking") and generates targeted
  challenges.
- **AI opponents** with distinct styles: Beginner Bot, Strategist, Speedster, Architect, Grandmaster —
  different behaviour, not only difficulty.

## V-16 Daily CODELEX

`DAILY #842 · 5 CHALLENGES · 03:42 · [PLAY]` — identical worldwide; end screen with today's rank. Key retention
mechanism.

## V-17 Missions

E.g. *MASTER PYTHON*: discover LIST, TUPLE, DICT, SET, ITERATOR, GENERATOR, DECORATOR → 🏆 Python Master Badge.

## V-18 Achievements

Hundreds of badges: 🐍 Pythonista (100 Python terms), ☁️ Cloud Native (50 cloud terms), 🧠 Polyglot,
⚡ Speed Coder (100 words < 2 s), 🔥 Word Architect (chain of 5 words), 🌍 Global Player (play against 50 countries).

## V-19 Social

Public profiles, friends, followers, clans, messages, challenges, spectators, replays, shareable victories
("I just defeated a Level 84 Architect on CODELEX").

## V-20 Personalisation

Avatar, frame, board, tiles, animations, effects, emotes, profile, titles (e.g. *MALICK — CLOUD ARCHITECT*).

## V-21 CODELEX Academy (maturity)

Bridge from game to deeper learning (Programming, Cloud, Data, AI, Cybersecurity). The game stays the main product.

## V-22 CODELEX for Education

Schools/universities create spaces; teachers run challenges with restricted dictionaries (e.g. DATA ENGINEERING
CHALLENGE: SQL, ETL, SPARK, KAFKA, AIRFLOW, WAREHOUSE…) and follow results.

## V-23 CODELEX for Companies

Private tournaments, leaderboards, analytics, custom challenges, branding, rewards (e.g. *2027 Engineering
Challenge*). CODELEX is both B2C and B2B.

## V-24 Architecture ambition

Distributed, globally scalable: mobile & web clients → API gateway → Game Engine (matchmaking, game state,
ranking), Identity (accounts, social, clans), Knowledge (lexicon, graph, AI) → event platform → Redis, Kafka,
PostgreSQL, object storage; plus observability, analytics, recommendation, anti-cheat, fraud detection, real-time
infra, global CDN, disaster recovery, multi-region. Detail: `docs/architecture/ARCHITECTURE.md`.

## V-25 Anti-cheat

Detect bots, automation, impossible behaviour, client manipulation, collusion, matchmaking abuse, multiple
accounts. Competitive games are server-authoritative.

## V-26 Monetisation

Free (truly playable) · CODELEX+ subscription (no ads, advanced stats, customisation, extra social features,
exclusive content) · Cosmetics (no pay-to-win) · Sponsored tournaments · Education licences · Enterprise platform.
