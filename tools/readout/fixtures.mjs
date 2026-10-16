/**
 * Synthetic playtest exports (exportFormat 1) for tests and the dry run. Every file is built through the D1 encoder
 * (`encodePlaytestExport`), so it is valid against the real schemas by construction; nothing here is real data.
 * Deterministic: a seeded PRNG gives all ids, so the same call returns the same bytes.
 *
 * `Device` records what one install would record (app_opened / app_backgrounded / match / survey events) on a
 * virtual clock; `exportFile` wraps a slice of its events in the D1 envelope.
 */
import { encodePlaytestExport } from "../../apps/mobile/src/export/playtest-data.ts";

/** mulberry32: small seeded PRNG. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uuidV4(rng) {
  const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const MIN = 60_000;
export const T0 = Date.parse("2026-10-12T08:00:00.000Z");

export class Device {
  /**
   * @param {{ rng: () => number, platform?: "ios" | "android", installId?: string, startMs?: number }} o
   */
  constructor({ rng, platform = "android", installId, startMs = T0 }) {
    this.rng = rng;
    this.platform = platform;
    this.installId = installId ?? uuidV4(rng);
    this.sessionId = uuidV4(rng);
    this.now = startMs;
    this.events = [];
    this.openAt = null;
  }

  wait(ms) {
    this.now += ms;
    return this;
  }

  push(event, properties, version = 1) {
    this.events.push({
      event,
      schema_version: version,
      event_id: uuidV4(this.rng),
      occurred_at: new Date(this.now).toISOString(),
      user_id: this.installId,
      session_id: this.sessionId,
      app_version: "0.4.0",
      platform: this.platform,
      locale: "en",
      properties,
    });
    return this;
  }

  /** A cold start (`unclean` set) or warm return (`unclean` undefined) to the foreground. */
  open(unclean) {
    if (unclean !== undefined) this.sessionId = uuidV4(this.rng);
    this.push(
      "app_opened",
      unclean === undefined
        ? { network_type: "wifi" }
        : { cold_start_ms: 900, network_type: "wifi", previous_exit_unclean: unclean },
      2,
    );
    this.openAt = this.now;
    return this;
  }

  /** One finished match inside the open interval (`ms` of play). */
  match(ms) {
    const id = uuidV4(this.rng);
    this.push("bot_match_started", {
      local_match_id: id,
      mode: "classic",
      format: "untimed-vs-bot",
      bot_personality: "beginner",
      first_player: "player",
      lexicon_version: "0123456789abcdef",
      engine_rules_version: 1,
      bot_version: 1,
      is_first_match: this.events.every((e) => e.event !== "bot_match_started"),
    });
    this.now += ms;
    return this.push("bot_match_finished", {
      local_match_id: id,
      bot_personality: "beginner",
      bot_version: 1,
      engine_rules_version: 1,
      result: "win",
      end_reason: "out",
      player_score: 250,
      bot_score: 200,
      score_margin: 50,
      bag_count_at_end: 0,
      tiles_on_board_at_end: 30,
      forced_pass_tail: 0,
      active_duration_ms: ms,
      turns: 12,
      words_played: 6,
      rejected_attempts: 0,
      exchanges: 0,
      passes: 0,
      resume_count: 0,
    });
  }

  survey(answer, matchesCompleted = 1) {
    this.push("playtest_survey_shown", {
      survey_id: "wpa-1",
      question_id: "would_play_again",
      matches_completed: matchesCompleted,
    });
    return this.push("playtest_survey_answered", {
      survey_id: "wpa-1",
      question_id: "would_play_again",
      answer,
      matches_completed: matchesCompleted,
    });
  }

  /** The interval ends: `app_backgrounded` with the time since the matching open. */
  background() {
    return this.push("app_backgrounded", { foreground_ms: this.now - this.openAt });
  }

  /** Convenience: open, spend `ms`, background. */
  interval(ms, unclean) {
    this.open(unclean);
    this.now += ms;
    return this.background();
  }
}

/** The file text for `device`'s events `[from, to)`, exported at `exportedAt`. */
export function exportFile(device, { from = 0, to, exportedAt, dropped, remaining = 0 } = {}) {
  const r = encodePlaytestExport({
    exportFormat: 1,
    kind: "codelex.playtest_data",
    app: { version: "0.4.0", build: "17", platform: device.platform },
    installId: device.installId,
    exportedAt,
    dropped: dropped ?? { queueCap: 0, expired: 0, invalid: 0 },
    remaining,
    events: device.events.slice(from, to),
  });
  if (!r.ok) throw new Error(`fixture does not satisfy the D1 schema: ${JSON.stringify(r.error)}`);
  return r.value;
}

