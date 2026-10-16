import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PLAYTEST_EXPORT_MAX_BYTES } from "../../apps/mobile/src/export/playtest-data.ts";
import { main, parseArgs } from "./cli.mjs";
import { computeReadout, parseRoster, quantile, reconstructSessions, summarise, wilson } from "./exit-kpi.mjs";
import { Device, exportFile, makeRng, stage0Dataset, uuidV4 } from "./fixtures.mjs";
import { renderText } from "./render.mjs";

const MIN = 60_000;
const rng = () => makeRng(7);
const day = (n) => `2026-10-${String(12 + n).padStart(2, "0")}T20:00:00.000Z`;
const readout = (files, rosterText) =>
  computeReadout({ files: files.map((text) => ({ text })), rosterText });

/** Cold sessions of the given minutes, each with one finished match, one day apart. */
function coldSessions(device, minutes) {
  minutes.forEach((m, i) => {
    if (i > 0) device.wait(20 * 3_600_000);
    device.open(false).match(m * MIN).background();
  });
  return device;
}

test("statistics: quantile, summarise, wilson", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([4, 6, 8, 10], 0.5), 7);
  assert.equal(quantile([4, 6, 8, 10], 0.25), 5.5);
  assert.equal(quantile([4, 6, 8, 10], 0.75), 8.5);
  assert.deepEqual(summarise([3]), { n: 1, median: 3, q1: 3, q3: 3 });
  assert.equal(wilson(0, 0), null);
  const w = wilson(7, 10);
  assert.ok(Math.abs(w.low - 0.3968) < 1e-3 && Math.abs(w.high - 0.8922) < 1e-3);
  // Edges: the interval is clamped to [0, 1] and the point estimate stays inside it.
  const none = wilson(0, 10);
  assert.equal(none.low, 0);
  assert.ok(Math.abs(none.high - 0.2775) < 1e-3);
  const all = wilson(10, 10);
  assert.ok(all.high <= 1 && all.high > 1 - 1e-9);
  assert.ok(Math.abs(all.low - 0.7225) < 1e-3);
  assert.equal(wilson(1, 1).high, 1);
  assert.equal(wilson(0, 1).low, 0);
});

test("median session: hand-computed median, IQR and n", () => {
  const d = coldSessions(new Device({ rng: rng() }), [4, 6, 8, 10]);
  const r = readout([exportFile(d, { exportedAt: day(5) })]);
  assert.deepEqual(r.medianSession.sessions, { n: 4, median: 7 * MIN, q1: 5.5 * MIN, q3: 8.5 * MIN });
  assert.equal(r.medianSession.sessionsUnder10s, 0);
});

test("median session: a single session", () => {
  const d = new Device({ rng: rng() });
  d.open(false).match(9 * MIN).background();
  const r = readout([exportFile(d, { exportedAt: day(1) })]);
  assert.deepEqual(r.medianSession.sessions, { n: 1, median: 9 * MIN, q1: 9 * MIN, q3: 9 * MIN });
  assert.equal(r.medianSession.medianOfTesterMedians, 9 * MIN);
});

test("median session: primary is over sessions, secondary over per-tester medians", () => {
  const heavy = coldSessions(new Device({ rng: rng() }), [10, 10, 10, 10]);
  const light = coldSessions(new Device({ rng: makeRng(8) }), [2]);
  const r = readout([exportFile(heavy, { exportedAt: day(5) }), exportFile(light, { exportedAt: day(5) })]);
  assert.equal(r.medianSession.sessions.median, 10 * MIN); // sessions 2,10,10,10,10
  assert.equal(r.medianSession.medianOfTesterMedians, 6 * MIN); // testers 10 and 2
  assert.equal(r.medianSession.testers, 2);
});

test("session gap: 30 min of background joins, 31 min splits (Q-12)", () => {
  const joined = new Device({ rng: rng() });
  joined.open(false).match(3 * MIN).background();
  joined.wait(30 * MIN).open().wait(2 * MIN).background();
  assert.deepEqual(reconstructSessions(joined.events).sessions.map((s) => s.foregroundMs), [5 * MIN]);

  const split = new Device({ rng: rng() });
  split.open(false).match(3 * MIN).background();
  split.wait(31 * MIN).open().wait(2 * MIN).background();
  assert.deepEqual(reconstructSessions(split.events).sessions.map((s) => s.foregroundMs), [3 * MIN, 2 * MIN]);
});

