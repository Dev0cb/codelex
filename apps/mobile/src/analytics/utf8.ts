/**
 * UTF-8 byte length of a string without `TextEncoder` (not guaranteed on Hermes). Shared by the D1 export contracts
 * (`export/common.ts`, Node side) and the zod-free on-device file builder (`playtest-file.ts`), so both size a file
 * the same way. No imports: plain Node loads it through `export/common.ts`.
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}
