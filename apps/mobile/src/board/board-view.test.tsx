import { getTokens } from '@codelex/design-system';
import { getLayout, getLetterTable } from '@codelex/game-engine';
import { createTranslator } from '@codelex/i18n';
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { boardSquares, squareLabel, type SquareView } from './board-scene';
import { BoardView, type BoardViewProps } from './board-view';
import { BOARD_SIZE } from './geometry';

const SIZE = 344;
const CELL = SIZE / BOARD_SIZE;
const tokens = getTokens('dark');
const { t } = createTranslator('en');

const squares = boardSquares({
  layout: getLayout('classic-v1'),
  letters: getLetterTable('letters-v1'),
  board: Array.from({ length: 15 }, (_, row) => (row === 7 ? '.......CLOUd...' : '.'.repeat(15))),
  pending: [{ row: 8, col: 9, tile: 'K' }],
  owners: { '7,7': 0, '7,8': 0, '7,9': 1, '7,10': 1, '7,11': 1 },
  lastMove: [{ row: 7, col: 9 }],
});

async function renderBoard(overrides: Partial<BoardViewProps> = {}) {
  const onSquarePress = jest.fn<BoardViewProps['onSquarePress']>();
  const props: BoardViewProps = {
    squares,
    size: SIZE,
    tokens,
    premiumLabels: { DL: '2L', TL: '3L', DW: '2W', TW: '3W' },
    motion: 'reduced',
    a11yMode: 'off',
    labels: {
      board: t('a11y.board.label'),
      row: (row) => t('a11y.board.row', { row }),
      square: (s: SquareView) => squareLabel(t, s, 'Beginner Bot'),
      placeHint: t('a11y.square.place_hint'),
      pendingHint: t('a11y.square.pending_hint'),
    },
    armed: false,
    focusRequest: null,
    onSquarePress,
    ...overrides,
  };
  const result = await render(<BoardView {...props} />);
  return { onSquarePress, props, result };
}

/** Gesture callbacks hop to the JS thread with `scheduleOnRN` (a microtask under Jest). */
const flush = () => act(async () => Promise.resolve());

const tapAt = async (x: number, y: number) => {
  fireGestureHandler(getByGestureTestId('board.tap'), [
    { state: State.BEGAN, x, y },
    { state: State.ACTIVE, x, y },
    { state: State.END, x, y },
  ]);
  await flush();
};

const centreOf = (row: number, col: number) => [(col + 0.5) * CELL, (row + 0.5) * CELL] as const;

describe('BoardView', () => {
  it('maps a tap to the square under the finger on the UI thread (hit-test worklet)', async () => {
    const { onSquarePress } = await renderBoard();
    await screen.findByTestId('board.canvas');
    await tapAt(...centreOf(3, 11));
    expect(onSquarePress).toHaveBeenLastCalledWith(3, 11, 1);
  });

  it('zooms to Focus on a double tap and back to Overview (reduced motion: a cut)', async () => {
    const { onSquarePress } = await renderBoard();
    await screen.findByTestId('board.canvas');
    const [x, y] = centreOf(5, 6);
    fireGestureHandler(getByGestureTestId('board.doubleTap'), [
      { state: State.BEGAN, x, y },
      { state: State.ACTIVE, x, y },
      { state: State.END, x, y },
    ]);
    await flush();
    // The tapped square is now centred: a tap in the middle of the viewport lands on it, at Focus zoom.
    await tapAt(SIZE / 2, SIZE / 2);
    expect(onSquarePress).toHaveBeenLastCalledWith(5, 6, tokens.layout.focusZoom);
    fireGestureHandler(getByGestureTestId('board.doubleTap'), [
      { state: State.BEGAN, x, y },
      { state: State.ACTIVE, x, y },
      { state: State.END, x, y },
    ]);
    await flush();
    await tapAt(...centreOf(0, 0));
    expect(onSquarePress).toHaveBeenLastCalledWith(0, 0, 1);
  });

  it('pinches between 1× and 2.5× and pans inside the board', async () => {
    const { onSquarePress } = await renderBoard();
    await screen.findByTestId('board.canvas');
    fireGestureHandler(getByGestureTestId('board.pinch'), [
      { state: State.BEGAN, scale: 1 },
      { state: State.ACTIVE, scale: 1 },
      { state: State.ACTIVE, scale: 4 },
      { state: State.END, scale: 4 },
    ]);
    await flush();
    await tapAt(SIZE / 2, SIZE / 2);
    expect(onSquarePress).toHaveBeenLastCalledWith(7, 7, 2.5);
    fireGestureHandler(getByGestureTestId('board.pan'), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 1000, translationY: 1000 },
      { state: State.END, translationX: 1000, translationY: 1000 },
    ]);
    await flush();
    // Panned to the top-left limit: the viewport origin shows the board origin.
    await tapAt(1, 1);
    expect(onSquarePress).toHaveBeenLastCalledWith(0, 0, 2.5);
  });

  it('frames a requested square (arm-and-zoom, D-2)', async () => {
    const { onSquarePress, props, result } = await renderBoard();
    await screen.findByTestId('board.canvas');
    await result.rerender(<BoardView {...props} armed focusRequest={{ row: 4, col: 9, seq: 1 }} />);
    await flush();
    await tapAt(SIZE / 2, SIZE / 2);
    expect(onSquarePress).toHaveBeenLastCalledWith(4, 9, tokens.layout.focusZoom);
  });

  it('exposes 15 rows × 15 labelled squares to a screen reader and hides the canvas (D-21)', async () => {
    const { onSquarePress } = await renderBoard({ a11yMode: 'screenReader', armed: true });
    expect(await screen.findByLabelText('Row 8')).toBeTruthy();
    const start = screen.getByLabelText('Letter C, 2 points, row 8 column 8, played by you');
    expect(start.props.accessibilityHint).toBeUndefined();
    const empty = screen.getByLabelText('Triple word square, row 1 column 4, empty');
    expect(empty.props.accessibilityHint).toBe('Double tap to place the selected tile here');
    expect(
      screen.getByLabelText('Blank as D, 0 points, row 8 column 12, played by Beginner Bot'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Letter O, 1 point, row 8 column 10, played by Beginner Bot, last move',
      ),
    ).toBeTruthy();
    const pending = screen.getByLabelText(/^Letter K, \d+ points?, row 9 column 10, pending/);
    expect(pending.props.accessibilityHint).toBe('Double tap to return this tile to your rack');
    expect(screen.getAllByRole('button')).toHaveLength(BOARD_SIZE * BOARD_SIZE);
    await fireEvent.press(empty);
    expect(onSquarePress).toHaveBeenLastCalledWith(0, 3, tokens.layout.focusZoom);
    // Hidden from the accessibility tree: default queries cannot see it.
    expect(screen.queryByTestId('board.canvas')).toBeNull();
    const canvas = screen.getByTestId('board.canvas', { includeHiddenElements: true });
    expect(canvas.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('animates camera moves with full motion', async () => {
    jest.useFakeTimers();
    const { onSquarePress } = await renderBoard({ motion: 'full' });
    await screen.findByTestId('board.canvas');
    const [x, y] = centreOf(5, 6);
    fireGestureHandler(getByGestureTestId('board.doubleTap'), [
      { state: State.BEGAN, x, y },
      { state: State.ACTIVE, x, y },
      { state: State.END, x, y },
    ]);
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    jest.useRealTimers();
    await tapAt(SIZE / 2, SIZE / 2);
    expect(onSquarePress).toHaveBeenCalled();
    const [row, col] = onSquarePress.mock.lastCall ?? [];
    expect([row, col]).toEqual([5, 6]);
  });
});
