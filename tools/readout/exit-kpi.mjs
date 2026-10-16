/**
 * Exit-KPI readout (sprint 4 KR; E-1.5 playtest plan section 4.1). Pure computation: takes the texts of playtest
 * export files (exportFormat 1) and an optional roster, returns a plain-object readout. No I/O, no clock, no random:
 * the same inputs give the same output, byte for byte. File reading and the CLI live in `cli.mjs`, text rendering in
 * `render.mjs`.
 *
 * Decoding uses the D1 contract (`decodePlaytestExport`, zod/mini, size cap, strict schema); Node 22.18+ loads the
 * `.ts` modules directly (type stripping), so there is no second copy of the schemas.
 *
 * Definitions (fixed before data arrives; see README.md):
 * - Events of one install are ordered by file order (files sorted by `exportedAt`, ties by argument order), then by
 *   position in the file. `occurred_at` only places intervals in time and measures background gaps.
 * - Events are de-duplicated by install and `event_id` across all files (first occurrence wins).
 * - Session (Q-12): foreground intervals separated by at most 30 min of background; length = sum of `foreground_ms`.
 * - Crash: `app_opened.previous_exit_unclean = true` on a cold start (S6a session marker). Nothing else. A session
 *   containing a crash is crashed, and a relaunch within 30 min continues it.
 */
import { decodePlaytestExport } from "../../apps/mobile/src/export/playtest-data.ts";

export const READOUT_SCHEMA = "codelex.exit_kpi_readout";
export const READOUT_VERSION = 1;
/** Q-12: a session closes after 30 min in background. */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/** Playtest plan 4.1: sessions shorter than this are reported separately, not excluded. */
export const SHORT_SESSION_MS = 10_000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- statistics -----------------------------------------------------------------------------------------------------

/** Linear-interpolation quantile (type 7) of a sorted array; null when empty. */
export function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
  };
}

/** Wilson 95 % interval for k successes in n trials; null when n = 0. */
export function wilson(k, n) {
  if (n === 0) return null;
  const z = 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

const share = (k, n) => ({ k, n, value: n === 0 ? null : k / n, ci95: wilson(k, n) });

// --- roster ---------------------------------------------------------------------------------------------------------

/**
 * Roster CSV: header `tester_id,install_id`, one row per (tester, install). `tester_id` is the debrief pseudonym
 * (no name, no email), `install_id` the UUID the tester read out of Settings. A tester has several rows after a
 * consent off/on (new install id). Returns `{ ok, installToTester, testers }` or `{ ok: false, error }`.
 */
export function parseRoster(text) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return { ok: false, error: "roster is empty" };
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const ti = header.indexOf("tester_id");
  const ii = header.indexOf("install_id");
  if (ti < 0 || ii < 0) return { ok: false, error: "roster header must contain tester_id and install_id" };
  const installToTester = new Map();
  const testers = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const tester = cells[ti] ?? "";
    const install = (cells[ii] ?? "").toLowerCase();
    if (tester === "") return { ok: false, error: `roster line ${i + 1}: empty tester_id` };
    testers.add(tester);
    // A tester without an install id yet (enrolled, nothing read out) is allowed: only the tester is counted.
    if (install === "") continue;
    if (!UUID_V4.test(install)) return { ok: false, error: `roster line ${i + 1}: install_id is not a UUID v4` };
    const known = installToTester.get(install);
    if (known !== undefined && known !== tester) {
      return { ok: false, error: `roster line ${i + 1}: an install id is listed under two testers` };
    }
    installToTester.set(install, tester);
  }
  return { ok: true, installToTester, testers };
}

// --- sessions -------------------------------------------------------------------------------------------------------

/**
 * Sessions of one install from its ordered, de-duplicated events (ANALYTICS_EVENTS.md "Data-analyst notes D1").
 * Returns `{ sessions, anomalies }`; a session is
 * `{ foregroundMs, outcome: "clean" | "crashed" | "unknown", complete, zeroLength }`.
 *
 * - `app_opened` starts a foreground interval, `app_backgrounded` closes it (`foreground_ms` is added to the session).
 *   A gap of more than 30 min between the last background and the next interval starts a new session (Q-12). A crash
 *   does not end a session: a relaunch within 30 min continues it.
 * - A cold start (`previous_exit_unclean` present) with `true` crashes the session holding the open interval, closed at
 *   the last event before the cold start (a lower bound); with no open interval it is a separate zero-length crashed
 *   session (a boot crash: the crashed process recorded nothing). A session containing an unclean exit is crashed.
 * - Every other session is clean: its last interval was closed by `app_backgrounded`, which deletes the S6a marker
 *   (`session-marker.ts`), so it cannot become unclean later, and a later `app_opened` (warm or cold) proves the
 *   process stayed alive. The only unknown session is one whose last interval is still open at the end of the data
 *   (the export is made in the foreground): `complete: false`, outcome unknown unless it already contains a crash.
 */