test("sessions crossing files: complete once the second file arrives, incomplete before", () => {
  const d = new Device({ rng: rng() });
  d.open(false).match(4 * MIN);
  const cut = d.events.length;
  d.wait(MIN).background();
  const first = exportFile(d, { to: cut, exportedAt: day(1) });
  const second = exportFile(d, { from: cut, exportedAt: day(2) });

  const alone = readout([first]);
  assert.equal(alone.medianSession.sessions.n, 0);
  assert.equal(alone.medianSession.incompleteSessionsExcluded, 1);
  assert.equal(alone.medianSession.sessions.median, null);

  const both = readout([second, first]); // argument order does not matter: exportedAt orders the files
  assert.equal(both.medianSession.sessions.n, 1);
  assert.equal(both.medianSession.sessions.median, 5 * MIN);
  assert.equal(both.dataQuality.duplicateEvents, 0);
});

test("median session: sessions closed by the next cold start (no app_backgrounded) are lower bounds, kept out of the median", () => {
  // Clean case (iOS app-switcher swipe: no background event): 4 min of play, then a clean cold start a day later.
  const swipe = new Device({ rng: makeRng(31), platform: "ios" });
  swipe.open(false).match(4 * MIN).wait(3 * MIN); // swiped away here
  swipe.wait(20 * 3_600_000).open(false).match(10 * MIN).background();
  const sw = reconstructSessions(swipe.events).sessions;
  assert.deepEqual(sw.map((x) => [x.outcome, x.foregroundMs, x.lowerBound]), [["clean", 4 * MIN, true], ["clean", 10 * MIN, false]]);

  // Crashed case: the same, but the cold start reports the unclean exit.
  const crash = new Device({ rng: makeRng(32), platform: "ios" });
  crash.open(false).match(6 * MIN).wait(MIN);
  crash.wait(20 * 3_600_000).open(true).match(12 * MIN).background();
  const cr = reconstructSessions(crash.events).sessions;
  assert.deepEqual(cr.map((x) => [x.outcome, x.foregroundMs, x.lowerBound]), [["crashed", 6 * MIN, true], ["clean", 12 * MIN, false]]);

  const r = readout([exportFile(swipe, { exportedAt: day(2) }), exportFile(crash, { exportedAt: day(2) })]);
  const m = r.medianSession;
  // Without the lower bounds: 10 and 12 min. With them: 4, 6, 10, 12.
  assert.deepEqual(m.sessions, { n: 2, median: 11 * MIN, q1: 10.5 * MIN, q3: 11.5 * MIN });
  assert.deepEqual(m.withLowerBound, { n: 4, median: 8 * MIN, q1: 5.5 * MIN, q3: 10.5 * MIN });
  assert.equal(m.lowerBoundSessions, 2);
  assert.equal(m.testers, 2);
  assert.match(renderText(r), /median 11\.0 min, IQR 10\.5 min to 11\.5 min, n = 2 sessions/);
  assert.match(renderText(r), /with lower-bound sessions added \(2\): median 8\.0 min, IQR 5\.5 min to 10\.5 min, n = 4/);
  // A well-formed session (closed by app_backgrounded) is never a lower bound.
  assert.equal(reconstructSessions(coldSessions(new Device({ rng: rng() }), [5, 6]).events).sessions.some((x) => x.lowerBound), false);
});

test("duplicate events across overlapping files are counted once", () => {
  const d = coldSessions(new Device({ rng: rng() }), [5, 7]);
  const n = d.events.length;
  const once = readout([exportFile(d, { exportedAt: day(3) })]);
  const twice = readout([exportFile(d, { to: n - 3, exportedAt: day(2) }), exportFile(d, { from: 2, exportedAt: day(3) })]);
  assert.equal(twice.dataQuality.duplicateEvents, n - 3 - 2);
  assert.equal(twice.dataQuality.events, n - 3 + (n - 2));
  assert.deepEqual(twice.medianSession, once.medianSession);
});

