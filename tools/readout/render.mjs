/** Human-readable text of a readout (`computeReadout`). Deterministic; prints counts only, never ids. */

const pct = (s) => (s.value === null ? "n/a" : `${(s.value * 100).toFixed(1)} %`);
const ci = (s) =>
  s.ci95 === null ? "" : `, 95 % CI ${(s.ci95.low * 100).toFixed(1)}-${(s.ci95.high * 100).toFixed(1)} %`;
const mins = (ms) => (ms === null ? "n/a" : `${(ms / 60000).toFixed(1)} min`);

export function renderText(r) {
  const p = r.population;
  const m = r.medianSession;
  const w = r.wouldPlayAgain;
  const c = r.crashFree;
  const q = r.dataQuality;
  const L = [];
  L.push("CODELEX Phase 1 exit-KPI readout (E-1.5 play vs bot)");
  L.push("");
  L.push("Population");
  L.push(`  installs ${p.installs}, testers ${p.testers}, active testers (>= 1 finished match) ${p.activeTesters}`);
  if (p.exportDates !== null) L.push(`  exports dated ${p.exportDates.first} to ${p.exportDates.last}`);
  if (p.rosterUsed) {
    L.push(
      `  roster: ${p.installsMappedByRoster} installs mapped, ${p.installsNotInRoster} not in roster (counted as their own tester), ${p.rosterTestersWithoutData} roster testers without data`,
    );
  } else {
    L.push("  no roster: one install = one tester (a consent off/on makes one tester count twice)");
  }
  L.push("");
  L.push("Median session length (target >= 8 min; sessions of active testers)");
  L.push(
    `  median ${mins(m.sessions.median)}, IQR ${mins(m.sessions.q1)} to ${mins(m.sessions.q3)}, n = ${m.sessions.n} sessions from ${m.testers} testers`,
  );
  L.push(
    `  with lower-bound sessions added (${m.lowerBoundSessions}): median ${mins(m.withLowerBound.median)}, IQR ${mins(m.withLowerBound.q1)} to ${mins(m.withLowerBound.q3)}, n = ${m.withLowerBound.n} (lower bound: no app_backgrounded, closed at the last event by the next cold start; not in the figure above)`,
  );
  L.push(`  median of per-tester medians ${mins(m.medianOfTesterMedians)}`);
  L.push(`  sessions under 10 s (kept in the figures): ${m.sessionsUnder10s}`);
  L.push(
    `  excluded: ${m.incompleteSessionsExcluded} incomplete sessions (still open at export), ${m.sessionsOfNonActiveTestersExcluded} sessions of non-active testers`,
  );
  L.push("");
  L.push(`Would play again (target Yes >= 70 %; last non-dismissed answer per ${w.unit})`);
  L.push(`  n = ${w.n}: Yes ${w.yes} (${pct(w.yesShare)}${ci(w.yesShare)}), Maybe ${w.maybe} (${pct(w.maybeShare)}), No ${w.no} (${pct(w.noShare)})`);
  L.push(
    `  dismissed only ${w.dismissedOnly}, no answer ${w.withoutAnswer}; dismissed answer events ${w.dismissedAnswerEvents} of ${w.surveyShownEvents} survey cards shown`,
  );
  L.push("");
  L.push("Crash-free (target >= 99.5 % per platform; crash = previous_exit_unclean, an OS background kill is not a crash)");
  L.push(`  overall ${pct(c.overall)} (${c.overall.k} of ${c.overall.n} sessions${ci(c.overall)})`);
  for (const [platform, row] of Object.entries(c.byPlatform)) {
    const u = c.usersByPlatform[platform];
    L.push(
      `  ${platform}: sessions ${pct(row.crashFreeSessions)} (${row.crashed} crashed of ${row.sessions}${ci(row.crashFreeSessions)}); users ${pct(u)} (${u.k} of ${u.n})`,
    );
  }
  L.push(`  sessions with unknown outcome (still open at export), left out: ${c.sessionsWithUnknownOutcome}`);
  L.push(`  of the crashes, zero-length (unclean flag with no open session, e.g. a boot crash): ${c.zeroLengthCrashedSessions}`);
  L.push("");
  L.push("Data quality");
  L.push(`  files ${q.files}: ${q.filesValid} valid, ${q.filesInvalid.length} rejected`);
  for (const f of q.filesInvalid) {
    L.push(`    file #${f.index}: ${f.code}${f.issues.length > 0 ? ` (${f.issues.join("; ")})` : ""}`);
  }
  L.push(`  events ${q.events}, duplicates removed ${q.duplicateEvents}`);
  L.push(`  dropped on device (sum of file headers): queue cap ${q.dropped.queueCap}, expired ${q.dropped.expired}, invalid ${q.dropped.invalid}`);
  L.push(`  installs with events left on the device (remaining > 0 in the latest file): ${q.installsWithRemaining}`);
  L.push(`  intervals without app_backgrounded closed at the last event: ${q.unterminatedIntervals}; backgrounded without app_opened: ${q.orphanBackgrounded}`);
  if (q.installsMixedPlatform > 0) L.push(`  installs with files of two platforms: ${q.installsMixedPlatform}`);
  L.push("");
  return L.join("\n");
}
