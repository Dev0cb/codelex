import { getTokens, resolveColorScheme, type Tokens } from '@codelex/design-system';
import { useColorScheme } from 'react-native';

/** Design tokens for the OS appearance (dark when unknown, E-1.4 §1.2). Components read tokens, never literals. */
export function useTokens(): Tokens {
  return getTokens(resolveColorScheme(useColorScheme()));
}
