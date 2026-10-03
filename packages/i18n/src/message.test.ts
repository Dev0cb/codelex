import { describe, expect, it } from 'vitest';

import type { Locale } from './locale.js';
import { argumentNames, formatMessage, parseMessage, type MessageParams } from './message.js';

function format(src: string, params: MessageParams = {}, locale: Locale = 'en'): string {
  const parsed = parseMessage(src);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const out = formatMessage(parsed.value, locale, params);
  if (!out.ok) throw new Error(out.error.code);
  return out.value;
}

function parseError(src: string): string {
  const parsed = parseMessage(src);
  return parsed.ok ? 'ok' : parsed.error.code;
}

const POINTS = '{n, plural, one {# point} other {# points}}';

describe('parseMessage / formatMessage', () => {
  it('formats plain text and simple arguments', () => {
    expect(format('Hello')).toBe('Hello');
    expect(format('')).toBe('');
    expect(format('Hi {name}!', { name: 'Ada' })).toBe('Hi Ada!');
    expect(format('{ name }', { name: 'Ada' })).toBe('Ada');
  });

  it('formats numbers with the locale', () => {
    expect(format('{n}', { n: 1234 })).toBe('1,234');
    expect(format('{n, number}', { n: 1234 }, 'fr')).toBe('1 234');
  });

  it('selects English plural forms', () => {
    expect(format(POINTS, { n: 0 })).toBe('0 points');
    expect(format(POINTS, { n: 1 })).toBe('1 point');
    expect(format(POINTS, { n: 2 })).toBe('2 points');
  });

  it('selects French plural forms: 0 and 1 are singular, many falls back to other', () => {
    expect(format(POINTS, { n: 0 }, 'fr')).toBe('0 point');
    expect(format(POINTS, { n: 1 }, 'fr')).toBe('1 point');
    expect(format(POINTS, { n: 2 }, 'fr')).toBe('2 points');
    expect(format(POINTS, { n: 1_000_000 }, 'fr')).toBe('1 000 000 points');
    const many = '{n, plural, one {# mot} many {# de mots} other {# mots}}';
    expect(format(many, { n: 1_000_000 }, 'fr')).toBe('1 000 000 de mots');
  });

  it('prefers exact matches over categories', () => {
    const src = '{n, plural, =0 {none} one {# item} other {# items}}';
    expect(format(src, { n: 0 })).toBe('none');
    expect(format(src, { n: 1 })).toBe('1 item');
  });

  it('formats select, with # bound to the enclosing plural', () => {
    const src = '{n, plural, other {{who, select, you {you have #} other {{who} has #}}}}';
    expect(format(src, { n: 3, who: 'you' })).toBe('you have 3');
    expect(format(src, { n: 3, who: 'Bot' })).toBe('Bot has 3');
    expect(format('{x, select, a {A} other {#}}', { x: 'z' })).toBe('#');
  });

  it('keeps # literal outside plurals', () => {
    expect(format('# {n}', { n: 1 })).toBe('# 1');
  });

  it('applies ICU apostrophe quoting', () => {
    expect(format("l'app")).toBe("l'app");
    expect(format("it''s")).toBe("it's");
    expect(format("'{literal}'")).toBe('{literal}');
    expect(format("'{it''s}'")).toBe("{it's}");
    expect(format("{n, plural, other {'#' #}}", { n: 2 })).toBe('# 2');
    expect(format("'}'")).toBe('}');
  });

  it('rejects malformed messages', () => {
    expect(parseError('{')).toBe('SYNTAX');
    expect(parseError('}')).toBe('SYNTAX');
    expect(parseError('{1}')).toBe('SYNTAX');
    expect(parseError('{a b}')).toBe('SYNTAX');
    expect(parseError("'{")).toBe('SYNTAX');
    expect(parseError('{n, plural, one {x}}')).toBe('SYNTAX');
    expect(parseError('{n, plural, some {x} other {y}}')).toBe('SYNTAX');
    expect(parseError('{n, plural, one {x} one {y} other {z}}')).toBe('SYNTAX');
    expect(parseError('{n, plural, one x other {y}}')).toBe('SYNTAX');
    expect(parseError('{n, plural, other {y}')).toBe('SYNTAX');
    expect(parseError('{s, select, a {x}}')).toBe('SYNTAX');
    expect(parseError('{s, select a {x}}')).toBe('SYNTAX');
    expect(parseError('{n, plural, , {x}}')).toBe('SYNTAX');
  });

  it('rejects unsupported ICU features', () => {
    expect(parseError('{d, date}')).toBe('UNSUPPORTED');
    expect(parseError('{n, number, percent}')).toBe('UNSUPPORTED');
    expect(parseError('{n, plural, offset:1 other {#}}')).toBe('UNSUPPORTED');
    expect(parseError('{n, selectordinal, other {#}}')).toBe('UNSUPPORTED');
  });

  it('reports missing and ill-typed parameters', () => {
    const run = (src: string, params: MessageParams): string => {
      const parsed = parseMessage(src);
      if (!parsed.ok) throw new Error('parse');
      const out = formatMessage(parsed.value, 'en', params);
      return out.ok ? out.value : out.error.code;
    };
    expect(run('{a}', {})).toBe('MISSING_PARAM');
    expect(run('x {a} y', {})).toBe('MISSING_PARAM');
    expect(run('{a, number}', { a: 'one' })).toBe('BAD_PARAM_TYPE');
    expect(run('{a, number}', {})).toBe('MISSING_PARAM');
    expect(run(POINTS, { n: 'two' })).toBe('BAD_PARAM_TYPE');
    expect(run(POINTS, { n: Number.NaN })).toBe('BAD_PARAM_TYPE');
    expect(run('{s, select, other {x}}', {})).toBe('MISSING_PARAM');
    expect(run('{n, plural, other {{a}}}', { n: 1 })).toBe('MISSING_PARAM');
    // Prototype keys are not parameters.
    expect(run('{toString}', {})).toBe('MISSING_PARAM');
  });

  it('lists argument names, sorted and deduplicated', () => {
    const parsed = parseMessage(
      '{b} {a, number} {n, plural, =0 {{c}} one {{a}} other {{s, select, x {{d}} other {}}}}',
    );
    if (!parsed.ok) throw new Error('parse');
    expect(argumentNames(parsed.value)).toEqual(['a', 'b', 'c', 'd', 'n', 's']);
  });
});
