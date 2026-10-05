import { getTokens, resolveColorScheme, type Tokens } from '@codelex/design-system';
import { useColorScheme } from 'react-native';

const BY_SCHEME = { dark: getTokens('dark'), light: getTokens('light') } as const;

/**
 * Design tokens for the OS appearance (dark when unknown, E-1.4 §1.2). Components read tokens, never literals. One
 * object per scheme, so the identity is stable across renders and memoised children (the Skia board) hold.
 */
export function useTokens(): Tokens {
  return BY_SCHEME[resolveColorScheme(useColorScheme())];
}
