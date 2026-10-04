import { createContext, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n/i18n-provider';
import { useTokens } from '../theme/use-tokens';
import { LexiconErrorScreen } from './lexicon-error-screen';
import {
  loadLexicon,
  type LexiconLoadError,
  type LexiconLoadResult,
  type LexiconSource,
  type LoadedLexicon,
} from './load-lexicon';

const LexiconContext = createContext<LoadedLexicon | null>(null);

/** Successful loads are kept for the process (load once); failures are not, so "Try again" re-runs the load. */
const loaded = new WeakMap<LexiconSource, Promise<LexiconLoadResult>>();

function loadOnce(source: LexiconSource): Promise<LexiconLoadResult> {
  const cached = loaded.get(source);
  if (cached !== undefined) return cached;
  const pending = loadLexicon(source).then((result) => {
    if (!result.ok) loaded.delete(source);
    return result;
  });
  loaded.set(source, pending);
  return pending;
}

type GateState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly lexicon: LoadedLexicon }
  | { readonly status: 'failed'; readonly error: LexiconLoadError };

export interface LexiconGateProps {
  readonly source: LexiconSource;
  readonly children: ReactNode;
}

/**
 * Mounts its children only once the lexicon index is loaded and verified (lexicon-index note §3.5). While loading:
 * the splash copy; on any failure: the E-1.5 §5.10.1 full-screen state, never partial play.
 */
export function LexiconGate({ source, children }: LexiconGateProps): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GateState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void loadOnce(source).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { status: 'ready', lexicon: result.value }
          : { status: 'failed', error: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [source, attempt]);

  if (state.status === 'ready') {
    return <LexiconContext value={state.lexicon}>{children}</LexiconContext>;
  }
  if (state.status === 'failed') {
    return (
      <LexiconErrorScreen
        code={state.error.code}
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return <LexiconSplash />;
}

function LexiconSplash(): JSX.Element {
  const { t } = useI18n();
  const { color, space, type } = useTokens();
  return (
    <View
      testID="lexicon-loading"
      style={[styles.splash, { backgroundColor: color.bgBase, padding: space[5] }]}
    >
      <Text accessibilityRole="progressbar" style={[type.bodyL, { color: color.textMuted }]}>
        {t('splash.loading')}
      </Text>
    </View>
  );
}

/** The loaded, verified lexicon. Only valid under {@link LexiconGate}. */
export function useLexicon(): LoadedLexicon {
  const lexicon = useContext(LexiconContext);
  if (lexicon === null) throw new Error('useLexicon must be used inside <LexiconGate>');
  return lexicon;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
