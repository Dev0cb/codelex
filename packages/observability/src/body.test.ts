import { describe, expect, it } from 'vitest';
import { summarizeBody } from './body.js';

describe('summarizeBody', () => {
  it('returns shape only, never content', () => {
    expect(summarizeBody(undefined)).toEqual({ kind: 'empty', size: 0 });
    expect(summarizeBody(null)).toEqual({ kind: 'empty', size: 0 });
    expect(summarizeBody('héllo')).toEqual({ kind: 'string', size: 6 });
    expect(summarizeBody(new Uint8Array(4))).toEqual({ kind: 'binary', size: 4 });
    expect(summarizeBody(new ArrayBuffer(3))).toEqual({ kind: 'binary', size: 3 });
    expect(summarizeBody([1, 2, 3])).toEqual({ kind: 'array', size: 3 });
    expect(summarizeBody({ password: 'x', a: 1 })).toEqual({ kind: 'object', size: 2 });
    expect(summarizeBody(42)).toEqual({ kind: 'other', size: 0 });
    expect(JSON.stringify(summarizeBody({ password: 'hunter2' }))).not.toContain('hunter2');
  });
});
