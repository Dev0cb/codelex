import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { JSX } from 'react';
import { Text } from 'react-native';

import { I18nProvider } from '../i18n/i18n-provider';
import { createBundledLexiconSource } from './bundled-lexicon-source';
import { LexiconGate, useLexicon } from './lexicon-gate';
import type { LexiconSource } from './load-lexicon';

jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

function Probe(): JSX.Element {
  const { index } = useLexicon();
  return <Text testID="probe">{index.version}</Text>;
}

/** A fresh source object per test: the gate caches successful loads per source. */
function freshSource(overrides: Partial<LexiconSource> = {}): LexiconSource {
  return { ...createBundledLexiconSource(), ...overrides };
}

const renderGate = (source: LexiconSource, locale: 'en' | 'fr' = 'en') =>
  render(
    <I18nProvider locale={locale}>
      <LexiconGate source={source}>
        <Probe />
      </LexiconGate>
    </I18nProvider>,
  );

describe('LexiconGate', () => {
  it('shows the splash, then mounts its children with the verified index', async () => {
    const bytes = await createBundledLexiconSource().readBytes();
    let finish: (value: Uint8Array) => void = () => undefined;
    const pending = new Promise<Uint8Array>((resolve) => {
      finish = resolve;
    });
    await renderGate(freshSource({ readBytes: () => pending }));
    expect(screen.getByText('Preparing the lexicon…')).toBeTruthy();
    expect(screen.queryByTestId('probe')).toBeNull();
    await act(async () => {
      finish(bytes);
      await pending;
    });
    const probe = await screen.findByTestId('probe');
    expect(probe.props.children).toMatch(/^[0-9a-f]{16}$/);
  });

  it('shows the E-1.5 §5.10.1 error state with the code and never mounts the children', async () => {
    await renderGate(freshSource({ descriptor: { lexiconVersion: 'nope' } }));
    expect(await screen.findByTestId('lexicon-error')).toBeTruthy();
    expect(screen.getByRole('header').props.children).toBe('We could not load the CODELEX lexicon');
    expect(
      screen.getByText('Restart the app. If it keeps happening, reinstall the app.'),
    ).toBeTruthy();
    expect(screen.getByTestId('lexicon-error-code').props.children).toBe(
      'Error code: LEXICON_INDEX_MISSING',
    );
    expect(screen.queryByTestId('probe')).toBeNull();
  });

  it('renders the error state in French', async () => {
    const real = createBundledLexiconSource();
    await renderGate(
      freshSource({ readBytes: async () => (await real.readBytes()).subarray(1) }),
      'fr',
    );
    expect(await screen.findByTestId('lexicon-error')).toBeTruthy();
    expect(screen.getByTestId('lexicon-error-code').props.children).toBe(
      "Code d'erreur\u00a0: LEXICON_INDEX_CORRUPT",
    );
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('"Try again" re-runs the load once and recovers', async () => {
    const real = createBundledLexiconSource();
    const readBytes = jest
      .fn<LexiconSource['readBytes']>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockImplementation(() => real.readBytes());
    await renderGate(freshSource({ readBytes }));
    const retry = await screen.findByRole('button', { name: 'Try again' });
    await fireEvent.press(retry);
    expect(await screen.findByTestId('probe')).toBeTruthy();
    expect(readBytes).toHaveBeenCalledTimes(2);
  });

  it('loads a source once per process, even across gates', async () => {
    const real = createBundledLexiconSource();
    const readBytes = jest.fn<LexiconSource['readBytes']>(() => real.readBytes());
    const source = freshSource({ readBytes });
    const first = await renderGate(source);
    await screen.findByTestId('probe');
    await first.unmount();
    await renderGate(source);
    expect(await screen.findByTestId('probe')).toBeTruthy();
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('ignores a load that completes after unmount', async () => {
    let finish: (bytes: Uint8Array) => void = () => undefined;
    const readBytes = jest.fn<LexiconSource['readBytes']>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await renderGate(freshSource({ readBytes }));
    await view.unmount();
    const bytes = await createBundledLexiconSource().readBytes();
    await act(async () => {
      finish(bytes);
      await Promise.resolve();
    });
    expect(readBytes).toHaveBeenCalledTimes(1);
  });

  it('useLexicon outside the gate is a programming error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow('useLexicon must be used inside <LexiconGate>');
  });
});