test("empty input: no files, and an empty-events file is rejected", () => {
  const none = readout([]);
  assert.equal(none.population.installs, 0);
  assert.equal(none.medianSession.sessions.median, null);
  assert.equal(none.wouldPlayAgain.yesShare.value, null);
  assert.equal(none.crashFree.overall.value, null);
  assert.equal(none.population.exportDates, null);
  assert.match(renderText(none), /n = 0 sessions/);

  const d = new Device({ rng: rng() });
  d.interval(MIN, false);
  const text = JSON.parse(exportFile(d, { exportedAt: day(1) }));
  text.events = [];
  const r = readout([JSON.stringify(text)]);
  assert.equal(r.dataQuality.filesInvalid.length, 1);
  assert.match(r.dataQuality.filesInvalid[0].issues.join(), /events/);
});

test("would play again: dismissed-only answers give n = 0", () => {
  const d = new Device({ rng: rng() });
  d.open(false).match(MIN).survey("dismissed").survey("dismissed", 2).background();
  const w = readout([exportFile(d, { exportedAt: day(1) })]).wouldPlayAgain;
  assert.equal(w.n, 0);
  assert.equal(w.dismissedOnly, 1);
  assert.equal(w.dismissedAnswerEvents, 2);
  assert.equal(w.surveyShownEvents, 2);
  assert.equal(w.yesShare.value, null);
});

test("would play again: last non-dismissed answer wins, a later dismissal does not", () => {
  const d = new Device({ rng: rng() });
  d.open(false).match(MIN).survey("yes");
  d.wait(MIN).survey("no", 2);
  d.wait(MIN).survey("dismissed", 3).background();
  const w = readout([exportFile(d, { exportedAt: day(1) })]).wouldPlayAgain;
  assert.deepEqual([w.yes, w.maybe, w.no, w.n], [0, 0, 1, 1]);
});

test("would play again: shares and CI with several testers", () => {
  const files = [];
  ["yes", "yes", "yes", "maybe", "no"].forEach((answer, i) => {
    const d = new Device({ rng: makeRng(100 + i) });
    d.open(false).match(MIN).survey(answer).background();
    files.push(exportFile(d, { exportedAt: day(1) }));
  });
  const w = readout(files).wouldPlayAgain;
  assert.equal(w.n, 5);
  assert.equal(w.yesShare.value, 0.6);
  assert.equal(w.maybeShare.value, 0.2);
  assert.ok(w.yesShare.ci95.low < 0.6 && w.yesShare.ci95.high > 0.6);
  assert.equal(w.unit, "install");
});

test("consent off/on gives a new install id: the roster merges them, without it they count twice", () => {
  const before = new Device({ rng: makeRng(1) });
  before.open(false).match(6 * MIN).survey("yes").background();
  const after = new Device({ rng: makeRng(2), startMs: before.now + 86_400_000 });
  after.open(false).match(5 * MIN).survey("no", 2).background();
  const files = [exportFile(before, { exportedAt: day(1) }), exportFile(after, { exportedAt: day(3) })];
  const roster = `tester_id,install_id\nt01,${before.installId}\nt01,${after.installId}\n`;

  const withRoster = readout(files, roster);
  assert.equal(withRoster.population.testers, 1);
  assert.equal(withRoster.population.installs, 2);
  assert.equal(withRoster.wouldPlayAgain.unit, "tester");
  assert.deepEqual([withRoster.wouldPlayAgain.n, withRoster.wouldPlayAgain.no, withRoster.wouldPlayAgain.yes], [1, 1, 0]);
  assert.equal(withRoster.population.activeTesters, 1);

  const without = readout(files);
  assert.equal(without.population.testers, 2);
  assert.equal(without.wouldPlayAgain.n, 2);
});

test("roster: unmapped installs, testers without data, errors", () => {
  const a = new Device({ rng: makeRng(1) });
  a.interval(MIN, false);
  const b = new Device({ rng: makeRng(2) });
  b.interval(MIN, false);
  const roster = `tester_id,install_id\nt01,${a.installId}\nt02,\nt03,${uuidV4(makeRng(9))}\n`;
  const r = readout([exportFile(a, { exportedAt: day(1) }), exportFile(b, { exportedAt: day(1) })], roster);
  assert.equal(r.population.installsMappedByRoster, 1);
  assert.equal(r.population.installsNotInRoster, 1);
  assert.equal(r.population.rosterTestersWithoutData, 2);
  assert.equal(r.population.testers, 2);

  assert.equal(parseRoster("").ok, false);
  assert.match(parseRoster("a,b\n1,2").error, /header/);
  assert.match(parseRoster("tester_id,install_id\nt1,not-a-uuid").error, /UUID/);
  const id = uuidV4(makeRng(3));
  assert.match(parseRoster(`tester_id,install_id\nt1,${id}\nt2,${id}`).error, /two testers/);
  assert.throws(() => readout([], "tester_id,install_id\nt1,xyz"), /roster rejected/);
});