export function reconstructSessions(events) {
  const sessions = [];
  const anomalies = { orphanBackgrounded: 0, unterminatedIntervals: 0 };
  let current = null; // the session an interval would join
  let open = null; // { startAt } while an interval is open
  let lastAt = null;

  const beginInterval = (startAt) => {
    if (current !== null && current.lastBgAt !== null && startAt - current.lastBgAt > SESSION_GAP_MS) current = null;
    if (current === null) {
      current = { foregroundMs: 0, lastBgAt: null, outcome: "clean", complete: true, zeroLength: false };
      sessions.push(current);
    }
    open = { startAt };
  };
  /** Closes the open interval at the last event recorded before now (a crash leaves no `app_backgrounded`). */
  const closeUnterminated = () => {
    const end = Math.max(open.startAt, lastAt ?? open.startAt);
    current.foregroundMs += end - open.startAt;
    current.lastBgAt = end;
    open = null;
    return current;
  };

  for (const e of events) {
    const at = Date.parse(e.occurred_at);
    if (e.event === "app_opened") {
      const unclean = e.properties.previous_exit_unclean;
      let crashed = false;
      if (open !== null) {
        anomalies.unterminatedIntervals += 1;
        const closed = closeUnterminated();
        if (unclean === true) {
          closed.outcome = "crashed";
          crashed = true;
        }
      }
      if (unclean === true && !crashed) {
        // Nothing open (e.g. a boot crash): a separate zero-length crashed session.
        sessions.push({ foregroundMs: 0, lastBgAt: null, outcome: "crashed", complete: true, zeroLength: true });
      }
      beginInterval(at);
    } else if (e.event === "app_backgrounded") {
      const ms = e.properties.foreground_ms;
      if (open === null) {
        // Recording started mid-foreground (consent turned on): the interval is [occurred_at - ms, occurred_at].
        anomalies.orphanBackgrounded += 1;
        beginInterval(at - ms);
      }
      current.foregroundMs += ms;
      current.lastBgAt = at;
      open = null;
    }
    lastAt = at;
  }
  // An interval still open at the end of the data (the export is made in the foreground): its length is unknown, and
  // so is the outcome, unless the session already holds a crash.
  if (open !== null) {
    current.complete = false;
    if (current.outcome !== "crashed") current.outcome = "unknown";
  }
  return { sessions, anomalies };
}

// --- readout --------------------------------------------------------------------------------------------------------

/**
 * @param {{ files: { text: string }[], rosterText?: string }} input  `files` in argument order
 * @returns the readout object (JSON-serialisable, deterministic, no raw install or tester ids)
 */
