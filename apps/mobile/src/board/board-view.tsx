/**
 * The Skia board (E-1.4 §2, implemented in the app: assumption A-4 reversed, contract kept). Presentational: it
 * draws the squares it is given and reports taps; legality, scores and previews come from the engine through the
 * app. Camera gestures (tap hit-test, double tap, pinch, pan) are UI-thread worklets over shared values, and the
 * camera transform is a Skia group transform driven by those values, so no pointer frame needs the JS thread
 * (P5 §4.2) and glyphs stay crisp at every zoom.
 */
import type { HexColor, Tokens } from '@codelex/design-system';
import {
  Canvas,
  Group,
  Path,
  Rect,
  RoundedRect,
  Text as SkiaText,
  matchFont,
  type SkFont,
} from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, type JSX } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { MotionMode } from '../a11y/accessibility';
import { motifPath, premiumFill, type PremiumKind, type SquareView } from './board-scene';
import {
  BOARD_SIZE,
  FOCUS_THRESHOLD,
  clampTranslation,
  focusTranslation,
  hitTest,
  toContent,
} from './geometry';

export interface BoardA11yLabels {
  readonly board: string;
  /** 1-based row. */
  readonly row: (row: number) => string;
  readonly square: (square: SquareView) => string;
  readonly placeHint: string;
  readonly pendingHint: string;
}

