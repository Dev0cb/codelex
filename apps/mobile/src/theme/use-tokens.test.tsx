import { describe, expect, it } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { useTokens } from './use-tokens';

describe('useTokens', () => {
  it('returns the same object across renders, so memoised children (the Skia board) do not rebuild', async () => {
    const { result, rerender } = await renderHook(() => useTokens());
    const first = result.current;
    await rerender({});
    expect(result.current).toBe(first);
  });
});
