import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { I18nProvider } from '../i18n/i18n-provider';
import { createBundledLexiconSource } from '../lexicon/bundled-lexicon-source';
import { LexiconGate } from '../lexicon/lexicon-gate';

const styles = StyleSheet.create({ root: { flex: 1 } });

/** The `.clxi` bundled by `prepare:lexicon`; loaded once per process behind the gate. */
const bundledLexicon = createBundledLexiconSource();

/**
 * Root layout: gesture root (board drag later), i18n, then the lexicon gate: no route mounts until the lexicon index
 * is loaded and verified (never partial play), then a header-less stack.
 */
export function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <I18nProvider>
        <LexiconGate source={bundledLexicon}>
          <Stack screenOptions={{ headerShown: false }} />
        </LexiconGate>
        <StatusBar style="auto" />
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

// Expo Router route file: the framework requires a default export (ENGINEERING §1).
export default RootLayout;