/**
 * A Stage 0 style dry-run set: 5 testers, 6 installs, 7 files. Returns `{ files: [{ name, text }], rosterCsv }`.
 *
 * - t01 android: five sessions of 9-15 min, finishes matches, answers yes. One file.
 * - t02 ios: four sessions, one crash (cold start after an interval left open), answers maybe; two files that overlap
 *   by their last 6 events (an export re-sent before the "Sent" confirmation).
 * - t03 android: answers yes, then turns consent off/on (new install id, survey not asked again); roster maps both.
 * - t04 ios: dismisses the survey, one 6 s session, a boot crash (cold start, previous_exit_unclean, nothing open).
 * - t05 android: opens the app for a few minutes, never finishes a match (not active), no survey.
 */
export function stage0Dataset(seed = 20261012) {
  const rng = makeRng(seed);
  const files = [];
  const roster = ["tester_id,install_id"];
  const day = (n, h = 18) => new Date(T0 + n * 86_400_000 + (h - 8) * 3_600_000).toISOString();

  // t01
  const d1 = new Device({ rng, platform: "android" });
  d1.open(false);
  d1.match(5 * MIN).match(4 * MIN).wait(MIN).background();
  for (const [wait, play] of [[3 * 3_600_000, 11], [20 * 3_600_000, 14], [20 * 3_600_000, 9], [20 * 3_600_000, 12]]) {
    d1.wait(wait).open(false);
    d1.wait(MIN);
    d1.match(play * MIN - MIN);
    if (play === 12) d1.survey("yes", 5);
    d1.background();
  }
  files.push({ name: "t01-android-export.json", text: exportFile(d1, { exportedAt: day(4) }) });
  roster.push(`t01,${d1.installId}`);

  // t02
  const d2 = new Device({ rng, platform: "ios", startMs: T0 + 3_600_000 });
  d2.open(false).match(7 * MIN).match(6 * MIN).background();
  d2.wait(5 * MIN).open().match(4 * MIN).background(); // same session: 5 min away
  d2.wait(2 * 3_600_000).open().match(8 * MIN).survey("maybe", 3).background();
  const cut = d2.events.length;
  d2.wait(20 * 3_600_000).open(false).match(5 * MIN).wait(2 * MIN); // killed in the foreground: no backgrounded
  d2.wait(MIN).open(true).match(9 * MIN).background(); // cold start after the crash
  d2.wait(20 * 3_600_000).open(false).match(10 * MIN).background();
  files.push({ name: "t02-ios-export-1.json", text: exportFile(d2, { to: cut, exportedAt: day(2) }) });
  files.push({
    name: "t02-ios-export-2.json",
    text: exportFile(d2, { from: cut - 6, exportedAt: day(4), dropped: { queueCap: 0, expired: 2, invalid: 0 } }),
  });
  roster.push(`t02,${d2.installId}`);

  // t03: two installs
  const d3 = new Device({ rng, platform: "android", startMs: T0 + 7_200_000 });
  d3.open(false).match(6 * MIN).match(5 * MIN).survey("yes", 2).background();
  d3.wait(20 * 3_600_000).open(false).match(12 * MIN).background();
  files.push({ name: "t03-android-export-a.json", text: exportFile(d3, { exportedAt: day(2) }) });
  roster.push(`t03,${d3.installId}`);
  const d3b = new Device({ rng, platform: "android", startMs: T0 + 3 * 86_400_000 });
  d3b.open(false).match(8 * MIN).match(6 * MIN).background();
  d3b.wait(20 * 3_600_000).open(false).match(10 * MIN).background();
  files.push({ name: "t03-android-export-b.json", text: exportFile(d3b, { exportedAt: day(6) }) });
  roster.push(`t03,${d3b.installId}`);

  // t04
  const d4 = new Device({ rng, platform: "ios", startMs: T0 + 5_400_000 });
  d4.open(false).match(5 * MIN).survey("dismissed", 1).background();
  d4.wait(3 * 3_600_000).open(true); // boot crash of the previous process: nothing open, then this one runs
  d4.now += 6_000;
  d4.background();
  files.push({ name: "t04-ios-export.json", text: exportFile(d4, { exportedAt: day(3) }) });
  roster.push(`t04,${d4.installId}`);

  // t05
  const d5 = new Device({ rng, platform: "android", startMs: T0 + 9_000_000 });
  d5.interval(3 * MIN, false);
  d5.wait(20 * 3_600_000).interval(2 * MIN, false);
  files.push({ name: "t05-android-export.json", text: exportFile(d5, { exportedAt: day(3) }) });
  roster.push(`t05,${d5.installId}`);

  return { files, rosterCsv: `${roster.join("\n")}\n` };
}