test("crash-free: crash with an open interval, boot crash, and an OS background kill (not a crash)", () => {
  // Session 1 ends in the foreground (no app_backgrounded), the next cold start reports it: crashed, lower bound 3 min.
  const crash = new Device({ rng: makeRng(1), platform: "ios" });
  crash.open(false).match(3 * MIN).wait(2 * MIN); // killed here
  crash.wait(MIN).open(true).match(4 * MIN).background();
  // The relaunch is 3 min after the last event: the same session (Q-12), 3 + 4 min, counted as crashed.
  crash.wait(20 * 3_600_000).open(false).match(MIN).background(); // a separate, clean session
  const s = reconstructSessions(crash.events).sessions;
  assert.deepEqual(s.map((x) => [x.outcome, x.foregroundMs]), [["crashed", 7 * MIN], ["clean", MIN]]);

  // Boot crash: the previous session closed cleanly, nothing was open; a separate zero-length crashed session.
  const boot = new Device({ rng: makeRng(2), platform: "ios" });
  boot.open(false).match(2 * MIN).background();
  boot.wait(MIN).open(true).wait(MIN).background();
  const b = reconstructSessions(boot.events).sessions;
  assert.equal(b.filter((x) => x.zeroLength && x.outcome === "crashed").length, 1);
  assert.deepEqual(b.filter((x) => !x.zeroLength).map((x) => [x.foregroundMs, x.outcome]), [[3 * MIN, "clean"]]); // 2 + 1 min joined (1 min gap), closed by app_backgrounded

  // OS kill in the background: the marker was removed at background, so the next cold start says false.
  const killed = new Device({ rng: makeRng(3), platform: "android" });
  killed.open(false).match(5 * MIN).background();
  killed.wait(6 * 3_600_000).open(false).match(MIN).background();
  const k = reconstructSessions(killed.events).sessions;
  assert.deepEqual(k.map((x) => x.outcome), ["clean", "clean"]);

  const r = readout([
    exportFile(crash, { exportedAt: day(3) }),
    exportFile(boot, { exportedAt: day(3) }),
    exportFile(killed, { exportedAt: day(3) }),
  ]);
  const ios = r.crashFree.byPlatform.ios;
  // crash device: crashed + clean; boot device: zero-length crashed + the joined session (clean)
  assert.deepEqual([ios.sessions, ios.crashed, ios.unknownOutcomeExcluded], [4, 2, 0]);
  assert.equal(r.crashFree.byPlatform.android.crashed, 0);
  assert.equal(r.crashFree.byPlatform.android.sessions, 2);
  assert.equal(r.crashFree.byPlatform.android.crashFreeSessions.value, 1);
  assert.equal(r.crashFree.usersByPlatform.android.value, 1);
  assert.equal(r.crashFree.usersByPlatform.ios.value, 0);
});

test("crash-free: warm sessions after the last cold start are clean (they closed with app_backgrounded)", () => {
  // 1 cold session + 5 warm sessions 3 h apart (each its own session), then the export is made in the foreground.
  const d = new Device({ rng: makeRng(11), platform: "android" });
  d.open(false).match(MIN).background();
  for (let i = 0; i < 5; i += 1) d.wait(3 * 3_600_000).open().wait(2 * MIN).background();
  d.wait(3 * 3_600_000).open().wait(MIN); // the export: foreground, open tail
  const s = reconstructSessions(d.events).sessions;
  assert.deepEqual(s.map((x) => x.outcome), ["clean", "clean", "clean", "clean", "clean", "clean", "unknown"]);
  const cf = readout([exportFile(d, { exportedAt: day(2) })]).crashFree;
  assert.deepEqual([cf.byPlatform.android.sessions, cf.byPlatform.android.crashed], [6, 0]);
  assert.equal(cf.byPlatform.android.crashFreeSessions.value, 1);
  assert.equal(cf.overall.value, 1);
  assert.equal(cf.sessionsWithUnknownOutcome, 1);
  // A trailing session that closed with app_backgrounded is clean too: nothing can make it unclean afterwards.
  const e = new Device({ rng: makeRng(12), platform: "android" });
  e.open(false).match(MIN).background();
  assert.equal(readout([exportFile(e, { exportedAt: day(1) })]).crashFree.overall.n, 1);
});

