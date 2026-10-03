import { describe, expect, it, jest } from '@jest/globals';
import { render, renderHook, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

import { I18nProvider, useI18n } from './i18n-provider';

jest.mock('expo-localization', () => ({
  useLocales: () => [{ languageTag: 'fr-CA' }, { languageTag: 'en-US' }],
}));

function Probe(): ReactNode {
  const { t, locale } = useI18n();
  return <Text>{`${locale}:${t('app.name')}`}</Text>;
}

describe('I18nProvider', () => {
  it('follows the device locale list', async () => {
    await render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('fr:CODELEX')).toBeTruthy();
  });

  it('warns in development on a formatting error instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useI18n(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <I18nProvider locale="en">{children}</I18nProvider>
      ),
    });
    expect(result.current.t('home.engine_version')).toBe('home.engine_version');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('fails loudly when used outside the provider', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderHook(() => useI18n())).rejects.toThrow(/I18nProvider/);
    error.mockRestore();
  });
});
