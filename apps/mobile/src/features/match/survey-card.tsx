import type { MessageKey } from '@codelex/i18n';
import { useEffect, useRef, useState, type JSX } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePlaytestAnalytics } from '../../analytics/analytics-provider';
import type { SurveyAnswer } from '../../analytics/recorder';
import { useFlag } from '../../config/flags-provider';
import { useI18n } from '../../i18n/i18n-provider';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';

/** Design §5.6: "Thanks!" stays 1.5 s, then the card collapses. */
export const SURVEY_THANKS_MS = 1500;

/** The dismiss control's glyph (an icon, not copy; its label is `survey.dismiss.a11y`). */
const DISMISS_GLYPH = '✕';

const ANSWERS: readonly {
  readonly answer: Exclude<SurveyAnswer, 'dismissed'>;
  readonly label: MessageKey;
}[] = [
  { answer: 'yes', label: 'survey.yes' },
  { answer: 'maybe', label: 'survey.maybe' },
  { answer: 'no', label: 'survey.no' },
];

type Phase = 'asking' | 'thanks' | 'gone';

/**
 * "Would you play CODELEX again?" on the Summary (E-1.5 AC-18, design §5.6; slice S6b), behind
 * `playtest.survey.enabled`. Whether it is due (1st and 3rd completed match, at most twice per install) is the
 * recorder's (`survey.ts`); it is asked once, when the Summary mounts, and only while recording is on, so an answer is
 * never asked for when it could not be kept. Inline in the scroll, never a modal: Play again in the sticky bar stays
 * one tap away and ignoring the card is fine. Screen readers get a labelled group whose answers are ordinary
 * buttons; the thanks line is announced once. No animation: it collapses at once (nothing to reduce for reduced
 * motion).
 */
export function SurveyCard(): JSX.Element | null {
  const enabled = useFlag('playtest.survey.enabled');
  const analytics = usePlaytestAnalytics();
  const { t } = useI18n();
  const { color, layout, radius, space, type } = useTokens();
  // Read once per Summary: the same match never shows the card twice. A synchronous read on the first render is fine:
  // `surveyDue()` only reads the tiny counters file (cached in memory after the first read), never the event queue.
  const [matches] = useState(() => (enabled && analytics !== null ? analytics.surveyDue() : null));
  const [phase, setPhase] = useState<Phase>('asking');
  // One answer per showing: a double tap, or two answers in the same frame, lands before the re-render hides them.
  const answered = useRef(false);

  useEffect(() => {
    // Idempotent: a second call for the same completion records nothing (Strict Mode effects run twice).
    if (matches !== null) analytics?.markSurveyShown();
  }, [analytics, matches]);

  const thanks = t('survey.thanks');
  useEffect(() => {
    if (phase !== 'thanks') return;
    AccessibilityInfo.announceForAccessibility(thanks);
    const timer = setTimeout(() => {
      setPhase('gone');
    }, SURVEY_THANKS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [phase, thanks]);

  if (matches === null || analytics === null || phase === 'gone') return null;

  const answer = (value: SurveyAnswer): void => {
    if (answered.current) return;
    answered.current = true;
    analytics.answerSurvey(value, matches);
    setPhase(value === 'dismissed' ? 'gone' : 'thanks');
  };
  const question = t('survey.play_again');
  return (
    <View
      testID="summary.survey"
      role="group"
      accessibilityLabel={question}
      style={[
        styles.card,
        {
          borderRadius: radius.card,
          borderColor: color.borderSubtle,
          backgroundColor: color.bgSurface,
          padding: space[4],
          gap: space[3],
        },
      ]}
    >
      {phase === 'thanks' ? (
        // Announced once by the effect above (iOS and Android alike); a live region on top would make TalkBack
        // say it twice.
        <Text testID="summary.survey.thanks" style={[type.body, { color: color.textPrimary }]}>
          {thanks}
        </Text>
      ) : (
        <>
          <View style={[styles.row, { gap: space[2] }]}>
            <Text style={[type.heading, styles.question, { color: color.textPrimary }]}>
              {question}
            </Text>
            <Pressable
              testID="summary.survey.dismiss"
              accessibilityRole="button"
              accessibilityLabel={t('survey.dismiss.a11y')}
              hitSlop={space[2]}
              onPress={() => {
                answer('dismissed');
              }}
              style={({ pressed }) => [
                styles.dismiss,
                {
                  minWidth: layout.touchMin,
                  minHeight: layout.touchMin,
                  borderRadius: radius.chip,
                },
                pressed && { backgroundColor: color.bgRaised },
              ]}
            >
              <Text style={[type.body, { color: color.textMuted }]}>{DISMISS_GLYPH}</Text>
            </Pressable>
          </View>
          <View style={[styles.answers, { gap: space[2] }]}>
            {ANSWERS.map(({ answer: value, label }) => (
              <Button
                key={value}
                testID={`summary.survey.${value}`}
                label={t(label)}
                onPress={() => {
                  answer(value);
                }}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  question: { flex: 1 },
  dismiss: { alignItems: 'center', justifyContent: 'center' },
  answers: { flexDirection: 'row', flexWrap: 'wrap' },
});
