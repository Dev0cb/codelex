import { err, ok, type Result } from '@codelex/config/result';

import { i18nError, type I18nError } from './errors.js';
import type { Locale } from './locale.js';
import { isPluralCategory, pluralCategory, type PluralCategory } from './plural.js';

/**
 * ICU MessageFormat subset (docs/architecture/notes/mobile-app-foundation.md §4):
 * `{arg}`, `{arg, number}`, `{arg, plural, =N {…} one {…} other {…}}` with `#`, `{arg, select, a {…} other {…}}`,
 * apostrophe quoting (`''` → `'`, `'{…}'` → literal). Anything else is rejected at parse time (`UNSUPPORTED`),
 * so a catalog that passes `checkCatalogs()` always formats.
 */
export type MessagePart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'arg'; readonly name: string }
  | { readonly kind: 'number'; readonly name: string }
  | { readonly kind: 'pound' }
  | {
      readonly kind: 'plural';
      readonly name: string;
      readonly exact: ReadonlyMap<number, Message>;
      readonly categories: ReadonlyMap<PluralCategory, Message>;
      readonly other: Message;
    }
  | {
      readonly kind: 'select';
      readonly name: string;
      readonly cases: ReadonlyMap<string, Message>;
      readonly other: Message;
    };
export type Message = readonly MessagePart[];

export type ParamValue = string | number;
export type MessageParams = Readonly<Record<string, ParamValue>>;

/** Internal control flow of the parser; never escapes `parseMessage`. */
class ParseFailure extends Error {
  constructor(readonly error: I18nError) {
    super(error.message);
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;
const SELECTOR = /^(=\d+|[A-Za-z_][A-Za-z0-9_-]*)/;

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  parse(): Message {
    const message = this.message(false);
    if (this.pos < this.src.length) this.fail('SYNTAX', "unmatched '}'");
    return message;
  }

  private fail(code: 'SYNTAX' | 'UNSUPPORTED', message: string): never {
    throw new ParseFailure(i18nError(code, message, { offset: this.pos }));
  }

  private peek(): string | undefined {
    return this.src[this.pos];
  }

  private skipSpaces(): void {
    while (/\s/.test(this.peek() ?? '')) this.pos++;
  }

  private expect(char: string): void {
    if (this.peek() !== char) this.fail('SYNTAX', `expected '${char}'`);
    this.pos++;
  }

  private match(re: RegExp, what: string): string {
    const m = re.exec(this.src.slice(this.pos));
    if (!m) this.fail('SYNTAX', `expected ${what}`);
    this.pos += m[0].length;
    return m[0];
  }

  /** Parses until an unquoted `}` (left in place) or the end of input. */
  private message(inPlural: boolean): Message {
    const parts: MessagePart[] = [];
    let text = '';
    const flush = (): void => {
      if (text !== '') parts.push({ kind: 'text', value: text });
      text = '';
    };
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === '}') break;
      if (c === "'") {
        text += this.apostrophe(inPlural);
      } else if (c === '{') {
        flush();
        parts.push(this.argument(inPlural));
      } else if (c === '#' && inPlural) {
        flush();
        this.pos++;
        parts.push({ kind: 'pound' });
      } else {
        text += c;
        this.pos++;
      }
    }
    flush();
    return parts;
  }

  private apostrophe(inPlural: boolean): string {
    const next = this.src[this.pos + 1];
    if (next === "'") {
      this.pos += 2;
      return "'";
    }
    if (next !== '{' && next !== '}' && !(next === '#' && inPlural)) {
      this.pos++;
      return "'";
    }
    // Quoted literal: up to the next lone apostrophe ('' inside stays an apostrophe).
    this.pos++;
    let literal = '';
    for (;;) {
      const c = this.peek();
      if (c === undefined) this.fail('SYNTAX', 'unterminated quoted literal');
      this.pos++;
      if (c !== "'") literal += c;
      else if (this.peek() === "'") {
        literal += "'";
        this.pos++;
      } else return literal;
    }
  }

  private argument(inPlural: boolean): MessagePart {
    this.expect('{');
    this.skipSpaces();
    const name = this.match(IDENTIFIER, 'an argument name');
    this.skipSpaces();
    if (this.peek() === '}') {
      this.pos++;
      return { kind: 'arg', name };
    }
    this.expect(',');
    this.skipSpaces();
    const type = this.match(IDENTIFIER, 'an argument type');
    this.skipSpaces();
    switch (type) {
      case 'number':
        if (this.peek() !== '}') this.fail('UNSUPPORTED', 'number styles are not supported');
        this.pos++;
        return { kind: 'number', name };
      case 'plural':
        return this.plural(name);
      case 'select':
        return this.select(name, inPlural);
      default:
        return this.fail('UNSUPPORTED', `argument type '${type}' is not supported`);
    }
  }

  /** Reads `selector {message}` pairs up to and including the closing `}` of the argument. */
  private cases(inPlural: boolean): Map<string, Message> {
    this.expect(',');
    const cases = new Map<string, Message>();
    for (;;) {
      this.skipSpaces();
      if (this.peek() === '}') {
        this.pos++;
        return cases;
      }
      const selector = this.match(SELECTOR, 'a selector');
      if (cases.has(selector)) this.fail('SYNTAX', `duplicate selector '${selector}'`);
      this.skipSpaces();
      this.expect('{');
      cases.set(selector, this.message(inPlural));
      this.expect('}');
    }
  }

  private plural(name: string): MessagePart {
    if (this.src.startsWith(', offset:', this.pos))
      this.fail('UNSUPPORTED', 'plural offset is not supported');
    const exact = new Map<number, Message>();
    const categories = new Map<PluralCategory, Message>();
    for (const [selector, message] of this.cases(true)) {
      if (selector.startsWith('=')) exact.set(Number(selector.slice(1)), message);
      else if (isPluralCategory(selector)) categories.set(selector, message);
      else this.fail('SYNTAX', `unknown plural category '${selector}'`);
    }
    const other = categories.get('other');
    if (other === undefined) return this.fail('SYNTAX', "plural needs an 'other' case");
    return { kind: 'plural', name, exact, categories, other };
  }

  private select(name: string, inPlural: boolean): MessagePart {
    const cases = this.cases(inPlural);
    const other = cases.get('other');
    if (other === undefined) return this.fail('SYNTAX', "select needs an 'other' case");
    return { kind: 'select', name, cases, other };
  }
}

