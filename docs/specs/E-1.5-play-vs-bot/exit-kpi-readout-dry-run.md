# Exit-KPI readout: dry run on a synthetic Stage 0 export

- Sprint 4 task KR (data-analyst). Script and usage: `tools/readout/README.md`. Definitions: `playtest-plan.md` section 4.1.
- **The data is synthetic.** `tools/readout/fixtures.mjs` (`stage0Dataset`) builds 5 testers, 6 installs and 7 export files,
  each valid against the D1 schemas (`exportFormat: 1`). The numbers below prove the pipeline, not the product: they say
  nothing about the real exit criteria.
- The set exercises: two files per tester with overlapping events (6 duplicates), one consent off/on (tester t03 has two
  install ids, merged through the roster), one crash with an open interval and one boot crash (both iOS), a dismissed-only
  tester, a tester who never finishes a match, and a session still open at export time (t05's export is made in the
  foreground: 1 incomplete session, 1 session with unknown outcome).
- Check: `tools/readout/exit-kpi.test.mjs` recomputes these numbers by hand from the fixture construction and fails if this
  file stops matching the generator.

```bash
node tools/readout/gen-dry-run.mjs /tmp/dry
node tools/readout/cli.mjs --roster /tmp/dry/roster.csv --json /tmp/dry/readout.json /tmp/dry/t0*.json
```

```text
CODELEX Phase 1 exit-KPI readout (E-1.5 play vs bot)

Population
  installs 6, testers 5, active testers (>= 1 finished match) 4
  exports dated 2026-10-14 to 2026-10-18
  roster: 6 installs mapped, 0 not in roster (counted as their own tester), 0 roster testers without data

Median session length (target >= 8 min; sessions of active testers)
  median 10.5 min, IQR 9.3 min to 12.0 min, n = 14 sessions from 4 testers
  with lower-bound sessions added (1): median 11.0 min, IQR 9.5 min to 13.0 min, n = 15 (lower bound: no app_backgrounded, closed at the last event by the next cold start; not in the figure above)
  median of per-tester medians 10.5 min
  sessions under 10 s (kept in the figures): 1
  excluded: 1 incomplete sessions (still open at export), 1 sessions of non-active testers

Would play again (target Yes >= 70 %; last non-dismissed answer per tester)
  n = 3: Yes 2 (66.7 %, 95 % CI 20.8-93.9 %), Maybe 1 (33.3 %), No 0 (0.0 %)
  dismissed only 1, no answer 1; dismissed answer events 1 of 4 survey cards shown

Crash-free (target >= 99.5 % per platform; crash = previous_exit_unclean, an OS background kill is not a crash)
  overall 88.2 % (15 of 17 sessions, 95 % CI 65.7-96.7 %)
  android: sessions 100.0 % (0 crashed of 10, 95 % CI 72.2-100.0 %); users 100.0 % (3 of 3)
  ios: sessions 71.4 % (2 crashed of 7, 95 % CI 35.9-91.8 %); users 0.0 % (0 of 2)
  sessions with unknown outcome (still open at export), left out: 1
  of the crashes, zero-length (unclean flag with no open session, e.g. a boot crash): 1

Data quality
  files 7: 7 valid, 0 rejected
  events 90, duplicates removed 6
  dropped on device (sum of file headers): queue cap 0, expired 2, invalid 0
  installs with events left on the device (remaining > 0 in the latest file): 0
  intervals without app_backgrounded closed at the last event: 1; backgrounded without app_opened: 0
```

Reading it: with a roster the unit is the tester (5), not the install (6); without the roster tester t03 would count twice
(6 testers) and the second install would show as "no answer". The 66.7 % Yes with n = 3 has a CI of 21 to 94 %, which is why
the plan says to weigh survey, debrief and behaviour together. The zero crashes on Android and 2 of 7 sessions on iOS are
fixture design, not a finding.
