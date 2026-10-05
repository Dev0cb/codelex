import { getLayout, getLetterTable } from '@codelex/game-engine';
import { createTranslator } from '@codelex/i18n';
import { describe, expect, it } from '@jest/globals';

import { boardSquares, motifPath, premiumFill, squareLabel, type SquareView } from './board-scene';

const layout = getLayout('classic-v1');
const letters = getLetterTable('letters-v1');
const empty = Array.from({ length: 15 }, () => '.'.repeat(15));

function withTiles(tiles: readonly [number, number, string][]): string[] {
  const rows = [...empty];
  for (const [row, col, tile] of tiles) {
    const line = rows[row] ?? '';
    rows[row] = line.slice(0, col) + tile + line.slice(col + 1);
  }
  return rows;
}

describe('boardSquares', () => {
  it('reads the premium layout from the engine, never hard-coded (E-1.5 §5.5.8 counts)', () => {
    const squares = boardSquares({
      layout,
      letters,
      board: empty,
      pending: [],
      owners: {},
      lastMove: [],
    });
    expect(squares).toHaveLength(225);
    const count = (kind: string) => squares.filter((s) => s.premium === kind).length;
    expect([count('TW'), count('DW'), count('TL'), count('DL')]).toEqual([8, 13, 12, 28]);
    expect(squares.filter((s) => s.start)).toEqual([
      { row: 7, col: 7, premium: 'DW', start: true, tile: null },
    ]);
    expect(squares[3]).toMatchObject({ row: 0, col: 3, premium: 'TW' });
    expect(squares[0]).toMatchObject({ row: 0, col: 0, premium: null });
    expect(squares[16]).toMatchObject({ row: 1, col: 1 });
  });

  it('shows committed tiles with value, owner and last-move ring; blanks score 0', () => {
    const squares = boardSquares({
      layout,
      letters,
      board: withTiles([
        [7, 7, 'K'],
        [7, 8, 'e'],
      ]),
      pending: [{ row: 8, col: 8, tile: 'z' }],
      owners: { '7,7': 0, '7,8': 1 },
      lastMove: [{ row: 7, col: 8 }],
    });
    const at = (row: number, col: number) => squares[row * 15 + col] as SquareView;
    expect(at(7, 7).tile).toEqual({
      letter: 'K',
      value: letters.values[10],
      isBlank: false,
      owner: 'you',
      pending: false,
      lastMove: false,
    });
    expect(at(7, 8).tile).toEqual({
      letter: 'E',
      value: 0,
      isBlank: true,
      owner: 'opponent',
      pending: false,
      lastMove: true,
    });
    expect(at(8, 8).tile).toEqual({
      letter: 'Z',
      value: 0,
      isBlank: true,
      owner: null,
      pending: true,
      lastMove: false,
    });
  });
});

describe('premium encoding (E-1.4 §2.5: colour + shape + label)', () => {
  it('draws a distinct shape per premium kind and nothing on a plain square', () => {
    const shapes = (['DL', 'TL', 'DW', 'TW'] as const).map((kind) =>
      motifPath(kind, false, 0, 0, 20),
    );
    expect(new Set(shapes).size).toBe(4);
    expect(motifPath('DW', true, 0, 0, 20)).not.toBe(motifPath('DW', false, 0, 0, 20));
    expect(motifPath(null, false, 0, 0, 20)).toBe('');
    for (const path of shapes) expect(path).toMatch(/^M[\d. -]+/);
  });

  it('fills premium squares with their tint and plain squares with the board', () => {
    const palette = {
      bg: '#000001',
      premiumDlTint: '#000002',
      premiumTlTint: '#000003',
      premiumDwTint: '#000004',
      premiumTwTint: '#000005',
    } as const;
    expect([null, 'DL', 'TL', 'DW', 'TW'].map((k) => premiumFill(k as null, palette))).toEqual([
      '#000001',
      '#000002',
      '#000003',
      '#000004',
      '#000005',
    ]);
  });
});

describe('square labels (D-21, 1-based rows and columns)', () => {
  const en = createTranslator('en');
  const fr = createTranslator('fr');
  const sq = (over: Partial<SquareView>): SquareView => ({
    row: 7,
    col: 7,
    premium: null,
    start: false,
    tile: null,
    ...over,
  });

  it('names empty squares by premium', () => {
    expect(squareLabel(en.t, sq({ premium: 'TW', row: 0, col: 0 }), 'Beginner Bot')).toBe(
      'Triple word square, row 1 column 1, empty',
    );
    expect(squareLabel(en.t, sq({ premium: 'DW', start: true }), 'Beginner Bot')).toBe(
      'Start square, double word, row 8 column 8, empty',
    );
    expect(squareLabel(en.t, sq({}), 'Beginner Bot')).toBe('Square, row 8 column 8, empty');
    expect(squareLabel(fr.t, sq({ premium: 'DL', row: 3, col: 0 }), 'Bot Débutant')).toBe(
      'Case lettre compte double, ligne 4 colonne 1, vide',
    );
    expect(squareLabel(en.t, sq({ premium: 'TL' }), 'x')).toMatch(/^Triple letter square/);
  });

  it('names tiles, their owner, pending and last-move state', () => {
    const tile = {
      letter: 'K' as const,
      value: 5,
      isBlank: false,
      owner: 'you' as const,
      pending: false,
      lastMove: true,
    };
    expect(squareLabel(en.t, sq({ row: 3, col: 6, tile }), 'Beginner Bot')).toBe(
      'Letter K, 5 points, row 4 column 7, played by you, last move',
    );
    expect(
      squareLabel(
        en.t,
        sq({ tile: { ...tile, owner: 'opponent', lastMove: false, isBlank: true, value: 0 } }),
        'Beginner Bot',
      ),
    ).toBe('Blank as K, 0 points, row 8 column 8, played by Beginner Bot');
    expect(
      squareLabel(
        fr.t,
        sq({ tile: { ...tile, owner: null, pending: true, lastMove: false } }),
        'x',
      ),
    ).toBe('Lettre K, 5 points, ligne 8 colonne 8, en attente, pas encore jouée');
  });
});
