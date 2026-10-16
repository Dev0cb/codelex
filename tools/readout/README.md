# Exit-KPI readout (sprint 4 KR)

Computes the Phase 1 exit KPIs of E-1.5 from the playtest export files testers send ("Send playtest data", exportFormat 1):
median session length, would-play-again and crash-free sessions, plus data-quality lines. Definitions:
`docs/specs/E-1.5-play-vs-bot/playtest-plan.md` section 4.1 and `docs/standards/ANALYTICS_EVENTS.md` "Data-analyst notes (sprint 4 D1)".
A real-looking dry run is in `docs/specs/E-1.5-play-vs-bot/exit-kpi-readout-dry-run.md`.

## Run

Needs Node 22.18+ (the D1 TypeScript decoders are loaded directly) and `pnpm install` (for `zod`).

```bash
node tools/readout/cli.mjs [--roster roster.csv] [--json out.json] [--text out.txt] [--allow-invalid] export1.json export2.json ...
```

- Several files per tester are fine, in any order: files are ordered by `exportedAt`, events de-duplicated by `event_id`.
- Text goes to stdout (or `--text`), the same numbers as JSON (`codelex.exit_kpi_readout` v1) to `--json`.
- Exit code 0 = ok, 1 = at least one file was rejected (listed under Data quality; `--allow-invalid` accepts the rest),
  2 = usage or roster error.
- Output is deterministic and prints counts only: no install id, no tester id. Keep raw exports and the roster out of git
  and delete them on the schedule of playtest plan section 5.

Dry run on synthetic data: `node tools/readout/gen-dry-run.mjs <dir>`, then
`node tools/readout/cli.mjs --roster <dir>/roster.csv <dir>/t0*.json`. Tests: `pnpm test:readout`.

## Roster CSV (optional, recommended)

```csv
tester_id,install_id
t01,3f1c...-v4-uuid
t03,aaaa...-v4-uuid
t03,bbbb...-v4-uuid
```

One row per (tester, install id); `tester_id` is the debrief pseudonym. After a consent off/on a tester gets a new
install id (S6b review m3), so one tester appears under two ids with the survey answered under the first and not asked
again under the second. With a roster the readout merges them (the unit becomes the tester, the last non-dismissed answer
over all their installs wins) and reports how many installs the roster did not cover. Without a roster one install = one
tester and a consent off/on counts as two (stated in the output). An install listed under two testers is an error.

## Definitions as implemented

| KPI                 | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active tester       | at least one `bot_match_finished` over the tester's installs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Session (Q-12)      | foreground intervals (`app_opened` to `app_backgrounded`, length `foreground_ms`) separated by at most 30 min of background (by `occurred_at`) are one session; length = sum of `foreground_ms`. `session_id` is not used. A session whose last interval is still open at the end of the data (the export is made in the foreground) is incomplete and left out of lengths. Events are de-duplicated per install and `event_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Median session      | primary: median over all complete sessions of active testers (type 7 quantiles for IQR), with n sessions; secondary: median of per-tester medians; sessions under 10 s are counted separately and kept                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Would play again    | per tester, the last non-dismissed `playtest_survey_answered` (by `occurred_at`); Yes / Maybe / No shares over testers with such an answer, Wilson 95 % CI; dismissed-only testers and testers with no answer are reported, not counted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Crash-free sessions | 1 minus crashed over decided sessions, per platform and overall, Wilson 95 % CI. Crash = a cold start with `previous_exit_unclean = true`. With an open interval (no `app_backgrounded`) it crashes the session holding it, closed at the last event before the cold start (a lower bound), and **a crash does not end the session**: a relaunch within 30 min of that last event continues it (Q-12: a session ends only after 30 min away), and a session containing an unclean exit counts as one crashed session. With no open interval (a boot crash: the crashed process recorded nothing) it is a separate zero-length crashed session, left out of lengths. Every other session is clean: its last interval closed with `app_backgrounded`, which deletes the S6a marker, so it cannot become unclean afterwards, and a later `app_opened` (warm or cold) proves the process was alive. The only unknown session is one whose last interval is still open at the end of the data (export made in the foreground); it is left out and counted. All installs count, not only active testers |
| Crash-free users    | share of testers with at least one decided session and none crashed, per platform                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## ASSUMPTION (pending owner confirmation, OQ-SP2-4): an OS background kill is NOT a crash

The only crash signal is `app_opened.previous_exit_unclean`, as set by the S6a session marker
(`apps/mobile/src/analytics/session-marker.ts`, `recorder.ts`). No crash SDK is used (Q-15).

What sets it: a "session open" marker file is written at every launch, and on every move to `active`; it is removed on a
move to `background`, and (after the first `active`) on `inactive`. At the next cold start `previous_exit_unclean` is
`true` iff the marker is still on disk, i.e. the previous process ended while user-facing: a crash, an OS kill or a power
loss **in the foreground**, or a crash during startup.

Does an OS background kill set it? **No.** The marker is removed when the app moves to the background, so the routine
low-memory kill of a backgrounded app (common on low-end Android) leaves no marker and reads as a clean exit, as do an
iOS app-switcher swipe-away (the app is `inactive`) and a reboot while backgrounded. The readout therefore counts none of
these, and needs no exclusion rule. Consequences and residual risk:

- Blind spots, accepted by D1: a crash while backgrounded and a crash while `inactive` after use (notification centre,
  control centre, call banner) are missed; cross-check with Play vitals and TestFlight crash stats.
- Possible false positives: an OS foreground kill (a low-memory kill of the foreground app, a force-stop from system
  settings while it is visible) is counted as a crash. The marker is deleted by a synchronous file call at the
  background transition, but if the OS freezes and kills the process before that call runs, the marker survives and the
  next start reports unclean. This race is not measurable from exports. If testers report suspiciously high crash
  rates on low-end Android, look at the readout line "zero-length crashed sessions": an unclean flag whose previous
  session had closed cleanly (an `app_backgrounded` was the last event) is either a boot crash (counted, per D1) or
  this race, and events cannot tell them apart. The readout reports their count so the owner can judge; any change
  (for example a second marker) belongs to S6a, not to this task.
- If the owner decides that a background kill should count as a crash, the readout cannot recover it from the existing
  events (nothing is recorded for a kill in the background); it would need a new marker semantic in S6a.

## Other assumptions

- `occurred_at` is the device clock: it positions intervals and measures the 30 min gap only. Negative or jumping gaps
  are treated as within the session when they are not larger than 30 min.
- Header `dropped` counts are summed over files; a file re-sent before the tester's "Sent" confirmation may repeat a
  count, so treat the sum as an upper bound. `remaining > 0` in an install's latest file means events are still on the
  device (ask the tester to send again).
- A tester with several installs on different platforms is counted under each platform for crash-free users.
- Export completeness (installs with an export divided by installs in the stores) needs store numbers; it is not
  computed here.
