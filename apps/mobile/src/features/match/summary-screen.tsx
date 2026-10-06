import type { LetterTable } from '@codelex/game-engine';
import type { MessageKey } from '@codelex/i18n';
import type { JSX } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '../../i18n/i18n-provider';
import { HUMAN_SEAT } from '../../match/play-config';
import type { MatchSummary, TermChip } from '../../match/summary';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';

type Outcome = MatchSummary['outcome'];

const TITLE: Readonly<Record<Outcome, MessageKey>> = {
  victory: 'summary.victory',
  defeat: 'summary.defeat',
  draw: 'summary.draw',
};
const SUBTITLE: Readonly<Record<Outcome, MessageKey>> = {
  victory: 'summary.sub.victory',
  defeat: 'summary.sub.defeat',
  draw: 'summary.sub.draw',
};

/** D-30: the blank shows `_` (a code glyph, not copy). */
const BLANK_GLYPH = '_';
const CODE_A = 65;
/** System mono until a bundled mono face is decided (D-28; the iOS asset budget has no room today). */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** A signed rack adjustment: symbols, not copy (U+2212 minus for negatives). */
const signed = (n: number): string => (n > 0 ? `+${String(n)}` : n < 0 ? `−${String(-n)}` : '0');

export interface SummaryScreenProps {
  readonly summary: MatchSummary;
  readonly botName: string;
  readonly letters: LetterTable;
  /** False when `play_vs_bot.enabled` is off: Play again is replaced by the paused line (§5.6). */
  readonly canPlayAgain: boolean;
  readonly onPlayAgain: () => void;
  readonly onHome: () => void;
}

function Chips({
  chips,
  testID,
}: {
  readonly chips: readonly TermChip[];
  readonly testID: string;
}) {
  const { color, radius, space, type } = useTokens();
  return (
    <View testID={testID} style={[styles.wrap, { gap: space[2] }]}>
      {chips.map((chip) => (
        // Inert until the Knowledge Card ships (slice S5, AC-13/AC-14): no chevron, no ripple, not a button.
        <Text
          key={chip.termId}
          style={[
            type.bodyS,
            styles.mono,
            {
              color: color.textPrimary,
              backgroundColor: color.bgRaised,
              borderColor: color.borderSubtle,
              borderRadius: radius.chip,
              paddingHorizontal: space[3],
              paddingVertical: space[1],
            },
            styles.chip,
          ]}
        >
          {chip.form}
        </Text>
      ))}
    </View>
  );
}

/**
 * The end-of-match Summary (E-1.5 AC-10, design §5.6, D-15): result, final scores with rack adjustments, why it
 * ended, the margin, the best word, the terms both sides played (deduplicated, canonical) and the bot's last rack,
 * with a sticky action bar so Play again is one tap from anywhere. Numbers are the engine's (see `summarize`).
 * Tone: celebratory on a win, never mocking on a loss (§8.1). "New to you" and term cards come with S3 and S5.
 */
