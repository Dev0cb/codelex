import { observe, type MatchState } from '@codelex/game-engine';
import type { MessageKey } from '@codelex/i18n';
import type { JSX } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '../../i18n/i18n-provider';
import { endReason, matchOutcome } from '../../match/match-model';
import { BOT_SEAT, HUMAN_SEAT } from '../../match/play-config';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';

const TITLE: Readonly<Record<'victory' | 'defeat' | 'draw', MessageKey>> = {
  victory: 'summary.victory',
  defeat: 'summary.defeat',
  draw: 'summary.draw',
};
const SUBTITLE: Readonly<Record<'victory' | 'defeat' | 'draw', MessageKey>> = {
  victory: 'summary.sub.victory',
  defeat: 'summary.sub.defeat',
  draw: 'summary.sub.draw',
};

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export interface MatchEndProps {
  readonly state: MatchState;
  readonly botName: string;
  readonly onPlayAgain: () => void;
  readonly onHome: () => void;
}

/**
 * Minimal end screen of slice S1 (E-1.5 AC-10 subset; the full Summary is S2): result, final scores as the engine
 * computed them (R-SCORE-006 adjustments included), why the match ended, Play again and Home. Tone: celebratory on
 * a win, never mocking on a loss (§8.1).
 */
export function MatchEnd({ state, botName, onPlayAgain, onHome }: MatchEndProps): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  const outcome = matchOutcome(state) ?? 'draw';
  const reason = endReason(state);
  const view = observe(state, HUMAN_SEAT);
  const you = view.seats[HUMAN_SEAT]?.score ?? 0;
  const them = view.seats[BOT_SEAT]?.score ?? 0;
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: color.bgBase }]}>
      <View style={[styles.content, { padding: space[5], gap: space[4] }]}>
        <Text
          testID="summary.result"
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          style={[type.display, styles.centre, { color: color.textPrimary }]}
        >
          {t(TITLE[outcome])}
        </Text>
        <Text style={[type.bodyL, styles.centre, { color: color.textMuted }]}>
          {t(SUBTITLE[outcome])}
        </Text>
        <View style={[styles.scores, { gap: space[6] }]}>
          <View style={styles.centre}>
            <Text style={[type.caption, { color: color.textMuted }]}>{t('match.you')}</Text>
            <Text
              testID="summary.score.you"
              style={[type.title, styles.score, { color: color.textPrimary }]}
            >
              {you}
            </Text>
          </View>
          <View style={styles.centre}>
            <Text style={[type.caption, { color: color.textMuted }]}>{botName}</Text>
            <Text
              testID="summary.score.bot"
              style={[type.title, styles.score, { color: color.textPrimary }]}
            >
              {them}
            </Text>
          </View>
        </View>
        {reason !== null && (
          <Text
            testID="summary.reason"
            style={[type.body, styles.centre, { color: color.textMuted }]}
          >
            {t(reason.key, { ...reason.params, bot: botName })}
          </Text>
        )}
      </View>
      <View style={[styles.actions, { padding: space[5], gap: space[3] }]}>
        <Button
          testID="summary.playAgain"
          variant="primary"
          label={t('summary.play_again')}
          onPress={onPlayAgain}
        />
        <Button testID="summary.home" label={t('summary.home')} onPress={onHome} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, justifyContent: 'center' },
  centre: { alignItems: 'center', textAlign: 'center' },
  scores: { flexDirection: 'row', justifyContent: 'center' },
  score: { fontFamily: MONO, fontVariant: ['tabular-nums'] },
  actions: { alignSelf: 'stretch' },
});
