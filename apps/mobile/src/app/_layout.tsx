import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { I18nProvider } from '../i18n/i18n-provider';

const styles = StyleSheet.create({ root: { flex: 1 } });

/** Root layout: gesture root (board drag later), i18n, a header-less stack. */
export function RootLayout(): JSX.Element {
  return (
    <GestureHandlerRootView style={styles.root}>
      <I18nProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

// Expo Router route file: the framework requires a default export (ENGINEERING §1).
export default RootLayout;