test("crash-free: a crash does not end the session; a relaunch within 30 min continues it as a crashed session (Q-12)", () => {
  const within = new Device({ rng: makeRng(13), platform: "ios" });
  within.open(false).match(3 * MIN).wait(MIN); // killed in the foreground
  within.wait(10 * MIN).open(true).wait(2 * MIN).background();
  const a = reconstructSessions(within.events).sessions;
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].outcome, a[0].foregroundMs], ["crashed", 5 * MIN]);

  const after = new Device({ rng: makeRng(14), platform: "ios" });
  after.open(false).match(3 * MIN).wait(MIN);
  after.wait(40 * MIN).open(true).wait(2 * MIN).background(); // gap from the last event: 40 min
  const b = reconstructSessions(after.events).sessions;
  assert.deepEqual(b.map((x) => [x.outcome, x.foregroundMs]), [["crashed", 3 * MIN], ["clean", 2 * MIN]]);
});

test("de-duplication keys on install and event_id: the same event_id in two installs is two events", () => {
  const a = new Device({ rng: makeRng(21) });
  a.interval(MIN, false);
  const b = new Device({ rng: makeRng(22) });
  b.interval(MIN, false);
  const shared = a.events[0].event_id;
  b.events[0] = { ...b.events[0], event_id: shared };
  const r = readout([exportFile(a, { exportedAt: day(1) }), exportFile(b, { exportedAt: day(1) })]);
  assert.equal(r.dataQuality.duplicateEvents, 0);
  assert.equal(r.dataQuality.events, 4);
  assert.equal(r.crashFree.overall.n, 2);
});

test("crash-free: hand-computed rate per platform", () => {
  // android: 4 sessions, 1 crashed -> 75 %
  const d = new Device({ rng: makeRng(5), platform: "android" });
  d.open(false).wait(MIN).background(); // 1 clean
  d.wait(2 * 3_600_000).open(false).wait(MIN); // killed in the foreground
  d.wait(MIN).open(true).wait(MIN).background(); // 2 crashed (the relaunch 2 min later continues it)
  d.wait(2 * 3_600_000).open(false).wait(MIN).background(); // 3 clean
  d.wait(2 * 3_600_000).open(false).wait(MIN).background(); // 4 clean
  const r = readout([exportFile(d, { exportedAt: day(2) })]);
  const a = r.crashFree.byPlatform.android;
  assert.deepEqual([a.sessions, a.crashed, a.unknownOutcomeExcluded], [4, 1, 0]);
  assert.equal(a.crashFreeSessions.value, 0.75);
  assert.equal(r.crashFree.sessionsWithUnknownOutcome, 0);
});

test("a background-then-return of a recording that started mid-foreground (orphan app_backgrounded) is one session", () => {
  const d = new Device({ rng: makeRng(6) });
  d.wait(4 * MIN).push("app_backgrounded", { foreground_ms: 4 * MIN });
  const { sessions, anomalies } = reconstructSessions(d.events);
  assert.equal(anomalies.orphanBackgrounded, 1);
  assert.equal(sessions[0].foregroundMs, 4 * MIN);
});

