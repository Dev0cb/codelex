import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnalyticsProvider, InteractiveMark } from '../analytics/analytics-provider';
import { I18nProvider } from '../i18n/i18n-provider';
import { createBundledLexiconSource } from '../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../lexicon/lexicon-gate';
import { MatchSessionProvider } from '../match/match-session';
import { MotionPreferenceProvider } from '../settings/motion-preference';
import { ShareSweep } from '../sharing/share-provider';

const styles = StyleSheet.create({ root: { flex: 1 } });

/** The `.clxi` bundled by `prepare:lexicon`; loaded once per process behind the gate. */
const bundledLexicon = createBundledLexiconSource();

/**
 * Root layout: gesture root (board drag later), the playtest recorder (outermost, so the session marker is written
 * at launch, before anything that could crash at boot; slice S6a), the Settings motion choice, i18n, then the lexicon
 * gate: no route mounts until the lexicon index is loaded and verified (never partial play), then the match session
 * (one saved match, slice S3) and a header-less stack. `InteractiveMark` ends the cold start for `app_opened`;
 * `ShareSweep` deletes the share directory a killed process may have left (TM-04, slice S6c) after the first commit.
 */
export function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <AnalyticsProvider>
        <MotionPreferenceProvider>
          <I18nProvider>
            <LexiconGate source={bundledLexicon}>
              <MatchSessionProvider>
                <Stack screenOptions={{ headerShown: false }} />
                <InteractiveMark />
              </MatchSessionProvider>
            </LexiconGate>
            <StatusBar style="auto" />
            <ShareSweep />
          </I18nProvider>
        </MotionPreferenceProvider>
      </AnalyticsProvider>
    </GestureHandlerRootView>
  );
}

// Expo Router route file: the framework requires a default export (ENGINEERING §1).
export default RootLayout;
