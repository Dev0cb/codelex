import {
  getLayout,
  getLetterTable,
  observe,
  type Letter,
  type MatchState,
  type Square,
} from '@codelex/game-engine';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  AccessibilityInfo,
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
import { prewarmBundledCards } from '../../knowledge/bundled-cards';
import { useLexicon } from '../../lexicon/lexicon-gate';
import { useCardDeps } from '../knowledge/use-card-deps';
import { useI18n } from '../../i18n/i18n-provider';
import { breakdownChips } from '../../match/breakdown';
import {
  exchangeStatus,
  livePreview,
  shuffledOrder,
  visibleRack,
  type MoveEntry,
} from '../../match/match-model';
import { BOT_SEAT, HUMAN_SEAT, PLAY_LAYOUT, PLAY_LETTERS } from '../../match/play-config';
import { scorelessWarning, statusLines } from '../../match/status';
import { summarize } from '../../match/summary';
import { useMatchSession } from '../../match/match-session';
import { MatchServicesContext, useMatch } from '../../match/use-match';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';
import { Sheet } from '../../ui/sheet';
import {
  BreakdownSheet,
  ConfirmSheet,
  ExchangeSheet,
  LegendSheet,
  MenuSheet,
  MoveLogSheet,
} from './match-sheets';
import { RackView } from './rack-view';
import { SummaryScreen, type SummaryScreenProps } from './summary-screen';
import { ThinkingIndicator } from './thinking-indicator';

/** E-1.5 §5.5.10: the final board stays 600 ms before the end screen (reduced motion: immediately). */
export const MATCH_END_HOLD_MS = 600;

const LETTERS: readonly Letter[] = Array.from(
  { length: 26 },
  (_, i) => String.fromCharCode(65 + i) as Letter,
);
/** System mono until a bundled mono face is decided (D-28). */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
/** The match menu glyph (§5.5.1 "⋯"): an icon, labelled by `match.menu.a11y`. */
const MENU_GLYPH = '⋯';
const NO_SQUARES: readonly Square[] = [];
/** E-1.5 D-20: from this system font scale, Shuffle / Exchange / Pass collapse into one More button. */
export const MORE_FONT_SCALE = 1.5;
const layout = getLayout(PLAY_LAYOUT);
const letters = getLetterTable(PLAY_LETTERS);

type WordEntry = Extract<MoveEntry, { kind: 'word' }>;
type OpenSheet =
  'menu' | 'log' | 'legend' | 'pass' | 'exchange' | 'resign' | 'breakdown' | 'more' | null;

/**
 * Match vs the Beginner bot (E-1.5 slices S1–S3), behind `play_vs_bot.enabled`. With the flag off the route sends
 * the player Home, where the paused card explains why, unless a match is open: an in-progress match can still be
 * resumed and finished (AC-19).
 */
