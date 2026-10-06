import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BOARD_COLOR_ROLES } from './board-tokens.js';
import { getTokens } from './tokens.js';
import { boardTokenFiles, serializeTokenFile } from './tokens-json.js';

const TOKENS_DIR = fileURLToPath(new URL('../tokens/', import.meta.url));

describe('board token JSON export (E-1.4 §1.1, for web)', () => {
  it('the committed tokens/*.json equal the TypeScript source byte for byte', () => {
    const files = boardTokenFiles();
    expect(readdirSync(TOKENS_DIR).sort()).toEqual(Object.keys(files).sort());
    for (const [name, document] of Object.entries(files)) {
      // Fix a drift with `pnpm --filter @codelex/design-system tokens:write` (after build).
      expect(readFileSync(`${TOKENS_DIR}${name}`, 'utf8')).toBe(serializeTokenFile(document));
    }
  });

  it('carries every board colour role per scheme as a DTCG colour', () => {
    const files = boardTokenFiles();
    for (const scheme of ['dark', 'light'] as const) {
      const document = files[`board.${scheme}.json`];
      const tokens = getTokens(scheme);
      for (const role of BOARD_COLOR_ROLES) {
        expect(document.board[role]).toEqual({ $type: 'color', $value: tokens.board[role] });
      }
      expect(document.overlay.scrim).toEqual({ $type: 'color', $value: tokens.overlay.scrim });
      expect(document.overlay.scrimOpacity).toEqual({
        $type: 'number',
        $value: tokens.overlay.scrimOpacity,
      });
    }
  });

  it('carries the scheme-independent motion, layout and radius tokens once', () => {
    const shared = boardTokenFiles()['board.shared.json'];
    const { motion, layout, radius } = getTokens('dark');
    expect(shared.motion.duration.scorePop).toEqual({
      $type: 'duration',
      $value: `${String(motion.duration.scorePop)}ms`,
    });
    expect(shared.motion.springTile.stiffness).toEqual({
      $type: 'number',
      $value: motion.springTile.stiffness,
    });
    expect(shared.layout.focusZoom).toEqual({ $type: 'number', $value: layout.focusZoom });
    expect(shared.layout.touchMin).toEqual({ $type: 'dimension', $value: '48px' });
    expect(shared.radius.chip).toEqual({ $type: 'dimension', $value: `${String(radius.chip)}px` });
  });

  it('serializes with two-space indentation and a final newline', () => {
    expect(serializeTokenFile({ a: { $type: 'number', $value: 1 } })).toBe(
      '{\n  "a": {\n    "$type": "number",\n    "$value": 1\n  }\n}\n',
    );
  });
});
