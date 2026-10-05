/**
 * Smoke test of the B4 readout tooling (CI-gating, small): a few matches of each kind of job on the lexicon on
 * `main`, every match replayed, same seeds ⇒ same report, voluntary exchanges flagged. The full ST-x runs are
 * `simulate:b4`, never part of `pnpm test`.
 */
import { describe, expect, it } from 'vitest';
import { mainLexicon } from './b4-play.js';
import { jobReport, jobsFor, ratioPermille, runJob, strategistBots } from './b4.js';

describe('B4 readout tooling', () => {
  const lexicon = mainLexicon(true);
  const jobs = jobsFor();

  it('defines the pre-registered seeds and keeps tuning and confirmation apart', () => {
    const st1 = jobs.find((j) => j.id === 'st1');
    expect(st1).toMatchObject({ masterSeed: '2026100400000b07', pairingIndex: 10, matches: 2_000 });
    for (const j of jobs.filter((x) => !x.id.startsWith('st1') || x.id === 'st1b')) {
      expect(j.masterSeed).toBe('2026100400000a00');
    }
    const mirrors = jobs.filter((j) => j.id.startsWith('st7'));
    expect(new Set(mirrors.map((j) => j.pairingIndex)).size).toBe(1); // same seeds for both mirrors
    expect(strategistBots().ablated.options?.ablated).toBe(true);
  });

  it('plays, replays and aggregates; same seeds ⇒ same report', () => {
    const job = jobs.find((j) => j.id === 'st2');
    if (job === undefined) throw new Error('unreachable');
    const records = runJob(job, lexicon, 0, 4);
    const report = jobReport({ ...job, matches: 4 }, lexicon, 'main-f1', records);
    expect(report.replayVerified).toBe(4);
    expect(report.aWin.n + report.draws).toBe(4);
    expect(report.bots.map((b) => b.id)).toEqual(['strategist', 'strategist-ablated']);
    const ablated = report.bots[1];
    expect(ablated?.voluntaryExchanges).toBe(0);
    for (const b of report.bots) expect(b.decisions).toBeGreaterThan(0);
    expect(
      jobReport({ ...job, matches: 4 }, lexicon, 'main-f1', runJob(job, lexicon, 0, 4)),
    ).toEqual(report);
    expect(ratioPermille(1, 2, 1, 4)).toBe(2_000);
    expect(ratioPermille(1, 0, 1, 4)).toBe(0);
  }, 120_000);
});