export interface BoardViewProps {
  /** 225 squares, row-major. */
  readonly squares: readonly SquareView[];
  /** Viewport side in dp (Overview board). */
  readonly size: number;
  readonly tokens: Tokens;
  /** Premium labels from the catalogue (2L / L2 ...), drawn on every premium square. */
  readonly premiumLabels: Readonly<Record<PremiumKind, string>>;
  readonly motion: MotionMode;
  /** `screenReader`: the canvas is hidden and 15 × 15 accessible squares are rendered (D-21). */
  readonly a11yMode: 'off' | 'screenReader';
  readonly labels: BoardA11yLabels;
  /** A rack tile is selected: empty squares accept it. */
  readonly armed: boolean;
  /** Frame this square at Focus zoom whenever `seq` changes (arm-and-zoom, D-2). */
  readonly focusRequest: {
    readonly row: number;
    readonly col: number;
    readonly seq: number;
  } | null;
  /** A square was tapped, with the zoom at that moment (the app decides: place, arm-and-zoom or recall). */
  readonly onSquarePress: (row: number, col: number, zoom: number) => void;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** System mono until JetBrains Mono is bundled (D-28); null when the platform has none (then no glyphs). */
function monoFont(size: number): SkFont | null {
  try {
    return matchFont({ fontFamily: MONO, fontSize: size, fontWeight: 'bold' });
  } catch {
    return null;
  }
}

/** E-1.4 §2.4 type sizes for the Overview cell; the camera scales them with the board. */
const LETTER_RATIO = 14 / 22.93;
const VALUE_RATIO = 8 / 22.93;
const LABEL_RATIO = 9 / 22.93;

interface Fonts {
  readonly letter: SkFont | null;
  readonly value: SkFont | null;
  readonly label: SkFont | null;
}

function centredText(font: SkFont | null, text: string, cx: number): number {
  return font === null ? cx : cx - font.measureText(text).width / 2;
}

interface SquareProps {
  readonly square: SquareView;
  readonly cell: number;
  readonly tokens: Tokens;
  readonly fonts: Fonts;
  readonly premiumLabel: string;
}

function SquareShape({ square, cell, tokens, fonts, premiumLabel }: SquareProps): JSX.Element {
  const { board, color } = tokens;
  const x = square.col * cell;
  const y = square.row * cell;
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  const inset = 0.5;
  const { tile } = square;
  if (tile === null) {
    return (
      <Group>
        <Rect
          x={x + inset}
          y={y + inset}
          width={cell - 2 * inset}
          height={cell - 2 * inset}
          color={premiumFill(square.premium, board)}
        />
        {square.premium !== null && (
          <Path
            path={motifPath(square.premium, square.start, x, y, cell)}
            style="stroke"
            strokeWidth={1.5}
            color={board.premiumLabel}
            opacity={0.45}
          />
        )}
        {square.premium !== null && fonts.label !== null && (
          <SkiaText
            x={centredText(fonts.label, premiumLabel, cx)}
            y={cy + cell * LABEL_RATIO * 0.36}
            text={premiumLabel}
            font={fonts.label}
            color={board.premiumLabel}
          />
        )}
      </Group>
    );
  }
  const radius = tokens.radius.square;
  const ink: HexColor = tile.isBlank ? board.tileValue : board.tileInk;
  return (
    <Group>
      <Rect x={x} y={y} width={cell} height={cell} color={board.bg} />
      <RoundedRect
        x={x + 1}
        y={y + 1}
        width={cell - 2}
        height={cell - 2}
        r={radius}
        color={board.tileFace}
      />
      {fonts.letter !== null && (
        <SkiaText
          x={centredText(fonts.letter, tile.letter, cx - cell * 0.06)}
          y={cy + cell * LETTER_RATIO * 0.36}
          text={tile.letter}
          font={fonts.letter}
          color={ink}
        />
      )}
      {fonts.value !== null && (
        <SkiaText
          x={x + cell - cell * 0.3}
          y={y + cell - cell * 0.12}
          text={String(tile.value)}
          font={fonts.value}
          color={board.tileValue}
        />
      )}
      {tile.isBlank && (
        <RoundedRect
          x={x + 2.5}
          y={y + 2.5}
          width={cell - 5}
          height={cell - 5}
          r={radius}
          style="stroke"
          strokeWidth={1}
          color={board.tileBlankOutline}
        />
      )}
      {tile.pending && (
        <RoundedRect
          x={x + 1}
          y={y + 1}
          width={cell - 2}
          height={cell - 2}
          r={radius}
          style="stroke"
          strokeWidth={2}
          color={color.accentPrimary}
        />
      )}
      {tile.pending && (
        // Pencil corner mark: the shape cue that tells pending from committed without colour (E-1.4 §2.5).
        <Path
          path={`M${String(x + cell - 7)} ${String(y + 2)} L${String(x + cell - 2)} ${String(y + 2)} L${String(x + cell - 2)} ${String(y + 7)} Z`}
          color={color.accentPrimary}
        />
      )}
      {tile.lastMove && (
        <RoundedRect
          x={x + 0.5}
          y={y + 0.5}
          width={cell - 1}
          height={cell - 1}
          r={radius}
          style="stroke"
          strokeWidth={2}
          color={board.lastMove}
        />
      )}
    </Group>
  );
}

/** The drawn board: rebuilt only when the squares, theme or labels change (static layer, E-1.4 §2.4). */
const BoardPicture = memo(function BoardPicture({
  squares,
  size,
  tokens,
  premiumLabels,
}: Pick<BoardViewProps, 'squares' | 'size' | 'tokens' | 'premiumLabels'>): JSX.Element {
  const cell = size / BOARD_SIZE;
  const fonts = useMemo<Fonts>(
    () => ({
      letter: monoFont(cell * LETTER_RATIO),
      value: monoFont(cell * VALUE_RATIO),
      label: monoFont(cell * LABEL_RATIO),
    }),
    [cell],
  );
  return (
    <Group>
      <Rect x={0} y={0} width={size} height={size} color={tokens.board.grid} />
      {squares.map((square) => (
        <SquareShape
          key={`${String(square.row)}-${String(square.col)}`}
          square={square}
          cell={cell}
          tokens={tokens}
          fonts={fonts}
          premiumLabel={square.premium === null ? '' : premiumLabels[square.premium]}
        />
      ))}
    </Group>
  );
});

function AccessibleGrid({
  squares,
  size,
  labels,
  armed,
  focusZoom,
  onSquarePress,
}: Pick<BoardViewProps, 'squares' | 'size' | 'labels' | 'armed' | 'onSquarePress'> & {
  readonly focusZoom: number;
}): JSX.Element {
  const cell = size / BOARD_SIZE;
  const rows = Array.from({ length: BOARD_SIZE }, (_, row) =>
    squares.slice(row * BOARD_SIZE, row * BOARD_SIZE + BOARD_SIZE),
  );
  return (
    <View style={StyleSheet.absoluteFill} accessibilityLabel={labels.board}>
      {rows.map((row, index) => (
        <View
          key={index}
          accessibilityLabel={labels.row(index + 1)}
          style={[styles.row, { top: index * cell, width: size, height: cell }]}
        >
          {row.map((square) => {
            const hint = square.tile?.pending
              ? labels.pendingHint
              : armed && square.tile === null
                ? labels.placeHint
                : undefined;
            return (
              <Pressable
                key={square.col}
                accessibilityRole="button"
                accessibilityLabel={labels.square(square)}
                accessibilityHint={hint}
                onPress={() => {
                  onSquarePress(square.row, square.col, focusZoom);
                }}
                style={{ width: cell, height: cell }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function BoardView(props: BoardViewProps): JSX.Element {
  const { size, tokens, motion, a11yMode, focusRequest, onSquarePress } = props;
  const { focusZoom, zoomMin, zoomMax } = tokens.layout;
  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startZoom = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const duration = motion === 'reduced' ? 0 : tokens.motion.duration.camera;

  const gesture = useMemo(() => {
    const easing = Easing.bezier(0.2, 0, 0, 1);
    const moveCamera = (z: number, x: number, y: number): void => {
      'worklet';
      if (duration === 0) {
        zoom.set(z);
        tx.set(x);
        ty.set(y);
      } else {
        zoom.set(withTiming(z, { duration, easing }));
        tx.set(withTiming(x, { duration, easing }));
        ty.set(withTiming(y, { duration, easing }));
      }
    };
    const tap = Gesture.Tap()
      .withTestId('board.tap')
      .maxDuration(500)
      .onEnd((event, success) => {
        if (!success) return;
        const hit = hitTest(event.x, event.y, size, zoom.get(), tx.get(), ty.get());
        if (hit !== null) scheduleOnRN(onSquarePress, hit.row, hit.col, zoom.get());
      });
    const doubleTap = Gesture.Tap()
      .withTestId('board.doubleTap')
      .numberOfTaps(2)
      .maxDelay(250)
      .onEnd((event, success) => {
        if (!success) return;
        if (zoom.get() >= FOCUS_THRESHOLD) {
          moveCamera(1, 0, 0);
          return;
        }
        const point = toContent(event.x, event.y, size, zoom.get(), tx.get(), ty.get());
        const cell = size / BOARD_SIZE;
        const col = Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(point.x / cell)));
        const row = Math.min(BOARD_SIZE - 1, Math.max(0, Math.floor(point.y / cell)));
        moveCamera(
          focusZoom,
          focusTranslation(col, size, focusZoom),
          focusTranslation(row, size, focusZoom),
        );
      });
    const pinch = Gesture.Pinch()
      .withTestId('board.pinch')
      .onStart(() => {
        startZoom.set(zoom.get());
      })
      .onUpdate((event) => {
        const z = Math.min(zoomMax, Math.max(zoomMin, startZoom.get() * event.scale));
        zoom.set(z);
        tx.set(clampTranslation(tx.get(), size, z));
        ty.set(clampTranslation(ty.get(), size, z));
      });
    const pan = Gesture.Pan()
      .withTestId('board.pan')
      .minDistance(8)
      .onStart(() => {
        startX.set(tx.get());
        startY.set(ty.get());
      })
      .onUpdate((event) => {
        tx.set(clampTranslation(startX.get() + event.translationX, size, zoom.get()));
        ty.set(clampTranslation(startY.get() + event.translationY, size, zoom.get()));
      });
    return Gesture.Simultaneous(Gesture.Exclusive(doubleTap, tap), pinch, pan);
  }, [
    duration,
    focusZoom,
    onSquarePress,
    size,
    startX,
    startY,
    startZoom,
    tx,
    ty,
    zoom,
    zoomMax,
    zoomMin,
  ]);

  const focusSeq = focusRequest?.seq;
  const focusRow = focusRequest?.row;
  const focusCol = focusRequest?.col;
  useEffect(() => {
    if (focusSeq === undefined || focusRow === undefined || focusCol === undefined) return;
    const x = focusTranslation(focusCol, size, focusZoom);
    const y = focusTranslation(focusRow, size, focusZoom);
    if (duration === 0) {
      zoom.set(focusZoom);
      tx.set(x);
      ty.set(y);
      return;
    }
    const easing = Easing.bezier(0.2, 0, 0, 1);
    zoom.set(withTiming(focusZoom, { duration, easing }));
    tx.set(withTiming(x, { duration, easing }));
    ty.set(withTiming(y, { duration, easing }));
  }, [duration, focusCol, focusRow, focusSeq, focusZoom, size, tx, ty, zoom]);

  const origin = size / 2;
  const transform = useDerivedValue(() => [
    { translateX: origin + tx.get() },
    { translateY: origin + ty.get() },
    { scale: zoom.get() },
    { translateX: -origin },
    { translateY: -origin },
  ]);

  const screenReader = a11yMode === 'screenReader';
  return (
    // The board and rack are never mirrored in RTL: rows and columns are a game constant (E-1.4 §5.3).
    <View testID="board.root" style={[styles.root, { width: size, height: size }]}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas
            testID="board.canvas"
            style={styles.fill}
            accessibilityLabel={screenReader ? undefined : props.labels.board}
            accessibilityRole={screenReader ? undefined : 'image'}
            importantForAccessibility={screenReader ? 'no-hide-descendants' : 'yes'}
            accessibilityElementsHidden={screenReader}
          >
            <Group transform={transform}>
              <BoardPicture
                squares={props.squares}
                size={size}
                tokens={tokens}
                premiumLabels={props.premiumLabels}
              />
            </Group>
          </Canvas>
        </View>
      </GestureDetector>
      {screenReader && (
        <AccessibleGrid
          squares={props.squares}
          size={size}
          labels={props.labels}
          armed={props.armed}
          focusZoom={focusZoom}
          onSquarePress={onSquarePress}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { direction: 'ltr', overflow: 'hidden' },
  fill: { flex: 1 },
  row: { position: 'absolute', start: 0, flexDirection: 'row' },
});
