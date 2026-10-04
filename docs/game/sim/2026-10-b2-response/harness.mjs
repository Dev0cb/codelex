// B2 design-response harness (game-designer, 2026-10-04). Evidence tool for
// docs/game/decisions/2026-10-b2-response.md, NOT part of any build or test. Requires the engine dist patched by
// patch-engine-dist.py (opt-in overrides; without `sim` the engine behaves as engineRulesVersion 1). Usage:
// node harness.mjs '<json spec>'
// spec: { lex, a, b, matches, seed, pairingIndex, sim: {limitUnits, passUnits, exchangeUnits, termBonus},
//         dataA, dataB (personality overrides), maxActions, replay }
import { readFileSync } from 'node:fs';
const W = new URL('../../../../packages', import.meta.url).pathname; // repo packages/
const ENABLE = process.env.ENABLE_WORDS ?? 'enable1.txt'; // only for lex enable:<n>
const eng = await import(`${W}/game-engine/dist/index.js`);
const { deriveRng, createRng } = await import(`${W}/game-engine/dist/rng/index.js`);
const lexIdx = await import(`${W}/lexicon/dist/index/index.js`);
const canon = await import(`${W}/lexicon/scripts/canonical.mjs`);
const { loadLexicon } = await import(`${W}/lexicon/scripts/validate.mjs`);
const B = `${W}/bots/dist/simulator`;
const { matchSeed, matchConfig } = await import(`${B}/sim/simulate.js`);
const { PERSONALITIES } = await import(`${B}/src/personalities.js`);
const { boardView, rackCounts } = await import(`${B}/src/board.js`);
const { fallbackAction } = await import(`${B}/src/fallback.js`);
const { selectGenerator } = await import(`${B}/src/movegen/index.js`);
const { randomLegal } = await import(`${B}/src/policy/random-legal.js`);
const { ranked } = await import(`${B}/src/policy/ranked.js`);

const spec = JSON.parse(process.argv[2]);
globalThis.__CLX_SIM__ = spec.sim ?? {};