export function computeReadout({ files, rosterText }) {
  const quality = {
    files: files.length,
    filesValid: 0,
    filesInvalid: [], // { index (1-based, argument order), code, issues }
    events: 0,
    duplicateEvents: 0,
    dropped: { queueCap: 0, expired: 0, invalid: 0 },
    installsWithRemaining: 0,
    installsMixedPlatform: 0,
    orphanBackgrounded: 0,
    unterminatedIntervals: 0,
  };

  // 1. Decode.
  const decoded = [];
  files.forEach((f, i) => {
    const r = decodePlaytestExport(f.text);
    if (!r.ok) {
      quality.filesInvalid.push({
        index: i + 1,
        code: r.error.code,
        issues: r.error.code === "INVALID" ? r.error.issues.slice(0, 5) : [],
      });
    } else {
      quality.filesValid += 1;
      decoded.push({ index: i, file: r.value });
    }
  });
  decoded.sort((a, b) =>
    a.file.exportedAt === b.file.exportedAt ? a.index - b.index : a.file.exportedAt < b.file.exportedAt ? -1 : 1,
  );

  // 2. Per install streams, de-duplicated by install and event_id.
  const seen = new Set(); // `${installId}|${event_id}`
  const installs = new Map(); // installId -> { events, platforms, remaining }
  for (const { file } of decoded) {
    let inst = installs.get(file.installId);
    if (inst === undefined) {
      inst = { events: [], platforms: new Set(), remaining: 0 };
      installs.set(file.installId, inst);
    }
    inst.platforms.add(file.app.platform);
    inst.remaining = file.remaining; // the latest file wins
    quality.dropped.queueCap += file.dropped.queueCap;
    quality.dropped.expired += file.dropped.expired;
    quality.dropped.invalid += file.dropped.invalid;
    for (const e of file.events) {
      quality.events += 1;
      const key = `${file.installId}|${e.event_id}`;
      if (seen.has(key)) {
        quality.duplicateEvents += 1;
        continue;
      }
      seen.add(key);
      inst.events.push(e);
    }
  }
  const installIds = [...installs.keys()].sort();

  // 3. Roster: install -> tester. Unmapped installs stand for themselves.
  let roster = null;
  if (rosterText !== undefined) {
    const parsed = parseRoster(rosterText);
    if (!parsed.ok) throw new Error(`roster rejected: ${parsed.error}`);
    roster = parsed;
  }
  const testerOf = (installId) => roster?.installToTester.get(installId) ?? `install:${installId}`;
  const mappedInstalls = installIds.filter((id) => roster?.installToTester.has(id)).length;

  // 4. Per install: sessions, match counts, survey answers.
  const perInstall = new Map();
  for (const id of installIds) {
    const inst = installs.get(id);
    if (inst.remaining > 0) quality.installsWithRemaining += 1;
    if (inst.platforms.size > 1) quality.installsMixedPlatform += 1;
    const { sessions, anomalies } = reconstructSessions(inst.events);
    quality.orphanBackgrounded += anomalies.orphanBackgrounded;
    quality.unterminatedIntervals += anomalies.unterminatedIntervals;
    const answers = [];
    let shown = 0;
    let finished = 0;
    inst.events.forEach((e, order) => {
      if (e.event === "bot_match_finished") finished += 1;
      if (e.event === "playtest_survey_shown") shown += 1;
      if (e.event === "playtest_survey_answered") {
        answers.push({ answer: e.properties.answer, at: Date.parse(e.occurred_at), order });
      }
    });
    perInstall.set(id, { platform: [...inst.platforms].sort()[0], sessions, finished, answers, shown });
  }

  // 5. Group by tester.
  const testers = new Map(); // key -> install ids
  for (const id of installIds) {
    const key = testerOf(id);
    if (!testers.has(key)) testers.set(key, []);
    testers.get(key).push(id);
  }
  const testerKeys = [...testers.keys()].sort();
  const rosterTestersWithoutData =
    roster === null ? null : [...roster.testers].filter((t) => !testers.has(t)).length;
  const activeKeys = new Set(
    testerKeys.filter((key) => testers.get(key).some((id) => perInstall.get(id).finished > 0)),
  );

  // 6. Median session: sessions of active testers with a known length (zero-length crashed sessions have none).
  const allLengths = [];
  const perTesterMedians = [];
  let incompleteSessions = 0;
  let sessionsOfInactive = 0;
  for (const key of testerKeys) {
    const lengths = [];
    for (const id of testers.get(key)) {
      for (const s of perInstall.get(id).sessions) {
        if (s.zeroLength) continue;
        if (!s.complete) incompleteSessions += 1;
        else if (!activeKeys.has(key)) sessionsOfInactive += 1;
        else lengths.push(s.foregroundMs);
      }
    }
    if (lengths.length > 0) {
      allLengths.push(...lengths);
      perTesterMedians.push(summarise(lengths).median);
    }
  }
  const medianSession = {
    unit: "ms",
    sessions: summarise(allLengths),
    testers: perTesterMedians.length,
    medianOfTesterMedians: summarise(perTesterMedians).median,
    sessionsUnder10s: allLengths.filter((ms) => ms < SHORT_SESSION_MS).length,
    incompleteSessionsExcluded: incompleteSessions,
    sessionsOfNonActiveTestersExcluded: sessionsOfInactive,
  };

  // 7. Would play again: per tester, the last non-dismissed answer (by occurred_at, ties by stream order).
  const tally = { yes: 0, maybe: 0, no: 0 };
  let dismissedOnly = 0;
  let withoutAnswer = 0;
  let shownEvents = 0;
  let dismissedEvents = 0;
  for (const key of testerKeys) {
    const all = [];
    for (const id of testers.get(key)) {
      const p = perInstall.get(id);
      shownEvents += p.shown;
      all.push(...p.answers.map((a) => ({ ...a, install: id })));
    }
    dismissedEvents += all.filter((a) => a.answer === "dismissed").length;
    const real = all
      .filter((a) => a.answer !== "dismissed")
      .sort((a, b) => a.at - b.at || a.install.localeCompare(b.install) || a.order - b.order);
    if (real.length > 0) tally[real[real.length - 1].answer] += 1;
    else if (all.length > 0) dismissedOnly += 1;
    else withoutAnswer += 1;
  }
  const answered = tally.yes + tally.maybe + tally.no;
  const wouldPlayAgain = {
    unit: roster === null ? "install" : "tester",
    n: answered,
    yes: tally.yes,
    maybe: tally.maybe,
    no: tally.no,
    yesShare: share(tally.yes, answered),
    maybeShare: share(tally.maybe, answered),
    noShare: share(tally.no, answered),
    dismissedOnly,
    withoutAnswer,
    dismissedAnswerEvents: dismissedEvents,
    surveyShownEvents: shownEvents,
  };

  // 8. Crash-free, per platform (all installs: a crash counts whether or not the tester finished a match).
  const rows = {};
  const userRows = new Map(); // "platform|tester" -> { platform, decided, crashed }
  let unknownOutcome = 0;
  for (const key of testerKeys) {
    for (const id of testers.get(key)) {
      const p = perInstall.get(id);
      const row = (rows[p.platform] ??= { sessions: 0, crashed: 0, unknown: 0 });
      const u = userRows.get(`${p.platform}|${key}`) ?? { platform: p.platform, decided: 0, crashed: 0 };
      for (const s of p.sessions) {
        if (s.outcome === "unknown") {
          row.unknown += 1;
          unknownOutcome += 1;
          continue;
        }
        row.sessions += 1;
        u.decided += 1;
        if (s.outcome === "crashed") {
          row.crashed += 1;
          u.crashed += 1;
        }
      }
      userRows.set(`${p.platform}|${key}`, u);
    }
  }
  const byPlatform = {};
  const usersByPlatform = {};
  for (const platform of Object.keys(rows).sort()) {
    const row = rows[platform];
    byPlatform[platform] = {
      sessions: row.sessions,
      crashed: row.crashed,
      unknownOutcomeExcluded: row.unknown,
      crashFreeSessions: share(row.sessions - row.crashed, row.sessions),
    };
    const users = [...userRows.values()].filter((u) => u.platform === platform && u.decided > 0);
    usersByPlatform[platform] = share(users.filter((u) => u.crashed === 0).length, users.length);
  }
  const zeroLengthCrashed = testerKeys.reduce(
    (n, key) =>
      n + testers.get(key).reduce((m, id) => m + perInstall.get(id).sessions.filter((s) => s.zeroLength).length, 0),
    0,
  );
  const totalDecided = Object.values(rows).reduce((a, r) => a + r.sessions, 0);
  const totalCrashed = Object.values(rows).reduce((a, r) => a + r.crashed, 0);

  const dates = decoded.map((d) => d.file.exportedAt.slice(0, 10)).sort();
  return {
    schema: READOUT_SCHEMA,
    version: READOUT_VERSION,
    population: {
      installs: installIds.length,
      testers: testerKeys.length,
      activeTesters: activeKeys.size,
      rosterUsed: roster !== null,
      installsMappedByRoster: mappedInstalls,
      installsNotInRoster: roster === null ? null : installIds.length - mappedInstalls,
      rosterTestersWithoutData,
      exportDates: dates.length === 0 ? null : { first: dates[0], last: dates[dates.length - 1] },
    },
    medianSession,
    wouldPlayAgain,
    crashFree: {
      definition:
        "app_opened.previous_exit_unclean = true (S6a session marker); an OS kill of a backgrounded app is not a crash",
      overall: share(totalDecided - totalCrashed, totalDecided),
      byPlatform,
      usersByPlatform,
      sessionsWithUnknownOutcome: unknownOutcome,
      zeroLengthCrashedSessions: zeroLengthCrashed,
    },
    dataQuality: quality,
  };
}