test("malformed files are rejected with a clear error and the CLI refuses unless --allow-invalid", () => {
  const d = new Device({ rng: rng() });
  d.open(false).match(MIN).background();
  const good = exportFile(d, { exportedAt: day(1) });
  const wrongFormat = JSON.stringify({ ...JSON.parse(good), exportFormat: 2 });
  const extraKey = JSON.stringify({ ...JSON.parse(good), email: "a@b.c" });
  const mismatch = JSON.parse(good);
  mismatch.installId = uuidV4(makeRng(99));
  const r = readout(["{not json", wrongFormat, extraKey, JSON.stringify(mismatch), good]);
  assert.equal(r.dataQuality.filesValid, 1);
  assert.deepEqual(r.dataQuality.filesInvalid.map((f) => f.index), [1, 2, 3, 4]);
  assert.match(r.dataQuality.filesInvalid[0].issues[0], /invalid_json/);
  assert.ok(r.dataQuality.filesInvalid.every((f) => f.code === "INVALID"));
  assert.ok(r.dataQuality.filesInvalid[2].issues.join().includes("unrecognized_keys"));
  assert.ok(!JSON.stringify(r).includes("a@b.c"));

  const dir = mkdtempSync(join(tmpdir(), "readout-"));
  try {
    const bad = join(dir, "bad.json");
    const ok = join(dir, "ok.json");
    writeFileSync(bad, "{not json");
    writeFileSync(ok, good);
    const log = [];
    const origOut = process.stdout.write;
    const origErr = console.error;
    process.stdout.write = (chunk) => (log.push(String(chunk)), true);
    console.error = (...a) => log.push(a.join(" "));
    try {
      assert.equal(main([ok, bad]), 1);
      assert.equal(main(["--allow-invalid", ok, bad]), 0);
      assert.equal(main([]), 2);
      assert.equal(main(["--roster", join(dir, "missing.csv"), ok]), 2);
    } finally {
      process.stdout.write = origOut;
      console.error = origErr;
    }
    assert.match(log.join(""), /file #2: INVALID \(<root>: invalid_json\)/);
    assert.match(log.join(""), /1 file\(s\) rejected/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("CLI checks the file size before reading: a file above the decoder cap is rejected as TOO_LARGE without being read", () => {
  const dir = mkdtempSync(join(tmpdir(), "readout-"));
  try {
    const big = join(dir, "big.json");
    writeFileSync(big, " ".repeat(PLAYTEST_EXPORT_MAX_BYTES + 1));
    const ok = join(dir, "ok.json");
    const d = new Device({ rng: rng() });
    d.open(false).match(MIN).background();
    writeFileSync(ok, exportFile(d, { exportedAt: day(1) }));
    const log = [];
    const origOut = process.stdout.write;
    const origErr = console.error;
    process.stdout.write = (chunk) => (log.push(String(chunk)), true);
    console.error = (...a) => log.push(a.join(" "));
    try {
      assert.equal(main(["--allow-invalid", ok, big]), 0);
      assert.equal(main([ok, big]), 1);
    } finally {
      process.stdout.write = origOut;
      console.error = origErr;
    }
    assert.match(log.join(""), /file #2: TOO_LARGE/);
    const r = computeReadout({ files: [{ text: "", tooLargeBytes: PLAYTEST_EXPORT_MAX_BYTES + 1 }] });
    assert.deepEqual(r.dataQuality.filesInvalid, [{ index: 1, code: "TOO_LARGE", issues: [] }]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("parseArgs", () => {
  assert.deepEqual(parseArgs(["--roster", "r.csv", "--json", "o.json", "a.json", "b.json"]), {
    files: ["a.json", "b.json"],
    roster: "r.csv",
    json: "o.json",
    text: undefined,
    allowInvalid: false,
  });
  assert.throws(() => parseArgs([]), /no export files/);
  assert.throws(() => parseArgs(["--roster"]), /needs a value/);
  assert.throws(() => parseArgs(["--nope", "a"]), /unknown option/);
});

test("data quality: dropped counts, remaining, mixed platform", () => {
  const d = new Device({ rng: rng() });
  d.interval(MIN, false);
  const a = exportFile(d, { exportedAt: day(1), dropped: { queueCap: 3, expired: 2, invalid: 1 }, remaining: 4 });
  const b = exportFile(d, { exportedAt: day(2), dropped: { queueCap: 1, expired: 0, invalid: 0 }, remaining: 0 });
  const q = readout([a, b]).dataQuality;
  assert.deepEqual(q.dropped, { queueCap: 4, expired: 2, invalid: 1 });
  assert.equal(q.installsWithRemaining, 0); // the latest file has nothing left
  assert.equal(readout([a]).dataQuality.installsWithRemaining, 1);
});

test("output is deterministic, ordered, and carries no raw ids", () => {
  const { files, rosterCsv } = stage0Dataset();
  const texts = files.map((f) => f.text);
  const r1 = readout(texts, rosterCsv);
  const r2 = readout([...texts].reverse(), rosterCsv);
  assert.equal(JSON.stringify(r1), JSON.stringify(readout(texts, rosterCsv)));
  assert.equal(renderText(r1), renderText(readout(texts, rosterCsv)));
  // File order only changes the 1-based file numbers of rejected files (none here).
  assert.deepEqual(r1.medianSession, r2.medianSession);
  assert.deepEqual(r1.wouldPlayAgain, r2.wouldPlayAgain);
  const all = JSON.stringify(r1) + renderText(r1);
  for (const f of files) assert.ok(!all.includes(JSON.parse(f.text).installId));
  for (const line of rosterCsv.split("\n").slice(1)) if (line) assert.ok(!all.includes(line.split(",")[0] + ","));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-4/.test(all));
});

test("dry run on the synthetic Stage 0 export: numbers hand-computed from the fixture construction", () => {
  const { files, rosterCsv } = stage0Dataset();
  const r = readout(files.map((f) => f.text), rosterCsv);
  assert.deepEqual(r.population, {
    installs: 6,
    testers: 5,
    activeTesters: 4,
    rosterUsed: true,
    installsMappedByRoster: 6,
    installsNotInRoster: 0,
    rosterTestersWithoutData: 0,
    exportDates: { first: "2026-10-14", last: "2026-10-18" },
  });
  // Sessions of active testers, in minutes (a crash does not split a session; a warm return within 30 min joins):
  // t01 10,11,14,9,12; t02 17 (13 + 4 after 5 min away), 8, 14 (5 lower bound + 9 after the crash), 10;
  // t03 11,12 and 14,10; t04 5 and 0.1. That is 15 sessions: 0.1,5,8,9,10,10,10,11,11,12,12,14,14,14,17.
  // t02's 14 min session holds a lower bound (the crashed interval was open): out of the median, into "with".
  // Exact (14): 0.1,5,8,9,10,10,10,11,11,12,12,14,14,17 -> median (10 + 11) / 2, q1 9 + 0.25, q3 12.
  assert.deepEqual(r.medianSession.sessions, { n: 14, median: 10.5 * MIN, q1: 9.25 * MIN, q3: 12 * MIN });
  assert.deepEqual(r.medianSession.withLowerBound, { n: 15, median: 11 * MIN, q1: 9.5 * MIN, q3: 13 * MIN });
  assert.equal(r.medianSession.lowerBoundSessions, 1);
  assert.equal(r.medianSession.sessionsUnder10s, 1);
  assert.equal(r.medianSession.sessionsOfNonActiveTestersExcluded, 1); // t05's 3 min session
  assert.equal(r.medianSession.incompleteSessionsExcluded, 1); // t05's open tail (non-active, but incomplete comes first)
  const w = r.wouldPlayAgain;
  assert.deepEqual([w.n, w.yes, w.maybe, w.no, w.dismissedOnly, w.withoutAnswer], [3, 2, 1, 0, 1, 1]);
  // Decided sessions: android t01 5 + t03 2 + 2 + t05 1 (its second session is open at export) = 10;
  // ios t02 4 + t04 (5 min, boot crash, 6 s) 3 = 7. Crashed: t02's crash and t04's boot crash. Overall 15 of 17.
  const cf = r.crashFree;
  assert.deepEqual([cf.byPlatform.ios.sessions, cf.byPlatform.ios.crashed], [7, 2]);
  assert.deepEqual([cf.byPlatform.android.sessions, cf.byPlatform.android.crashed], [10, 0]);
  assert.deepEqual([cf.overall.k, cf.overall.n], [15, 17]);
  assert.ok(Math.abs(cf.overall.value - 15 / 17) < 1e-12);
  assert.equal(cf.sessionsWithUnknownOutcome, 1);
  assert.equal(cf.zeroLengthCrashedSessions, 1);
  assert.equal(r.dataQuality.duplicateEvents, 6);
  assert.equal(r.dataQuality.dropped.expired, 2);
  assert.equal(r.dataQuality.unterminatedIntervals, 1);
  assert.equal(readout(files.map((f) => f.text)).population.testers, 6); // no roster: t03 counted twice
});

test("the committed dry-run example matches the generator", () => {
  const { files, rosterCsv } = stage0Dataset();
  const out = renderText(readout(files.map((f) => f.text), rosterCsv));
  const doc = readFileSync(new URL("../../docs/specs/E-1.5-play-vs-bot/exit-kpi-readout-dry-run.md", import.meta.url), "utf8");
  assert.ok(doc.includes(out.trimEnd()), "regenerate the fenced readout in exit-kpi-readout-dry-run.md");
});