export function SummaryScreen({
  summary,
  botName,
  letters,
  canPlayAgain,
  onPlayAgain,
  onHome,
}: SummaryScreenProps): JSX.Element {
  const { t } = useI18n();
  const { board, color, layout, radius, space, type } = useTokens();
  const result = t(TITLE[summary.outcome]);
  const best = summary.bestWord;
  const noTerms = summary.terms.you.length === 0 && summary.terms.bot.length === 0;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={t('a11y.announce.result', {
            result,
            you: summary.you,
            them: summary.them,
          })}
          style={[styles.centre, { gap: space[2] }]}
        >
          <Text testID="summary.result" style={[type.display, { color: color.textPrimary }]}>
            {result}
          </Text>
          <Text style={[type.bodyL, { color: color.textMuted }]}>
            {t(SUBTITLE[summary.outcome])}
          </Text>
        </View>
        <View style={[styles.scores, { gap: space[6] }]}>
          <View style={styles.centre}>
            <Text style={[type.caption, { color: color.textMuted }]}>{t('match.you')}</Text>
            <Text
              testID="summary.score.you"
              style={[type.title, styles.mono, { color: color.textPrimary }]}
            >
              {summary.you}
            </Text>
          </View>
          <View style={styles.centre}>
            <Text style={[type.caption, { color: color.textMuted }]}>{botName}</Text>
            <Text
              testID="summary.score.bot"
              style={[type.title, styles.mono, { color: color.textPrimary }]}
            >
              {summary.them}
            </Text>
          </View>
        </View>
        <View style={[styles.centre, { gap: space[1] }]}>
          {summary.adjustments !== null && (
            <Text testID="summary.rackAdjust" style={[type.body, { color: color.textMuted }]}>
              {t('summary.rack_adjust', {
                bot: botName,
                you: signed(summary.adjustments.you),
                them: signed(summary.adjustments.them),
              })}
            </Text>
          )}
          {summary.end !== null && (
            <Text testID="summary.reason" style={[type.body, { color: color.textMuted }]}>
              {t(summary.end.key, { ...summary.end.params, bot: botName })}
            </Text>
          )}
          <Text testID="summary.margin" style={[type.bodyS, { color: color.textMuted }]}>
            {t('summary.margin', { margin: summary.margin })}
          </Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
            {t('summary.best_word')}
          </Text>
          <Text testID="summary.bestWord" style={[type.body, { color: color.textPrimary }]}>
            {best === null
              ? t('summary.best_word.none')
              : t('summary.best_word.detail', {
                  form: best.form,
                  points: best.points,
                  actor: best.seat === HUMAN_SEAT ? t('match.you') : botName,
                })}
          </Text>
        </View>

        <View style={{ gap: space[2] }}>
          <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
            {t('summary.terms.title')}
          </Text>
          {noTerms ? (
            <Text style={[type.body, { color: color.textMuted }]}>{t('summary.terms.empty')}</Text>
          ) : (
            <>
              <Text style={[type.caption, { color: color.textMuted }]}>
                {t('summary.terms.you')}
              </Text>
              <Chips chips={summary.terms.you} testID="summary.terms.you" />
              <Text style={[type.caption, { color: color.textMuted }]}>{botName}</Text>
              <Chips chips={summary.terms.bot} testID="summary.terms.bot" />
            </>
          )}
        </View>

        {summary.botRack !== null && (
          <View style={{ gap: space[2] }}>
            <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
              {t('summary.bot_rack', { bot: botName })}
            </Text>
            {summary.botRack === '' ? (
              <Text style={[type.body, { color: color.textMuted }]}>
                {t('summary.bot_rack.empty')}
              </Text>
            ) : (
              <View testID="summary.botRack" style={[styles.wrap, { gap: layout.rackGap }]}>
                {Array.from(summary.botRack, (tile) => tile).map((tile, i) => {
                  const isBlank = tile === '?';
                  const value = isBlank ? 0 : (letters.values[tile.charCodeAt(0) - CODE_A] ?? 0);
                  return (
                    <View
                      key={i}
                      accessible
                      accessibilityLabel={
                        isBlank
                          ? t('a11y.tile.blank_rack')
                          : t('a11y.tile.letter', { letter: tile, points: value })
                      }
                      style={[
                        styles.tile,
                        {
                          width: layout.touchMin * 0.75,
                          height: layout.touchMin * 0.75,
                          borderRadius: radius.tile,
                          backgroundColor: board.tileFace,
                        },
                      ]}
                    >
                      <Text style={[type.title, styles.mono, { color: board.tileInk }]}>
                        {isBlank ? BLANK_GLYPH : tile}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
      {/* D-15: sticky bar, exempt from scrolling, so Play again is one tap away from anywhere. */}
      <View
        style={[
          styles.bar,
          { padding: space[5], gap: space[3], borderTopColor: color.borderSubtle },
        ]}
      >
        {canPlayAgain ? (
          <Button
            testID="summary.playAgain"
            variant="primary"
            label={t('summary.play_again')}
            onPress={onPlayAgain}
          />
        ) : (
          <Text style={[type.body, styles.centre, { color: color.textMuted }]}>
            {t('home.paused')}
          </Text>
        )}
        <Button testID="summary.home" label={t('summary.home')} onPress={onHome} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: { alignItems: 'center', textAlign: 'center' },
  scores: { flexDirection: 'row', justifyContent: 'center' },
  mono: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', direction: 'ltr' },
  chip: { borderWidth: 1, overflow: 'hidden' },
  tile: { alignItems: 'center', justifyContent: 'center' },
  bar: { alignSelf: 'stretch', borderTopWidth: StyleSheet.hairlineWidth },
});
