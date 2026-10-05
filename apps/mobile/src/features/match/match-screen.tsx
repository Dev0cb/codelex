import {
  getLayout,
  getLetterTable,
  observe,
  type Letter,
  type MatchState,
} from '@codelex/game-engine';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMotionMode, useScreenReader } from '../../a11y/accessibility';
import { boardSquares, squareLabel, type SquareView } from '../../board/board-scene';
import { BoardView } from '../../board/board-view';
import { FOCUS_THRESHOLD } from '../../board/geometry';
import { useFlag } from '../../config/flags-provider';
import { useI18n } from '../../i18n/i18n-provider';
import { visibleRack } from '../../match/match-model';
import { BOT_SEAT, HUMAN_SEAT, PLAY_LAYOUT, PLAY_LETTERS } from '../../match/play-config';
import { statusLines } from '../../match/status';
import { useMatch } from '../../match/use-match';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { MatchEnd } from './match-end';
import { RackView } from './rack-view';
import { ThinkingIndicator } from './thinking-indicator';

/** E-1.5 §5.5.10: the final board stays 600 ms before the end screen (reduced motion: immediately). */
export const MATCH_END_HOLD_MS = 600;

const LETTERS: readonly Letter[] = Array.from(
  { length: 26 },
  (_, i) => String.fromCharCode(65 + i) as Letter,
);
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const layout = getLayout(PLAY_LAYOUT);
const letters = getLetterTable(PLAY_LETTERS);

/**
 * Match vs the Beginner bot (E-1.5 slice S1), behind `play_vs_bot.enabled`. With the flag off the route sends the
 * player Home, where the paused card explains why (AC-19).
 */
export function MatchScreen(): JSX.Element {
  const enabled = useFlag('play_vs_bot.enabled');
  if (!enabled) return <Redirect href="/" />;
  return <MatchSession />;
}