/** Parses one ICU message of the supported subset. */
export function parseMessage(src: string): Result<Message, I18nError> {
  try {
    return ok(new Parser(src).parse());
  } catch (e: unknown) {
    if (e instanceof ParseFailure) return err(e.error);
    throw e;
  }
}

/** Argument names a message reads, sorted (used to check that EN and FR messages take the same params). */
export function argumentNames(message: Message): string[] {
  const names = new Set<string>();
  const visit = (parts: Message): void => {
    for (const part of parts) {
      switch (part.kind) {
        case 'text':
        case 'pound':
          break;
        case 'arg':
        case 'number':
          names.add(part.name);
          break;
        case 'plural':
          names.add(part.name);
          for (const m of part.exact.values()) visit(m);
          for (const m of part.categories.values()) visit(m);
          break;
        case 'select':
          names.add(part.name);
          for (const m of part.cases.values()) visit(m);
          break;
      }
    }
  };
  visit(message);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const numberFormats = new Map<Locale, Intl.NumberFormat>();

/** Locale number formatting (`Intl.NumberFormat` is available on Hermes, unlike `Intl.PluralRules`). */
export function formatNumber(locale: Locale, n: number): string {
  let format = numberFormats.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(n);
}

/** Formats a parsed message. Fails (never throws) on a missing or ill-typed parameter. */
export function formatMessage(
  message: Message,
  locale: Locale,
  params: MessageParams,
): Result<string, I18nError> {
  const param = (name: string): Result<ParamValue, I18nError> => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    return value === undefined
      ? err(i18nError('MISSING_PARAM', `missing parameter '${name}'`, { param: name }))
      : ok(value);
  };
  const numeric = (name: string): Result<number, I18nError> => {
    const value = param(name);
    if (!value.ok) return value;
    return typeof value.value === 'number' && Number.isFinite(value.value)
      ? ok(value.value)
      : err(
          i18nError('BAD_PARAM_TYPE', `parameter '${name}' must be a finite number`, {
            param: name,
          }),
        );
  };
  const render = (parts: Message, pound: number | undefined): Result<string, I18nError> => {
    let out = '';
    for (const part of parts) {
      let piece: Result<string, I18nError>;
      switch (part.kind) {
        case 'text':
          piece = ok(part.value);
          break;
        case 'pound':
          piece = ok(pound === undefined ? '#' : formatNumber(locale, pound));
          break;
        case 'arg': {
          const value = param(part.name);
          piece = !value.ok
            ? value
            : ok(typeof value.value === 'number' ? formatNumber(locale, value.value) : value.value);
          break;
        }
        case 'number': {
          const value = numeric(part.name);
          piece = value.ok ? ok(formatNumber(locale, value.value)) : value;
          break;
        }
        case 'plural': {
          const value = numeric(part.name);
          if (!value.ok) return value;
          const branch =
            part.exact.get(value.value) ??
            part.categories.get(pluralCategory(locale, value.value)) ??
            part.other;
          piece = render(branch, value.value);
          break;
        }
        case 'select': {
          const value = param(part.name);
          if (!value.ok) return value;
          piece = render(part.cases.get(String(value.value)) ?? part.other, pound);
          break;
        }
      }
      if (!piece.ok) return piece;
      out += piece.value;
    }
    return ok(out);
  };
  return render(message, undefined);
}
