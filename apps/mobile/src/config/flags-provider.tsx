import { createContext, useContext, type JSX, type ReactNode } from 'react';

import { parseFlagOverrides, resolveFlags, type FlagKey, type Flags } from './flags';

/** Build-time overrides; Expo inlines `EXPO_PUBLIC_*` at bundle time (no runtime environment access). */
const BUILD_FLAGS: Flags = resolveFlags(parseFlagOverrides(process.env.EXPO_PUBLIC_CODELEX_FLAGS));

const FlagsContext = createContext<Flags>(BUILD_FLAGS);

export interface FlagsProviderProps {
  /**
   * Forces flag values (tests, previews) over the bundled defaults. Default: bundled defaults plus the build-time
   * overrides.
   */
  readonly flags?: Partial<Record<FlagKey, boolean>>;
  readonly children: ReactNode;
}

export function FlagsProvider({ flags, children }: FlagsProviderProps): JSX.Element {
  return (
    <FlagsContext value={flags === undefined ? BUILD_FLAGS : resolveFlags(flags)}>
      {children}
    </FlagsContext>
  );
}

/** The current value of a flag. */
export function useFlag(key: FlagKey): boolean {
  return useContext(FlagsContext)[key];
}
