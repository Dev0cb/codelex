"""Simulation-only patch of the BUILT game engine (packages/game-engine/dist), never of src/.

Adds opt-in overrides read from globalThis.__CLX_SIM__ (absent => byte-identical behaviour to engineRulesVersion 1):
  limitUnits     R-TURN-004 limit per active seat, in counter units (default RULES.scorelessTurnsPerSeat = 3)
  passUnits      counter units added by a Pass (default 1)
  exchangeUnits  counter units added by an Exchange (default 1; 0 = exchanges never count)
  termBonus      {novice, intermediate, advanced, expert} replacing RULES.termBonus (R-SCORE-003)
  tbMainOnly     true = cross-words get no term bonus (main word only)
  plainStart     true = the classic-v1 start square (7,7) is plain instead of DW (R-BOARD-004 variant)

Usage: pnpm turbo run build --filter=@codelex/bots... ; python3 patch-engine-dist.py <repo>/packages/game-engine/dist
Undo: rebuild the engine (rm -rf packages/game-engine/dist && pnpm --filter @codelex/game-engine build).
"""
import sys, os

root = sys.argv[1]
O = 'globalThis.__CLX_SIM__'


def sub(path, old, new):
    p = os.path.join(root, path)
    s = open(p).read()
    if new in s:
        return
    assert s.count(old) == 1, (path, old)
    open(p, 'w').write(s.replace(old, new))


sub('match/apply.js', 'if (next.scorelessTurns >= RULES.scorelessTurnsPerSeat * active) {',
    f'if (next.scorelessTurns >= ({O}?.limitUnits ?? RULES.scorelessTurnsPerSeat) * active) {{')
sub('match/apply.js', 'scorelessTurns: state.scorelessTurns + 1,',
    f'scorelessTurns: state.scorelessTurns + ({O}?.exchangeUnits ?? 1),')
sub('match/apply.js', 'const scorelessTurns = state.scorelessTurns + 1;',
    f'const scorelessTurns = state.scorelessTurns + ({O}?.passUnits ?? 1);')
sub('state/state.js', 'if (state.scorelessTurns < RULES.scorelessTurnsPerSeat * activeSeats)',
    f'if (state.scorelessTurns < ({O}?.limitUnits ?? RULES.scorelessTurnsPerSeat) * activeSeats)')
sub('scoring/score.js', 'const termBonus = RULES.termBonus[term.difficulty];',
    f'const termBonus = {O}?.tbMainOnly && !word.main ? 0 : ({O}?.termBonus ?? RULES.termBonus)[term.difficulty];')
sub('rules/constants.js', 'export function squareKind(layout, row, col) {\n',
    'export function squareKind(layout, row, col) {\n'
    f"    if ({O}?.plainStart && row === layout.start.row && col === layout.start.col) return 'plain';\n")
print('patched', root)
