# v2 `/balance-check` digest (sprint 3 task BC)

- Pre-registration: `docs/specs/E-1.6-balance/v2-balance-check.md` at blob `ee714c6a4e9d0361eb067d651e82738a81892acb`
  (the blob on `main` is unchanged up to this PR).
- Registered run: [GitHub Actions run 37288067161](https://github.com/Dev0cb/codelex/actions/runs/37288067161),
  `workflow_dispatch` on `main`, attempt 1, completed green 2026-10-05. No re-run of failed jobs (§5.4 a: none).
- Code commit `9ae17989a91ddaa744e7e6c8b2f972008cb7c0ff`. Lexicon commit `b3ab7bbccc86e2a41c6b632f3eb9fd758a163a19`.
  `lexiconVersion` `e568477b5592a994`, profile `global-ranked`, `definitionHash` `da1f36a3747e0dfe`.
- Master seed `2026100400000e16`. `BOT_VERSION` 2, Strategist is the primary bot (not the §5.2 path, so
  `provisional: false`). Strategist budget 70,000 nodes and 500 candidates. 104,000 matches. Wall time 1161 s.
- Integrity: I-1, I-2 and I-3 hold. Every match replayed to identical state hashes. The run is valid.
- Files here: `results.json` (merged results, unchanged), `jobs.tsv` (job specs, commands, CI timings and
  digests), `SHA256SUMS` (the committed files). Evaluated by `game-designer` on 2026-10-05.

## Outcome

**v1 fallback (B-01 risk recorded).** The playtest pins `engineRulesVersion` 1, and `PLAY_RULES_VERSION` stays `1`.
T-2 (simulator v2 support) and T-3 (v2 draft constants in the registry) ship regardless, because the gate only
picks the version the build pins. R4 is not triggered.

## Verdict table

Values are percentages with a 95 % CI. Criteria are judged on the integer bp/tenths values in `results.json` (§3.2).

| ID | Class | Rule | v1 (baseline) | v2-3612 (0/3/6/12) | v2-248 (0/2/4/8) |
| --- | --- | --- | --- | --- | --- |
| P-1 B-01, Strategist mirror | R | CI in [48.00, 52.00] | 52.34 [51.36, 53.33] **FAIL** | 50.59 [49.61, 51.58] PASS | 51.13 [50.14, 52.12] **FAIL** |
| P-2 C-05 term-bonus share | R | upper CI ≤ 35.00 | 43.11 [43.04, 43.18] **FAIL** | 36.29 [36.22, 36.36] **FAIL** | 25.84 [25.78, 25.90] PASS |
| P-3 C-02 no-word turns, bag not empty | L | ≤ 15.00 | 6.39 PASS | 4.62 PASS | 4.42 PASS |
| P-4 C-10 lock with bag ≥ 7 | L | ≤ 5.00 | 1.48 PASS | 0.80 PASS | 0.81 PASS |
| P-5 C-11 tiles played | L | ≥ 90.0 | 92.6 PASS | 94.1 PASS | 94.5 PASS |
| P-6 top-20 share | L | ≤ 40.00 | 25.80 PASS | 23.88 PASS | 22.38 PASS |
| S-1 B-01, Beginner mirror | R | fail if lo > 52 or hi < 48 | 51.27 [50.28, 52.25] PASS | 48.79 [47.80, 49.78] PASS | 48.73 [47.75, 49.72] PASS |
| B-07 Strategist vs Beginner | K | lower CI ≥ 60.00 | 81.67 [79.90, 83.31] PASS | 82.49 [80.75, 84.10] PASS | 79.21 [77.36, 80.94] PASS |
| BG-1 Beginner vs random | K | ≥ 80.00 | 90.97 PASS | 94.24 PASS | 94.85 PASS |
| BG-2a matched greedy vs Beginner | K | in [65.00, 85.00] | 68.80 PASS | 67.59 PASS | 67.00 PASS |
| BG-3 Beginner ppw / greedy ppw | K | in [55.0, 75.0] | 72.08 PASS | 72.56 PASS | 74.70 PASS |
| BG-4 Beginner novice+intermediate | K | ≥ 90.00 | 95.06 PASS | 96.19 PASS | 96.15 PASS |
| BG-5 Beginner budget exhausted | K | ≤ 1.00 | 0.00 PASS | 0.00 PASS | 0.01 PASS |
| **Passes §3.4** | | | no (P-1, P-2) | **no (P-2)** | **no (P-1)** |

No criterion was excused: every L and K criterion passed outright for all three variants, so §3.3 never applied.

Diagnostics (never gating, §5.1), Strategist mirror: `dx-dw-3612` P-1 54.03 [53.04, 55.01], P-2 35.94
[35.87, 36.01]; `dx-dw-248` P-1 54.06 [53.07, 55.04], P-2 25.56 [25.50, 25.62]. Both pass P-3..P-6.

**Mechanical check (§5.3-3).** game-designer re-applied every §3.4 rule, class and pairing index to the integer
values in `results.json`, independently of the readout script: 0 verdict mismatches across 51 criterion cells. The
P-1 and S-1 Wilson bounds were recomputed from the raw counts (for example 5084/9943 gives [5014, 5212] bp) and
match. Nobody re-labelled a class, threshold or CI rule. One transcription error was found in the BC hand-off text
and not in the data: it gave `dx-dw-3612`'s upper P-1 bound as 55.04, and the file says 55.01 (5501 bp). It is a
diagnostic, so nothing changes.

## §5.1 decision path

1. Rule 1: `v2-3612` fails P-2 (R): upper CI 36.36 % > 35.00 %. It passes everything else.
2. Rule 2: `v2-248` fails P-1 (R): upper CI 52.12 % > 52.00 % (5212 > 5200 bp). It passes everything else.
3. Rule 3: **v2 fails, v1 fallback (§5.3)**. This is the same path as the readout's `outcome.path`.

## Surprises against §1.2

- **H3 held, but the expected outcome did not.** The decision rule picked 0/2/4/8, as predicted: 0/3/6/12 missed
  C-05 (36.29 %, close to the proxy's 39.34 %) and 0/2/4/8 met it easily (25.84 %). The surprise is that 0/2/4/8
  then failed B-01, which the greedy proxy put at 49.40 %. Strategist measured 51.13 %, which is +1.7 points.
- **v2-248 missed P-1 by 12 bp on the upper bound.** At n = 9,943 the half-width is about 0.99 points, so passing
  needed a point estimate ≤ about 51.01 %, and it was 51.13 %. §7 foresaw exactly this case: at a true rate near
  51 %, the chance of passing is about 50 %. The rule is applied as written; a narrow miss is a miss.
- **The start-square effect is about 3 points of P-1, but letters-v2 and the new bonuses push the other way.**
  Each candidate minus its DW-start twin (same letters and bonus, only the layout differs): −3.44 points (3612)
  and −2.93 points (248). That matches the proxy's plain-start story. However, the DW twins sit at 54.0 %,
  **above** v1's 52.34 %. So, with the DW start held, moving from letters-v1 and 0/4/8/16 to letters-v2 and the
  lower bonuses added about +1.7 points of first-player advantage. The net v2 − v1 move was only −1.75 points
  (3612) and −1.21 points (248). These comparisons are only partially paired (§3.4), so read them as direction
  plus rough size.
- **The candidate order on B-01 reversed.** The proxy put 0/3/6/12 above 0/2/4/8 (50.30 vs 49.40). On Strategist,
  `v2-3612 − v2-248` is −0.54 points. That is small against the CI widths and may be noise.
- **Seat advantage depends on bot strength (H2, S-1).** Under v2, Beginner sits at 48.7–48.8 % (lower CIs 47.75 and
  47.80) while Strategist sits at 50.6–51.1 %. S-1 passes, because it only fails on a significant violation, but the
  same layout over-corrects slightly for weak play and under-corrects for strong play. Under v1 the gap is smaller
  (51.27 vs 52.34).
- **H1 held on the point, not with confidence.** v1 Strategist reached 52.34 %, but the CI [51.36, 53.33] includes
  52. The Beginner v1 mirror (51.27 %) is lower than the Beginner proxy (53.38 %).
- **H4 and H5 held with margin.** v2 improves every L metric over v1 (C-02, C-10, C-11, top-20). The bot ladder
  holds, with B-07's lower CI ≥ 77 % everywhere. The near-misses are BG-3 on `v2-248` (74.70 against a 75.0
  ceiling) and BG-2a on `v2-248` (67.00 against a 65.00 floor).
- Reported only: Strategist `budgetExhausted` rises from 0.33 % (v1) to 0.58 % and 0.72 % (v2). The mean
  first-mover lead falls from 5.1 to 0.8 and 0.7 points. 91 % of v1 matches end on scoreless turns, against 82 %
  and 78 % on v2.

## Risks

1. **v1 ships with two known R misses, not one.** B-01 is 52.34 % on the Strategist mirror. C-05 is also 43.11 %:
   in Strategist play, the term bonus makes up 43 % of PlaceWord points, so term knowledge can outweigh board play
   (pillar 1). Both are accepted only within the Phase 1 scope below. Playtest telemetry (T-9) re-reads B-01 on
   humans.
2. **Provenance.** `results.json` is a deterministic reproduction, not the CI bytes. See the provenance section;
   the owner verification is still open.
3. **Forking paths on the next attempt.** Re-running 0/2/4/8 on a fresh seed only because it narrowly missed would
   give it a second draw at the same bar, raising the false-pass rate. The next pre-registration must cite this run
   as prior evidence and say how it accounts for the repeat. Options include a confirmation requirement or a
   stricter bar on the second look; that choice is the new file's to make.
4. **No layout centers both bots.** Strategist is above 50 % and Beginner below 50 % under v2. A future B-01 bar on
   strong play may push Beginner play further below 48 %. Human data decides which bot is representative.
5. **Strategist budget pressure** rises under v2 (more budget exhaustion). It is a device-side cost to watch with
   H1, and it does not affect this decision.

## v1 fallback record (§5.3-5)

- **v1 B-01, Strategist mirror (P-1):** 52.34 % [51.36 %, 53.33 %] (5203/9940, 60 draws excluded). FAIL.
- **v1 B-01, Beginner mirror (S-1):** 51.27 % [50.28 %, 52.25 %] (5097/9942, 58 draws excluded). PASS (no
  significant violation).
- **Scope of the accepted risk:** casual vs-bot play only. Phase 1 has no ranked play and no leaderboard (decision
  note `docs/game/decisions/2026-10-b2-response.md` §9.1-2). Any ranked or leaderboard surface needs a passing v2,
  or a new decision, first.
- **Failing criteria per candidate:**
  - `v2-3612`: P-2 (upper CI 36.36 % > 35.00 %);
  - `v2-248`: P-1 (upper CI 52.12 % > 52.00 %);
  - `v1`, for reference: P-1 and P-2.
- **New pre-registered v2 attempt.** Owner: `game-designer`, consulting `ai-engineer` and `game-engine-engineer`.
  Target: Phase 1 sprint 4. It needs:
  - a new file version committed to `main` before its run;
  - a new master seed;
  - a changelog entry stating what changed and why.

  This run's results stay committed and must be cited there. Until that file exists, nothing may be tuned to these
  results or re-run with changed parameters (§5.4).
- **Lexicon follow-through (§5.3-6).** v1 passes all four L criteria: P-3 6.39 %, P-4 1.48 %, P-5 92.6 and P-6
  25.80 %. The restated 11×11 trigger (C-10/C-11) and the BALANCE.md top-20 trigger are not met, so nothing is
  evaluated or notified.
- **Also carried:** `PLAY_RULES_VERSION` stays `1`. T-2 and T-3 ship regardless. `replays/v2` is not frozen.

## Provenance

The CI artifacts cannot be downloaded from the evaluation environment, because its network policy blocks GitHub's
artifact and log blob host. The Actions API itself is reachable. `ai-engineer` therefore reproduced the run locally
at the same code commit, with the same suite and identical flags. The simulator is deterministic, so the
reproduction should match the CI output byte for byte:

- the same decision;
- I-1..I-3 hold;
- all 104,000 matches replayed identically.

The merge step takes `lexiconVersion`, `definitionHash` and `--wall-time-s 1161` as inputs. The reproduction passed
the CI values. game-designer recomputed `lexiconVersion` and `definitionHash` with
`tools/balance-check/lexicon-identity.mjs` at the code commit, and they match. The per-job seconds in `jobs.tsv`
are labelled as CI job wall time or reproduction simulate time; the CI `job-seconds-*.txt` files sit inside the
unreachable artifacts.

CI artifact zip digests (`gh api repos/Dev0cb/codelex/actions/runs/37288067161/artifacts`):

| Artifact | sha256 of the zip |
| --- | --- |
| `balance-check-readout-attempt-1` | `a453132fb4af7b467123af1a5fbdba0d7b6452a98cf1d4175c720b984b1dbc3f` |
| `balance-check-job-v1` | `570c4cc3ab3fe86e96ee0436cf45b856c98c0a1c991a81982347c2b0967479b9` |
| `balance-check-job-v2-3612` | `6a142aa3eb5823f8f46444485926bd043c2f653797480c181ff1aea6b36930b0` |
| `balance-check-job-v2-248` | `58a36533adbd2378b06505656f7439217b00d9b435024296806fd5757aedbe6f` |
| `balance-check-job-diagnostics` | `e28bfa42583aeff03bec3dcacc191ae5c4fc98a7512f161f17b5d3b3dc773d4b` |

Reproduction file hashes (sha256):

| File | sha256 |
| --- | --- |
| merged results (`results.json` here) | `a41425ec97bb23d27a69b97bc57a50907259e594301c7cac973d79582381fc20` |
| `balance-check-readout.md` | `e15e43a1e634f4efeedf784ee03d2110a0fa9744a715f9fae2a2a6ba00bc4cc9` |
| `results-v1.json` | `ef836561a5861a313bc70665ecc13a83bd9443401ff16426343beccb71dec343` |
| `results-v2-3612.json` | `42c6043ef7c11bfde6fb323283b9985025b50d6f39e34f3a23c994de9a1daa64` |
| `results-v2-248.json` | `6b3f065ba25c438491558ad7374eed56ce76b0ddb88b2271573605c655c46fd3` |
| `results-diagnostics.json` | `fabce50100f7076fa9d0255ad4adf4dac853632a68ceac1517e895c046537d1c` |

**Owner verification (open; owner `ai-engineer`, before R4 or any reuse of these numbers, and within the
artifacts' 90-day retention).** From a machine that can reach the blob host:

1. Run `gh run download 37288067161 -R Dev0cb/codelex`.
2. Check each zip digest against the table above (`gh api …/artifacts`).
3. Run `sha256sum` on `balance-check-results.json` from `balance-check-readout-attempt-1` and compare it with
   `a41425ec97bb23d27a69b97bc57a50907259e594301c7cac973d79582381fc20`. Compare each `results-<job>.json` with its
   reproduction hash too.

A mismatch is an I-class failure under §5.4. Stop, report to `ai-engineer`, and treat the run as invalid. Do not
replace `results.json` silently: both files stay committed and the digest records the mismatch. On a match, append a
dated "verified" line here.