function ScoreBlock({
  name,
  score,
  active,
  testID,
  thinking,
}: {
  readonly name: string;
  readonly score: number;
  readonly active: boolean;
  readonly testID: string;
  readonly thinking?: JSX.Element | false;
}): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  return (
    <View
      accessible
      accessibilityLabel={t('match.score.a11y', { name, points: score })}
      accessibilityState={{ selected: active }}
      style={[styles.scoreBlock, { gap: space[1] }]}
    >
      <View style={[styles.row, { gap: space[2] }]}>
        {active && <View style={[styles.turnDot, { backgroundColor: color.accentPrimary }]} />}
        <Text numberOfLines={1} style={[type.caption, { color: color.textMuted }]}>
          {name}
        </Text>
        {thinking}
      </View>
      <Text testID={testID} style={[type.title, styles.mono, { color: color.textPrimary }]}>
        {score}
      </Text>
      {/* Turn marker: underline + dot + the strip text, never colour alone (E-1.5 §5.5.1). */}
      <View
        style={[
          styles.underline,
          { backgroundColor: active ? color.accentPrimary : 'transparent' },
        ]}
      />
    </View>
  );
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  readonly visible: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: JSX.Element | readonly JSX.Element[];
}): JSX.Element {
  const { color, overlay, radius, space, type } = useTokens();
  const motion = useMotionMode();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={motion === 'reduced' ? 'fade' : 'slide'}
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: overlay.scrim, opacity: overlay.scrimOpacity },
          ]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: color.bgSurface,
              borderTopStartRadius: radius.sheet,
              borderTopEndRadius: radius.sheet,
              padding: space[5],
              gap: space[4],
            },
          ]}
        >
          <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function MatchSession(): JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const { color, layout: dims, space, type } = tokens;
  const motion = useMotionMode();
  const screenReader = useScreenReader();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { model, dispatch, restart } = useMatch();
  const [focus, setFocus] = useState<{ row: number; col: number; seq: number } | null>(null);
  const [confirmPass, setConfirmPass] = useState(false);
  /** The finished state whose end screen is due (after the §5.5.10 hold). */
  const [endDue, setEndDue] = useState<MatchState | null>(null);

  const botName = t('bot.beginner.name');
  const names = useMemo(() => ({ you: t('match.you'), bot: botName }), [t, botName]);
  const finished = model?.state.status === 'finished';

  const finishedState = finished ? model.state : null;
  useEffect(() => {
    if (finishedState === null) return;
    const timer = setTimeout(
      () => {
        setEndDue(finishedState);
      },
      motion === 'reduced' ? 0 : MATCH_END_HOLD_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [finishedState, motion]);

  const squares = useMemo(
    () =>
      model === null
        ? []
        : boardSquares({
            layout,
            letters,
            board: model.state.board,
            pending: model.pending,
            owners: model.owners,
            lastMove: model.lastMove?.kind === 'word' ? model.lastMove.squares : [],
            humanSeat: HUMAN_SEAT,
          }),
    [model],
  );

  const selected = model?.selectedSlotId ?? null;
  const onSquarePress = useCallback(
    (row: number, col: number, zoom: number) => {
      const square = squares[row * layout.size + col];
      // D-2: in Overview, the first tap with a selected tile frames that point in Focus; the next tap places.
      if (selected !== null && square?.tile === null && zoom < FOCUS_THRESHOLD && !screenReader) {
        setFocus((previous) => ({ row, col, seq: (previous?.seq ?? 0) + 1 }));
        return;
      }
      dispatch({ type: 'press_square', row, col });
    },
    [dispatch, screenReader, selected, squares],
  );

  const goHome = useCallback(() => {
    router.replace('/');
  }, [router]);

  if (model === null) {
    return (
      <SafeAreaView style={[styles.root, styles.centred, { backgroundColor: color.bgBase }]}>
        <Text
          accessibilityLiveRegion="assertive"
          style={[type.bodyL, { color: color.textPrimary, padding: space[5] }]}
        >
          {t('match.start.error')}
        </Text>
        <Button label={t('common.retry')} onPress={restart} variant="primary" />
      </SafeAreaView>
    );
  }

  if (finished && endDue === model.state) {
    return <MatchEnd state={model.state} botName={botName} onPlayAgain={restart} onHome={goHome} />;
  }

  const view = observe(model.state, HUMAN_SEAT);
  const playing = model.state.status === 'in_progress' && model.failure === null;
  const yourTurn = playing && model.state.seatOnTurn === HUMAN_SEAT;
  const botTurn = playing && model.state.seatOnTurn === BOT_SEAT;
  const status = statusLines(model, names);
  const boardSize = Math.min(width - 2 * dims.marginMatch, dims.contentMaxWidth);
  const labelSquare = (square: SquareView): string => squareLabel(t, square, botName);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <View style={[styles.topBar, { paddingHorizontal: space[5], paddingVertical: space[3] }]}>
        <ScoreBlock
          name={names.you}
          score={view.seats[HUMAN_SEAT]?.score ?? 0}
          active={yourTurn}
          testID="match.score.you"
        />
        <ScoreBlock
          name={botName}
          score={view.seats[BOT_SEAT]?.score ?? 0}
          active={botTurn}
          testID="match.score.bot"
          thinking={botTurn && <ThinkingIndicator motion={motion} />}
        />
        <Text
          testID="match.bag"
          accessibilityLabel={t('match.bag.a11y', { count: view.bagCount })}
          style={[type.bodyS, styles.mono, { color: color.textMuted }]}
        >
          {t('match.bag', { count: view.bagCount })}
        </Text>
      </View>
      <View style={styles.boardSlot}>
        <BoardView
          squares={squares}
          size={boardSize}
          tokens={tokens}
          premiumLabels={{
            DL: t('board.premium.dl.label'),
            TL: t('board.premium.tl.label'),
            DW: t('board.premium.dw.label'),
            TW: t('board.premium.tw.label'),
          }}
          motion={motion}
          a11yMode={screenReader ? 'screenReader' : 'off'}
          labels={{
            board: t('a11y.board.label'),
            row: (row) => t('a11y.board.row', { row }),
            square: labelSquare,
            placeHint: t('a11y.square.place_hint'),
            pendingHint: t('a11y.square.pending_hint'),
          }}
          armed={selected !== null}
          focusRequest={focus}
          onSquarePress={onSquarePress}
        />
      </View>
      <View
        testID="match.status"
        accessibilityLiveRegion={status.tone === 'error' ? 'assertive' : 'polite'}
        style={[styles.strip, { paddingHorizontal: space[5], paddingVertical: space[3] }]}
      >
        <Text
          testID="match.status.primary"
          style={[
            type.body,
            { color: status.tone === 'error' ? color.feedbackError : color.textPrimary },
          ]}
        >
          {t(status.primary.key, status.primary.params)}
        </Text>
        {status.secondary !== null && (
          <Text style={[type.bodyS, { color: color.textMuted }]}>
            {t(status.secondary.key, status.secondary.params)}
          </Text>
        )}
      </View>
      <RackView
        slots={visibleRack(model)}
        selectedSlotId={selected}
        letters={letters}
        onSelect={(slotId) => {
          dispatch({ type: 'select', slotId });
        }}
      />
      <View
        style={[
          styles.actions,
          { gap: space[3], paddingHorizontal: space[5], paddingVertical: space[4] },
        ]}
      >
        {model.pending.length > 0 && (
          <Button
            testID="match.action.recall"
            label={t('match.action.recall')}
            onPress={() => {
              dispatch({ type: 'recall' });
            }}
          />
        )}
        <Button
          testID="match.action.pass"
          label={t('match.action.pass')}
          disabled={!yourTurn}
          onPress={() => {
            setConfirmPass(true);
          }}
        />
        <View style={styles.spacer} />
        <Button
          testID="match.action.play"
          variant="primary"
          label={t('match.action.play')}
          accessibilityLabel={t('match.action.play.a11y')}
          // D-5: enabled whenever a tile is pending on the player's turn; the engine explains any rejection.
          disabled={!yourTurn || model.pending.length === 0}
          onPress={() => {
            dispatch({ type: 'play' });
          }}
        />
      </View>
      {model.failure !== null && (
        <View style={[styles.actions, { paddingHorizontal: space[5] }]}>
          <Button label={t('summary.home')} onPress={goHome} />
        </View>
      )}
      <Sheet
        visible={model.blankRequest !== null}
        title={t('match.blank.title')}
        onClose={() => {
          dispatch({ type: 'cancel_blank' });
        }}
      >
        <View style={[styles.letterGrid, { gap: space[2] }]}>
          {LETTERS.map((letter) => (
            <Pressable
              key={letter}
              testID={`match.blank.${letter}`}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.blank.letter', { letter })}
              onPress={() => {
                dispatch({ type: 'choose_blank', letter });
              }}
              style={[
                styles.letterKey,
                {
                  width: dims.touchMin,
                  height: dims.touchMin,
                  borderRadius: tokens.radius.square,
                  backgroundColor: tokens.board.tileFace,
                },
              ]}
            >
              <Text style={[type.title, styles.mono, { color: tokens.board.tileInk }]}>
                {letter}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[type.bodyS, { color: color.textMuted }]}>{t('match.blank.note')}</Text>
        <Button
          label={t('common.cancel')}
          onPress={() => {
            dispatch({ type: 'cancel_blank' });
          }}
        />
      </Sheet>
      <Sheet
        visible={confirmPass}
        title={t('match.pass.title')}
        onClose={() => {
          setConfirmPass(false);
        }}
      >
        <Text style={[type.body, { color: color.textMuted }]}>{t('match.pass.body')}</Text>
        <View style={[styles.actions, { gap: space[3] }]}>
          <Button
            testID="match.pass.cancel"
            label={t('common.cancel')}
            onPress={() => {
              setConfirmPass(false);
            }}
          />
          <View style={styles.spacer} />
          <Button
            testID="match.pass.confirm"
            variant="primary"
            label={t('match.pass.confirm')}
            onPress={() => {
              setConfirmPass(false);
              dispatch({ type: 'pass' });
            }}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  scoreBlock: { minWidth: 96 },
  turnDot: { width: 8, height: 8, borderRadius: 4 },
  underline: { height: 3, borderRadius: 2, alignSelf: 'stretch' },
  mono: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  boardSlot: { alignItems: 'center' },
  strip: { minHeight: 48, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spacer: { flex: 1 },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { alignSelf: 'stretch' },
  letterGrid: { flexDirection: 'row', flexWrap: 'wrap', direction: 'ltr' },
  letterKey: { alignItems: 'center', justifyContent: 'center' },
});
