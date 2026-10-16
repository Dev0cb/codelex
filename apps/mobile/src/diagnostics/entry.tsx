/**
 * Entry of the preview-only Diagnostics screen (DG1; docs/architecture/notes/diagnostics-screen.md). Imported
 * **only** by the build-time gate in `features/settings/settings-screen.tsx`, inside a branch that Metro removes
 * when `EXPO_PUBLIC_CODELEX_DIAGNOSTICS` is not `1` (note §3): production bundles contain neither this module nor
 * anything it imports. No route file and no deep link (DS-3): the screen is a full-screen `Modal`.
 *
 * `DiagnosticsEntry` wraps the Settings versions row: 7 taps, each within 1 s of the previous, open the modal
 * (note §4). The row has no role and no hint (a hidden developer affordance); TalkBack's double-tap counts as a tap.
 */
import { GOLDEN_CORPUS } from '@codelex/golden-runner/core';
import Constants from 'expo-constants';
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { APP_VERSION } from '../config/build-info';
import { useLexicon } from '../lexicon/lexicon-gate';
import { useShare } from '../sharing/share-provider';
import { asciiField, deviceFields, gitShaOf, runtimeCheck } from './device-info';
import { DiagnosticsScreen } from './diagnostics-screen';
import { SETTLE_MS, yieldToUi } from './jobs/job';
import { createScratchStore } from './scratch-fs';
import { createTapCounter } from './tap-gesture';
import type { DiagnosticsDeps } from './use-diagnostics';

/**
 * Marker of this module (note §3.3): used at runtime as the screen's root `testID`, so the minifier keeps it; the
 * production bundle check fails if it is in a shipped bundle, and the positive control requires it.
 */
export const DIAGNOSTICS_MARKER = 'CODELEX_DIAGNOSTICS_SCREEN_V1';

/** The globals the build check reads (note §2). */
declare const HermesInternal: { readonly getRuntimeProperties?: () => unknown } | undefined;

function DiagnosticsModalContent({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const { index } = useLexicon();
  const share = useShare();
  const deps = useMemo((): DiagnosticsDeps => {
    const store = createScratchStore();
    // A crash or kill during a run loses only memory; its scratch files are swept when the screen opens.
    store.clear();
    return {
      lexicon: index,
      clock: () => performance.now(),
      store,
      runtime: runtimeCheck(
        typeof HermesInternal === 'undefined' ? undefined : HermesInternal,
        __DEV__,
      ),
      yieldToUi,
      settle: () =>
        new Promise((resolve) => {
          setTimeout(resolve, SETTLE_MS);
        }),
    };
  }, [index]);
  return (
    <SafeAreaView testID={DIAGNOSTICS_MARKER} style={{ flex: 1 }}>
      <DiagnosticsScreen
        deps={deps}
        corpus={GOLDEN_CORPUS}
        device={deviceFields(Platform.OS, Platform.constants, Platform.Version)}
        appVersion={asciiField(APP_VERSION, 32)}
        gitSha={gitShaOf(Constants.expoConfig?.extra)}
        share={share}
        onClose={onClose}
      />
    </SafeAreaView>
  );
}

export function DiagnosticsEntry({ children }: { readonly children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [counter] = useState(() => createTapCounter(() => Date.now()));
  return (
    <View>
      <Pressable
        testID="settings.about.versions.entry"
        onPress={() => {
          if (counter.tap()) setOpen(true);
        }}
      >
        {children}
      </Pressable>
      <Modal
        visible={open}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          setOpen(false);
        }}
      >
        {open ? (
          <DiagnosticsModalContent
            onClose={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}