export function MatchScreen(): JSX.Element {
  const enabled = useFlag('play_vs_bot.enabled');
  const open = (useMatchSession()?.model ?? null) !== null;
  if (!enabled && !open) return <Redirect href="/" />;
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

/** The Summary with Knowledge Cards when the flag is on (decodes the card text only once the Summary mounts). */
function SummaryWithCards(props: Omit<SummaryScreenProps, 'cards'>): JSX.Element {
  return <SummaryScreen {...props} cards={useCardDeps()} />;
}

function MatchSession(): JSX.Element {
  const { t } = useI18n();
  const tokens = useTokens();
  const { color, layout: dims, radius, space, type } = tokens;
  const motion = useMotionMode();
  const screenReader = useScreenReader();
  const router = useRouter();
  const services = useContext(MatchServicesContext);
  const previewEnabled = useFlag('match.live_score_preview');
  const playEnabled = useFlag('play_vs_bot.enabled');
  const { width, fontScale } = useWindowDimensions();
  const { model, dispatch, restart, startFailed } = useMatch();
  const session = useMatchSession();
  const lowStorage = session?.lowStorage ?? false;
  const restored = session?.restored ?? 0;
  const [focus, setFocus] = useState<{ row: number; col: number; seq: number } | null>(null);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  /** The finished state whose end screen is due (after the §5.5.10 hold). */
  const [endDue, setEndDue] = useState<MatchState | null>(null);

  const botName = t('bot.beginner.name');
  const names = useMemo(() => ({ you: t('match.you'), bot: botName }), [t, botName]);
  // Stable props keep the memoised Skia board picture from rebuilding on every render (E-1.4 §2.4).
  const premiumLabels = useMemo(
    () => ({
      DL: t('board.premium.dl.label'),
      TL: t('board.premium.tl.label'),
      DW: t('board.premium.dw.label'),
      TW: t('board.premium.tw.label'),
    }),
    [t],
  );
  const finished = model?.state.status === 'finished';
  const cardsEnabled = useFlag('knowledge_card.post_match.enabled');
  const lexiconVersion = useLexicon().descriptor.lexiconVersion;

  const finishedState = finished ? model.state : null;
  // S5: decode the Knowledge Card text during the end-of-match hold, so the Summary opens without that work.
  useEffect(() => {
    if (finishedState === null || !cardsEnabled) return;
    return prewarmBundledCards(lexiconVersion);
  }, [finishedState, cardsEnabled, lexiconVersion]);
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

  // Only what the board draws: rack-only changes (Shuffle, select, notices) keep the same squares, so the memoised
  // Skia picture is not rebuilt (E-1.4 §2.4). The reducer keeps unchanged references stable.
  const board = model?.state.board;
  const pending = model?.pending;
  const owners = model?.owners;
  const lastSquares = model?.lastMove?.kind === 'word' ? model.lastMove.squares : NO_SQUARES;
  const squares = useMemo(
    () =>
      board === undefined || pending === undefined || owners === undefined
        ? []
        : boardSquares({
            layout,
            letters,
            board,
            pending,
            owners,
            lastMove: lastSquares,
            humanSeat: HUMAN_SEAT,
          }),
    [board, pending, owners, lastSquares],
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
  const closeSheet = useCallback(() => {
    setSheet(null);
  }, []);

  // §5.5.9: one announcement when a saved match comes back, with whose turn it is and the score.
  const restoredState = restored > 0 ? model?.state : undefined;
  const restoredAnnouncement =
    restoredState === undefined
      ? null
      : t('match.resume.restored', {
          status:
            restoredState.seatOnTurn === HUMAN_SEAT
              ? t('home.resume.status.your_turn')
              : t('home.resume.status.bot_turn', { bot: botName }),
          you: restoredState.seats[HUMAN_SEAT]?.score ?? 0,
          them: restoredState.seats[BOT_SEAT]?.score ?? 0,
        });
  const announced = useRef(0);
  useEffect(() => {
    if (restored === announced.current || restoredAnnouncement === null) return;
    announced.current = restored;
    AccessibilityInfo.announceForAccessibility(restoredAnnouncement);
  }, [restored, restoredAnnouncement]);

  if (model === null) {
    // No open match (e.g. a link straight to /match): the player starts or resumes from Home.
    if (!startFailed) return <Redirect href="/" />;
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

  const summary =
    finished && endDue === model.state ? summarize(model, session?.newToYou ?? null) : null;
  if (summary !== null) {
    return (
      <SummaryWithCards
        summary={summary}
        botName={botName}
        letters={letters}
        canPlayAgain={playEnabled}
        onPlayAgain={restart}
        onHome={goHome}
        onSummaryEvent={session?.noteSummary}
      />
    );
  }

  const view = observe(model.state, HUMAN_SEAT);
  const playing = model.state.status === 'in_progress' && model.failure === null;
  const yourTurn = playing && model.state.seatOnTurn === HUMAN_SEAT;
  const botTurn = playing && model.state.seatOnTurn === BOT_SEAT;
  const preview = previewEnabled ? livePreview(model) : null;
  const status = statusLines(model, names, preview);
  const warning = scorelessWarning(model.state);
  const explained: WordEntry | null =
    model.lastMove?.kind === 'word' &&
    model.pending.length === 0 &&
    model.rejection === null &&
    model.failure === null
      ? model.lastMove
      : null;
  const chips = explained === null ? [] : breakdownChips(explained.breakdown);
  const boardSize = Math.min(width - 2 * dims.marginMatch, dims.contentMaxWidth);
  const labelSquare = (square: SquareView): string => squareLabel(t, square, botName);
  const exchange = exchangeStatus(model.state);
  const exchangeOpen = exchange.ok && model.failure === null;
  // Sheets close by themselves once the match is over (§5.5.10 hold on the final board).
  const open: OpenSheet = finished ? null : sheet;
  const compact = fontScale >= MORE_FONT_SCALE;

  // Shuffle, Exchange, Pass: in the action row, or in the More sheet at large text (D-20).
  const secondaryActions = (
    <>
      <Button
        testID="match.action.shuffle"
        label={t('match.action.shuffle')}
        disabled={!playing}
        onPress={() => {
          if (compact) setSheet(null);
          dispatch({
            type: 'shuffle',
            order: shuffledOrder(model.slots, services.shuffleRandom),
          });
        }}
      />
      <Button
        testID="match.action.exchange"
        label={t('match.action.exchange')}
        disabled={!yourTurn}
        unavailable={yourTurn && !exchangeOpen}
        accessibilityHint={
          yourTurn && !exchangeOpen
            ? t('match.exchange.disabled', { count: view.bagCount, min: exchange.minBag })
            : undefined
        }
        onPress={() => {
          if (exchangeOpen) {
            setSheet('exchange');
            return;
          }
          if (compact) setSheet(null);
          dispatch({ type: 'explain_exchange' });
        }}
      />
      <Button
        testID="match.action.pass"
        label={t('match.action.pass')}
        disabled={!yourTurn}
        onPress={() => {
          setSheet('pass');
        }}
      />
    </>
  );

  const strip = (
    <>
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
        <Text testID="match.status.secondary" style={[type.bodyS, { color: color.textMuted }]}>
          {t(status.secondary.key, status.secondary.params)}
        </Text>
      )}
      {warning !== null && (
        <Text testID="match.status.warning" style={[type.bodyS, { color: color.feedbackWarning }]}>
          {t(warning.key, warning.params)}
        </Text>
      )}
      {chips.length > 0 && (
        <View testID="match.breakdown.chips" style={[styles.wrap, { gap: space[2] }]}>
          {chips.map((chip) => (
            <Text
              key={chip.key}
              style={[
                type.caption,
                styles.mono,
                {
                  color: color.textPrimary,
                  borderColor: color.borderSubtle,
                  borderRadius: radius.chip,
                  paddingHorizontal: space[2],
                },
                styles.chip,
              ]}
            >
              {t(chip.key, chip.params)}
            </Text>
          ))}
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      {lowStorage && (
        // §5.5.9 / §5.10.3: persistent until a write succeeds, dismissible, play continues.
        <View
          testID="match.lowStorage"
          accessibilityLiveRegion="polite"
          style={[
            styles.row,
            styles.banner,
            { gap: space[2], paddingHorizontal: space[4], backgroundColor: color.bgSurface },
          ]}
        >
          <Text style={[type.bodyS, styles.bannerText, { color: color.feedbackWarning }]}>
            {t('match.low_storage')}
          </Text>
          <Button
            testID="match.lowStorage.dismiss"
            label={t('common.close')}
            onPress={() => session?.dismissLowStorage()}
          />
        </View>
      )}
      <View style={[styles.topBar, { paddingHorizontal: space[3], paddingVertical: space[3] }]}>
        <Pressable
          testID="match.menu.open"
          accessibilityRole="button"
          accessibilityLabel={t('match.menu.a11y')}
          onPress={() => {
            setSheet('menu');
          }}
          style={[styles.iconButton, { width: dims.touchMin, height: dims.touchMin }]}
        >
          <Text style={[type.title, { color: color.textPrimary }]}>{MENU_GLYPH}</Text>
        </Pressable>
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
          premiumLabels={premiumLabels}
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
      {explained === null ? (
        <View
          testID="match.status"
          accessibilityLiveRegion={status.tone === 'error' ? 'assertive' : 'polite'}
          style={[styles.strip, { paddingHorizontal: space[5], paddingVertical: space[3] }]}
        >
          {strip}
        </View>
      ) : (
        // D-14: the score explanation stays until the player picks up a tile or the next move lands; tap = detail.
        <Pressable
          testID="match.status"
          accessibilityRole="button"
          accessibilityHint={t('match.breakdown.tap_hint')}
          accessibilityLiveRegion="polite"
          onPress={() => {
            setSheet('breakdown');
          }}
          style={[styles.strip, { paddingHorizontal: space[5], paddingVertical: space[3] }]}
        >
          {strip}
        </Pressable>
      )}
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
          { gap: space[2], paddingHorizontal: space[3], paddingVertical: space[4] },
        ]}
      >
        {compact ? (
          // D-20: at large text the secondary actions move into one More sheet so PLAY stays in the row.
          <Button
            testID="match.action.more"
            label={t('match.action.more')}
            disabled={!playing}
            onPress={() => {
              setSheet('more');
            }}
          />
        ) : (
          secondaryActions
        )}
        <View style={styles.spacer} />
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
      <ConfirmSheet
        visible={open === 'pass'}
        testID="match.pass"
        title={t('match.pass.title')}
        body={t('match.pass.body')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('match.pass.confirm')}
        onCancel={closeSheet}
        onConfirm={() => {
          setSheet(null);
          dispatch({ type: 'pass' });
        }}
      />
      <ExchangeSheet
        visible={open === 'exchange'}
        slots={model.slots}
        letters={letters}
        onCancel={closeSheet}
        onConfirm={(slotIds) => {
          setSheet(null);
          dispatch({ type: 'exchange', slotIds });
        }}
      />
      <MenuSheet
        visible={open === 'menu'}
        canResign={playing}
        onClose={closeSheet}
        onLog={() => {
          setSheet('log');
        }}
        onLegend={() => {
          setSheet('legend');
        }}
        onResign={() => {
          setSheet('resign');
        }}
      />
      <ConfirmSheet
        visible={open === 'resign'}
        testID="match.resign"
        destructive
        title={t('match.resign.title')}
        body={t('match.resign.body')}
        cancelLabel={t('match.resign.cancel')}
        confirmLabel={t('match.resign.confirm')}
        onCancel={closeSheet}
        onConfirm={() => {
          setSheet(null);
          dispatch({ type: 'resign' });
        }}
      />
      <Sheet
        visible={open === 'more'}
        title={t('match.action.more')}
        onClose={closeSheet}
        testID="match.more"
      >
        <View style={{ gap: space[3] }}>{secondaryActions}</View>
        <Button label={t('common.close')} onPress={closeSheet} />
      </Sheet>
      <MoveLogSheet visible={open === 'log'} log={model.log} names={names} onClose={closeSheet} />
      <LegendSheet
        visible={open === 'legend'}
        layout={layout}
        premiumLabels={premiumLabels}
        onClose={closeSheet}
      />
      <BreakdownSheet
        entry={open === 'breakdown' ? explained : null}
        names={names}
        onClose={closeSheet}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { minHeight: 48 },
  bannerText: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1 },
  topBar: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
  scoreBlock: { minWidth: 88 },
  turnDot: { width: 8, height: 8, borderRadius: 4 },
  underline: { height: 3, borderRadius: 2, alignSelf: 'stretch' },
  mono: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  boardSlot: { alignItems: 'center' },
  strip: { minHeight: 48, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spacer: { flex: 1 },
  letterGrid: { flexDirection: 'row', flexWrap: 'wrap', direction: 'ltr' },
  letterKey: { alignItems: 'center', justifyContent: 'center' },
});