function build(version, profileId, terms) {
  const profile = { id: profileId, kind: 'global', definitionHash: version };
  const built = lexIdx.buildLexiconIndex({ version, profile, document: { terms }, blocklist: [] }, { formatVersion: 1, gaddag: true });
  if (!built.ok) throw new Error(built.error.code + ' ' + built.error.message);
  const d = lexIdx.decodeLexiconIndex(built.value, { version, profileId });
  if (!d.ok) throw new Error(d.error.code);
  return d.value;
}
const DIFFS = ['novice', 'intermediate', 'advanced', 'expert'];
function plainTerm(form, id, diff) {
  return { id, playable: true, form, difficulty: diff, categories: ['networking'], inflections: [], relations: [], gameValue: 1, knowledgeXp: 1 };
}
function realTerms() {
  const lex = loadLexicon();
  return { terms: canon.lexiconContentDocument(lex).terms, lex };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const LENGTH_WEIGHTS = [[2, 4], [3, 14], [4, 18], [5, 18], [6, 15], [7, 12], [8, 9], [9, 5], [10, 3], [11, 1], [12, 1]];
function synthForms(n, seedWord, exclude, LW = LENGTH_WEIGHTS, DW = [1, 1, 1, 1]) {
  const LENGTH_WEIGHTS = LW;
  const rng = createRng([seedWord >>> 0 || 1, n >>> 0, 0x9e3779b9, 0x7f4a7c15]);
  const lw = eng.getLetterTable('letters-v1').counts; const lt = lw.reduce((a, b) => a + b, 0);
  const tw = LENGTH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  const pick = (ws, d) => { let acc = 0; for (let i = 0; i < ws.length; i++) { acc += ws[i]; if (d < acc) return i; } return ws.length - 1; };
  const out = []; const seen = new Set(exclude);
  while (out.length < n) {
    const len = LENGTH_WEIGHTS[pick(LENGTH_WEIGHTS.map(([, w]) => w), rng.int(0, tw))][0];
    let f = ''; for (let i = 0; i < len; i++) f += String.fromCharCode(65 + pick(lw, rng.int(0, lt)));
    if (seen.has(f)) continue; seen.add(f); out.push([f, DIFFS[pick(DW, rng.int(0, DW.reduce((a, b) => a + b, 0)))]]);
  }
  return out;
}
function lexicon(specLex) {
  const [kind, arg] = specLex.split(':');
  if (kind === 'real') {
    const { terms } = realTerms();
    return build('4fa5884050b4ea53', 'global-ranked', terms);
  }
  if (kind === 'realsub') { // keep pct % of canonical terms (with their inflections)
    const { terms } = realTerms();
    const rng = createRng([0x5eed, Number(arg), 1, 2]);
    const keep = shuffle(terms, rng).slice(0, Math.round(terms.length * Number(arg) / 100));
    const ids = new Set(keep.map((t) => t.id));
    const kept = keep.map((t) => ({ ...t, relations: (t.relations ?? []).filter((r) => ids.has(r.target ?? r.to ?? r.id)) }));
    return build('b0b' + String(arg).padStart(3, '0') + '0000000000', 'sim-realsub', kept);
  }
  if (kind === 'synth') {
    const terms = synthForms(Number(arg), 1, []).map(([f, d], i) => plainTerm(f, 't' + i, d));
    return build((Number(arg).toString(16).padStart(8, '0') + '00000000').slice(0, 16), 'sim-synth', terms);
  }
  if (kind === 'realplus') { // real + synthetic forms up to arg total forms
    const { terms } = realTerms();
    const forms = new Set(); for (const t of terms) { forms.add(t.form); for (const x of t.inflections ?? []) forms.add(x.form); }
    const add = synthForms(Number(arg) - forms.size, 7, forms).map(([f, d], i) => plainTerm(f, 'x' + i, d));
    return build('a' + String(arg).padStart(15, '0'), 'sim-realplus', [...terms, ...add]);
  }
  if (kind === 'realb3') { // real + synthetic forms with the batch-3 steering mix (E-1.7 C-LC-2)
    const { terms } = realTerms();
    const forms = new Set(); for (const t of terms) { forms.add(t.form); for (const x of t.inflections ?? []) forms.add(x.form); }
    const LW = [[3, 5], [4, 7], [5, 15], [6, 15], [7, 15], [8, 13], [9, 11], [10, 9], [11, 5], [12, 5]];
    const add = synthForms(Number(arg) - forms.size, 11, forms, LW, [35, 35, 22, 8]).map(([f, d], i) => plainTerm(f, 'y' + i, d));
    return build('b3' + String(arg).padStart(14, '0'), 'sim-realb3', [...terms, ...add]);
  }
  if (kind === 'enable') { // seeded sample of n ENABLE words, 2-12 letters, difficulty uniform
    const words = readFileSync(ENABLE, 'utf8').split(/\r?\n/).map((w) => w.trim().toUpperCase()).filter((w) => /^[A-Z]{2,12}$/.test(w));
    const rng = createRng([0xe7ab1e, Number(arg), 3, 4]);
    const pickW = shuffle(words, rng).slice(0, Number(arg));
    const terms = pickW.map((f, i) => plainTerm(f, 'e' + i, DIFFS[rng.int(0, 4)]));
    return build('e' + String(arg).padStart(15, '0'), 'sim-enable', terms);
  }
  throw new Error('lex ' + specLex);
}

const lex = lexicon(spec.lex);
const dataFor = (p, o) => ({ ...PERSONALITIES[p], ...(o ?? {}) });
function choose(obs, personality, data, rng) {
  const seat = obs.seatOnTurn;
  const budget = data.budget;
  const view = boardView(obs, eng.getLayout(obs.config.layout), lex);
  const gen = selectGenerator(lex).generate({ view, rack: rackCounts(obs.rack), seat, maxNodes: budget.maxNodes });
  const input = { obs, lexicon: lex, rng, budget, data, view, candidates: gen.candidates };
  const pol = personality === 'random-legal' ? randomLegal(input) : ranked(input);
  return { action: pol.action ?? fallbackAction(obs, seat), cand: pol.candidatesEvaluated };
}

const pairing = { a: spec.a, b: spec.b };
const datas = { a: dataFor(spec.a, spec.dataA), b: dataFor(spec.b, spec.dataB) };
const maxActions = spec.maxActions ?? 1000;
const agg = { matches: 0, draws: 0, firstWins: 0, decisive: 0, aWins: 0, ends: { going_out: 0, scoreless_turns: 0, resign: 0, too_long: 0 },
  bagEnd: { zero: 0, lt7: 0, ge7: 0 }, bagEndSum: 0, rackEndSum: 0, tilesOnBoardSum: 0, actionsSum: 0, wordsSum: 0, scoreSum: 0,
  points: 0, termBonus: 0, words: 0, perSeat: { a: { pts: 0, words: 0, easy: 0, score: 0, n: 0 }, b: { pts: 0, words: 0, easy: 0, score: 0, n: 0 } },
  firstLead: 0, deadSum: 0, firstExtraTurn: 0, marginAbsSum: 0, noWord: 0, turns: 0, noWordBag: 0, turnsBag: 0, exch: 0, pass: 0, cand: [] };
for (let i = 0; i < spec.matches; i++) {
  const seed = matchSeed(spec.seed ?? '2026100300000b02', spec.pairingIndex ?? 0, i);
  const seats = i % 2 === 0 ? ['a', 'b'] : ['b', 'a'];
  const cfg = matchConfig(lex, seed);
  const c = eng.createMatch(cfg, { lexicon: lex });
  if (!c.ok) throw new Error('create ' + c.error.code);
  let st = c.value.state; let tooLong = false; const turnsBySeat = [0, 0]; let trailDead = 0;
  while (st.status === 'in_progress') {
    if (st.actionCount >= maxActions) { tooLong = true; break; }
    const seat = st.seatOnTurn; const role = seats[seat]; const pers = pairing[role];
    const obs = eng.observe(st, seat);
    const d = choose(obs, pers, datas[role], deriveRng(seed, `bot:${seat}:${obs.actionCount}`));
    const ap = eng.apply(st, d.action, { lexicon: lex });
    if (!ap.ok) throw new Error('apply ' + ap.error.code);
    st = ap.value.state; turnsBySeat[seat]++;
    agg.turns++; if (obs.bagCount > 0) agg.turnsBag++;
    const placed = ap.value.events.find((e) => e.type === 'WORD_PLACED');
    if (placed || obs.bagCount >= 7) trailDead = 0; else trailDead++;
    if (placed) {
      const bd = placed.breakdown; const tb = bd.words.reduce((x, w) => x + w.termBonus, 0);
      agg.points += bd.total; agg.termBonus += tb; agg.words++;
      const ps = agg.perSeat[role]; ps.pts += bd.total; ps.words++;
      const main = bd.words.find((w) => w.main);
      if (main && (main.difficulty === 'novice' || main.difficulty === 'intermediate')) ps.easy++;
    } else { agg.noWord++; if (obs.bagCount > 0) agg.noWordBag++; if (d.action.type === 'EXCHANGE') agg.exch++; else agg.pass++; }
  }
  agg.matches++;
  if (tooLong) { agg.ends.too_long++; continue; }
  const r = st.result; agg.ends[r.end.reason]++; agg.deadSum += trailDead;
  const bag = st.bag.length; agg.bagEndSum += bag;
  if (bag === 0) agg.bagEnd.zero++; else if (bag < 7) agg.bagEnd.lt7++; else agg.bagEnd.ge7++;
  const rack = st.seats.reduce((x, s) => x + s.rack.length, 0); agg.rackEndSum += rack;
  agg.tilesOnBoardSum += 100 - bag - rack; agg.actionsSum += st.actionCount;
  const sc = st.seats.map((s) => s.score); agg.scoreSum += sc[0] + sc[1];
  const draw = r.places[0] === 1 && r.places[1] === 1;
  const fs = st.firstSeat;
  agg.firstLead += sc[fs] - sc[1 - fs]; agg.marginAbsSum += Math.abs(sc[0] - sc[1]);
  if (turnsBySeat[fs] > turnsBySeat[1 - fs]) agg.firstExtraTurn++;
  for (let s = 0; s < 2; s++) { const ps = agg.perSeat[seats[s]]; ps.score += sc[s]; ps.n++; }
  if (draw) agg.draws++; else { agg.decisive++; const w = r.places.indexOf(1); if (w === fs) agg.firstWins++; if (seats[w] === 'a') agg.aWins++; }
}
const pct = (k, n) => (n ? Math.round((10000 * k) / n) / 100 : null);
function wilson(k, n) { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [Math.round((c - h) * 10000) / 100, Math.round((c + h) * 10000) / 100]; }
const done = agg.matches - agg.ends.too_long;
const per = (r) => ({ ppw: r.words ? +(r.pts / r.words).toFixed(1) : null, easyPct: pct(r.easy, r.words), meanScore: r.n ? +(r.score / r.n).toFixed(1) : null });
console.log(JSON.stringify({
  spec: { ...spec, forms: lex.size, terms: lex.termCount },
  matches: agg.matches, ends: agg.ends, scorelessPct: pct(agg.ends.scoreless_turns, agg.matches), tooLongPct: pct(agg.ends.too_long, agg.matches),
  bagEnd: { zeroPct: pct(agg.bagEnd.zero, done), lt7Pct: pct(agg.bagEnd.lt7, done), ge7Pct: pct(agg.bagEnd.ge7, done), mean: +(agg.bagEndSum / done).toFixed(1) },
  rackEndMean: +(agg.rackEndSum / done).toFixed(1), tilesPlayedMean: +(agg.tilesOnBoardSum / done).toFixed(1),
  deadTurnsAtEndMean: +(agg.deadSum / done).toFixed(2), actionsMean: +(agg.actionsSum / done).toFixed(1), wordsPerMatch: +(agg.words / agg.matches).toFixed(1), meanTotalScore: +(agg.scoreSum / done).toFixed(1),
  noWordPct: pct(agg.noWord, agg.turns), noWordBagPct: pct(agg.noWordBag, agg.turnsBag), exchanges: agg.exch, passes: agg.pass,
  termBonusSharePct: pct(agg.termBonus, agg.points), ppw: +(agg.points / agg.words).toFixed(1),
  firstWinPct: pct(agg.firstWins, agg.decisive), firstWinCI: wilson(agg.firstWins, agg.decisive), firstWinK: agg.firstWins, decisive: agg.decisive, draws: agg.draws,
  firstLeadMean: +(agg.firstLead / done).toFixed(1), firstExtraTurnPct: pct(agg.firstExtraTurn, done), meanAbsMargin: +(agg.marginAbsSum / done).toFixed(1),
  aWinPct: spec.a === spec.b && !spec.dataA && !spec.dataB ? null : pct(agg.aWins, agg.decisive), aWinCI: wilson(agg.aWins, agg.decisive),
  a: per(agg.perSeat.a), b: per(agg.perSeat.b),
}));
