import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../i18n/i18n-provider';
import { useTokens } from '../../theme/use-tokens';
import { Button } from '../../ui/button';

export interface ExportPromptCardProps {
  /** Matches completed this session (`export.prompt.body`). */
  readonly matches: number;
  /** "Review and send": opens Send playtest data. */
  readonly onSend: () => void;
  /** "Not now". */
  readonly onLater: () => void;
}

/**
 * End-of-session export prompt (E-1.5 AC-17, design D-17; slice S6c): a dismissible card on Home, never a dialog,
 * never on Match or Summary, and below PLAY NOW so it never blocks it. When it is due is `export-prompt.ts`. No
 * animation: it appears with the screen (nothing to reduce).
 */
export function ExportPromptCard({ matches, onSend, onLater }: ExportPromptCardProps): JSX.Element {
  const { t } = useI18n();
  const { color, radius, space, type } = useTokens();
  return (
    <View
      testID="home.exportPrompt"
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
      <Text accessibilityRole="header" style={[type.heading, { color: color.textPrimary }]}>
        {t('export.prompt.title')}
      </Text>
      <Text style={[type.body, { color: color.textPrimary }]}>
        {t('export.prompt.body', { matches })}
      </Text>
      <View style={[styles.actions, { gap: space[3] }]}>
        <Button
          testID="home.exportPrompt.later"
          label={t('export.prompt.later')}
          onPress={onLater}
        />
        {/* Secondary on purpose: PLAY NOW stays the one primary action on Home (§5.2). */}
        <Button testID="home.exportPrompt.send" label={t('export.prompt.send')} onPress={onSend} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, alignSelf: 'stretch' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' },
});
