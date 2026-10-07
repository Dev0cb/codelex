/**
 * AC-17 schema check (sprint 4 D1): the zod schemas in `events.ts` are frozen against the catalogue
 * `docs/standards/ANALYTICS_EVENTS.md`. The test reads the markdown, parses the property types with the grammar of
 * its "Schema contract" paragraph and compares them with the JSON Schema that zod derives from each event. Any
 * difference in event names, versions, property names, types, bounds, enum values or required/optional fails.
 */
import { describe, expect, it } from '@jest/globals';
import { DIFFICULTIES, FORM_KINDS, RELATION_TYPES } from '@codelex/lexicon/index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toJSONSchema } from 'zod/mini';

import {
  BOT_PERSONALITIES,
  CANONICAL_ID_PATTERN,
  CATEGORY_IDS,
  COMPUTE_MS_BUCKETS,
  EVENT_SCHEMAS,
  NODES_USED_BUCKETS,
  STRING_ID_PATTERN,
  type EventName,
} from './events.ts';

const REPO_ROOT = join(__dirname, '../../../..');
const CATALOGUE = readFileSync(join(REPO_ROOT, 'docs/standards/ANALYTICS_EVENTS.md'), 'utf8');

// ---------------------------------------------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------------------------------------------

interface Row {
  readonly cells: readonly string[];
}
interface Table {
  readonly header: readonly string[];
  readonly rows: readonly Row[];
}

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** The markdown tables of `text`, in document order. */
function tables(text: string): Table[] {
  const out: Table[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const next = lines[i + 1] ?? '';
    if (!line.startsWith('|') || !/^\|[-| ]+\|$/.test(next.trim())) continue;
    const header = splitRow(line);
    const rows: Row[] = [];
    let j = i + 2;
    while ((lines[j] ?? '').startsWith('|')) {
      rows.push({ cells: splitRow(lines[j] ?? '') });
      j += 1;
    }
    out.push({ header, rows });
    i = j;
  }
  return out;
}

/** Text between a level-2 heading starting with `title` and the next level-2 heading. */
function section(title: string): string {
  const start = CATALOGUE.indexOf(`\n## ${title}`);
  if (start < 0) throw new Error(`section not found: ${title}`);
  const end = CATALOGUE.indexOf('\n## ', start + 1);
  return CATALOGUE.slice(start, end < 0 ? undefined : end);
}

interface CatalogueProperty {
  readonly name: string;
  /** Text inside the parentheses after the name, or null when the catalogue gives no type. */
  readonly type: string | null;
}

/**
 * The properties of a "Properties" cell: each backticked name at parenthesis depth 0, with the parenthesised group
 * that directly follows it (its type). Backticks inside a group (enum values) are not names; prose after the last
 * property is ignored.
 */
function parseProperties(cell: string): CatalogueProperty[] {
  const out: CatalogueProperty[] = [];
  let i = 0;
  while (i < cell.length) {
    const ch = cell[i];
    if (ch === '(') {
      // An unattached group (prose such as "(E-1.5 Q-8)"): skip it.
      i = closingParen(cell, i) + 1;
    } else if (ch === '`') {
      const end = cell.indexOf('`', i + 1);
      const name = cell.slice(i + 1, end);
      let j = end + 1;
      while (cell[j] === ' ') j += 1;
      let type: string | null = null;
      if (cell[j] === '(') {
        const close = closingParen(cell, j);
        type = cell.slice(j + 1, close);
        j = close + 1;
      }
      out.push({ name, type });
      i = j;
    } else {
      i += 1;
    }
  }
  return out;
}

function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === '(') depth += 1;
    if (text[k] === ')') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  throw new Error(`unbalanced parentheses in: ${text}`);
}

const backticked = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');

// ---------------------------------------------------------------------------------------------------------------
// Type grammar → comparable descriptor
// ---------------------------------------------------------------------------------------------------------------

type Shape =
  | { readonly kind: 'uuid' }
  | { readonly kind: 'bool' }
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'set'; readonly values: readonly string[] }
  | { readonly kind: 'pattern'; readonly pattern: string };

interface Descriptor {
  readonly shape: Shape;
  readonly optional: boolean;
}

const MIN_SAFE = Number.MIN_SAFE_INTEGER;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const HEX16 = '^[0-9a-f]{16}$';

const BUCKETS = (() => {
  const text = section('Client-local playtest events');
  const list = (name: string): string[] => {
    const at = text.indexOf(`- \`${name}\``);
    const colon = text.indexOf(':', at);
    const stop = text.indexOf('. ', colon);
    return backticked(text.slice(colon, stop).replace(/\n/g, ' '));
  };
  return { latency: list('compute_ms_bucket'), nodes: list('nodes_used_bucket') };
})();

const CATEGORIES = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'packages/lexicon/data/categories.json'), 'utf8')) as {
    categories: { id: string }[];
  }
).categories.map((c) => c.id);

/** Values of a bare `enum`, as the catalogue's commentary references them. */
const ENUM_REFERENCES: Readonly<Record<string, readonly string[]>> = {
  category: CATEGORIES,
  difficulty: DIFFICULTIES,
  relation: RELATION_TYPES,
  compute_ms_bucket: BUCKETS.latency,
  total_ms_bucket: BUCKETS.latency,
  nodes_used_bucket: BUCKETS.nodes,
};

function expected(
  event: string,
  prop: CatalogueProperty,
  personalities: readonly string[],
): Descriptor {
  if (prop.type === null) throw new Error(`${event}.${prop.name}: the catalogue gives no type`);
  const head = prop.type.split(';')[0] ?? '';
  const parts = head.split(',').map((p) => p.trim());
  const optional = parts.includes('optional');
  const base = parts[0] ?? '';
  const of = (shape: Shape): Descriptor => ({ shape, optional });
  if (base === 'uuid') return of({ kind: 'uuid' });
  if (base === 'bool') return of({ kind: 'bool' });
  if (base === 'canonical id') return of({ kind: 'pattern', pattern: CANONICAL_ID_PATTERN.source });
  if (base === 'string id') return of({ kind: 'pattern', pattern: STRING_ID_PATTERN.source });
  if (base === 'string' && parts[1] === '16 hex') return of({ kind: 'pattern', pattern: HEX16 });
  const int = /^int(?:\s*≥\s*(-?\d+)|\s+(-?\d+)–(-?\d+))?(?:\s|=|$)/.exec(base);
  if (int !== null) {
    if (int[1] !== undefined) return of({ kind: 'int', min: Number(int[1]), max: MAX_SAFE });
    if (int[2] !== undefined) return of({ kind: 'int', min: Number(int[2]), max: Number(int[3]) });
    return of({ kind: 'int', min: MIN_SAFE, max: MAX_SAFE });
  }
  if (base.startsWith('set of')) return of({ kind: 'set', values: backticked(base) });
  if (base === 'enum') {
    const values = prop.name === 'bot_personality' ? personalities : ENUM_REFERENCES[prop.name];
    if (values === undefined) throw new Error(`${event}.${prop.name}: unresolved enum reference`);
    return of({ kind: 'enum', values });
  }
  if (base.startsWith('`')) return of({ kind: 'enum', values: backticked(base) });
  throw new Error(`${event}.${prop.name}: type outside the grammar: ${prop.type}`);
}

// ---------------------------------------------------------------------------------------------------------------
// JSON Schema (from zod) → comparable descriptor
// ---------------------------------------------------------------------------------------------------------------

interface JsonSchema {
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly const?: string;
  readonly format?: string;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

function actualShape(schema: JsonSchema): Shape {
  if (schema.type === 'boolean') return { kind: 'bool' };
  if (schema.type === 'integer') {
    return { kind: 'int', min: schema.minimum ?? -Infinity, max: schema.maximum ?? Infinity };
  }
  if (schema.const !== undefined) return { kind: 'enum', values: [schema.const] };
  if (schema.enum !== undefined) return { kind: 'enum', values: schema.enum };
  if (schema.type === 'array' && schema.items !== undefined) {
    const items = actualShape(schema.items);
    return { kind: 'set', values: items.kind === 'enum' ? items.values : [] };
  }
  if (schema.type === 'string' && schema.format === 'uuid') return { kind: 'uuid' };
  if (schema.type === 'string' && schema.pattern !== undefined) {
    return { kind: 'pattern', pattern: schema.pattern };
  }
  throw new Error(`schema outside the grammar: ${JSON.stringify(schema)}`);
}

function propertiesSchema(name: EventName): JsonSchema {
  const json = toJSONSchema(EVENT_SCHEMAS[name].schema, { io: 'input' }) as JsonSchema;
  const props = json.properties?.['properties'];
  if (props === undefined) throw new Error(`${name}: no properties object`);
  return props;
}

function actual(name: EventName): Record<string, Descriptor> {
  const props = propertiesSchema(name);
  const required = new Set(props.required ?? []);
  const out: Record<string, Descriptor> = {};
  for (const [key, schema] of Object.entries(props.properties ?? {})) {
    out[key] = { shape: actualShape(schema), optional: !required.has(key) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The catalogue's E-1.5 events
// ---------------------------------------------------------------------------------------------------------------

interface CatalogueEvent {
  readonly name: string;
  readonly version: number;
  readonly properties: readonly CatalogueProperty[];
}

function eventsOf(table: Table): CatalogueEvent[] {
  const props = table.header.findIndex((h) => h.startsWith('Properties'));
  const version = table.header.indexOf('v');
  return table.rows.map((row) => ({
    name: backticked(row.cells[0] ?? '')[0] ?? '',
    version: Number(row.cells[version]),
    properties: parseProperties(row.cells[props] ?? ''),
  }));
}

const clientSection = section('Client-local playtest events');
const clientTables = tables(clientSection).filter((t) =>
  t.header.some((h) => h === 'Properties (type)'),
);
const CATALOGUE_EVENTS: CatalogueEvent[] = clientTables.flatMap(eventsOf);
const MAIN_TABLE = tables(CATALOGUE.slice(0, CATALOGUE.indexOf('\n### App lifecycle')))[0];

describe('analytics catalogue ↔ zod schemas (AC-17, sprint 4 D1)', () => {
  it('finds the two typed tables of the E-1.5 client section', () => {
    expect(clientTables).toHaveLength(2);
    expect(CATALOGUE_EVENTS.length).toBeGreaterThanOrEqual(16);
  });

  it('has a schema for exactly the catalogue events, no more, no fewer', () => {
    const fromCatalogue = CATALOGUE_EVENTS.map((e) => e.name).sort();
    expect(Object.keys(EVENT_SCHEMAS).sort()).toEqual(fromCatalogue);
    expect(new Set(fromCatalogue).size).toBe(fromCatalogue.length);
  });

  const personalities = backticked(
    CATALOGUE_EVENTS.find((e) => e.name === 'bot_match_started')?.properties.find(
      (p) => p.name === 'bot_personality',
    )?.type ?? '',
  );

  describe.each(CATALOGUE_EVENTS.map((e) => [e.name, e] as const))('%s', (name, event) => {
    const entry = EVENT_SCHEMAS[name as EventName];

    it('has the catalogue version', () => {
      expect(entry.version).toBe(event.version);
    });

    it('has the catalogue properties, types and required/optional', () => {
      const want: Record<string, Descriptor> = {};
      for (const prop of event.properties) want[prop.name] = expected(name, prop, personalities);
      expect(actual(name as EventName)).toEqual(want);
    });

    it('rejects unknown properties and unknown envelope keys', () => {
      const props = propertiesSchema(name as EventName);
      expect(props.additionalProperties).toBe(false);
      const json = toJSONSchema(entry.schema, { io: 'input' }) as JsonSchema;
      expect(json.additionalProperties).toBe(false);
    });
  });

  it('keeps the reused events consistent with the main table (names and version)', () => {
    if (MAIN_TABLE === undefined) throw new Error('main table not found');
    const reused = eventsOf(clientTables[0] ?? { header: [], rows: [] });
    expect(reused.map((e) => e.name)).toEqual([
      'app_opened',
      'onboarding_step_completed',
      'knowledge_card_opened',
      'knowledge_graph_navigated',
    ]);
    const propsCol = MAIN_TABLE.header.indexOf('Properties');
    const vCol = MAIN_TABLE.header.indexOf('v');
    for (const event of reused) {
      const row = MAIN_TABLE.rows.find((r) => backticked(r.cells[0] ?? '')[0] === event.name);
      expect(row).toBeDefined();
      const mainNames = parseProperties(row?.cells[propsCol] ?? '').map((p) => p.name);
      expect(mainNames).toEqual(event.properties.map((p) => p.name));
      expect(Number(row?.cells[vCol])).toBe(event.version);
    }
  });

  it('keeps the enum constants equal to their sources', () => {
    expect([...CATEGORY_IDS]).toEqual(CATEGORIES);
    expect([...COMPUTE_MS_BUCKETS]).toEqual(BUCKETS.latency);
    expect([...NODES_USED_BUCKETS]).toEqual(BUCKETS.nodes);
    expect([...BOT_PERSONALITIES]).toEqual(personalities);
    const formKind = CATALOGUE_EVENTS.find((e) => e.name === 'bot_word_played')?.properties.find(
      (p) => p.name === 'form_kind',
    );
    expect(backticked(formKind?.type ?? '')).toEqual([...FORM_KINDS]);
  });
});

describe('catalogue parser', () => {
  it('reads names, attached types and skips prose groups', () => {
    expect(
      parseProperties('`a` (int ≥ 0), `b` (`x`/`y`; note `z`), `c`. Prose (E-1.5 Q-8) `d` *(v2)*'),
    ).toEqual([
      { name: 'a', type: 'int ≥ 0' },
      { name: 'b', type: '`x`/`y`; note `z`' },
      { name: 'c', type: null },
      { name: 'd', type: null },
    ]);
  });

  it('maps every grammar form', () => {
    const d = (type: string, name = 'p'): Descriptor => expected('e', { name, type }, ['q']);
    expect(d('int')).toEqual({
      shape: { kind: 'int', min: MIN_SAFE, max: MAX_SAFE },
      optional: false,
    });
    expect(d('int = `a − b`, signed; F-9').shape).toEqual({
      kind: 'int',
      min: MIN_SAFE,
      max: MAX_SAFE,
    });
    expect(d('int 0–100; x').shape).toEqual({ kind: 'int', min: 0, max: 100 });
    expect(d('int ≥ 1, optional')).toEqual({
      shape: { kind: 'int', min: 1, max: MAX_SAFE },
      optional: true,
    });
    expect(d('string, 16 hex').shape).toEqual({ kind: 'pattern', pattern: HEX16 });
    expect(d('set of `a`/`b`; `c` reserved').shape).toEqual({ kind: 'set', values: ['a', 'b'] });
    expect(d('`out` = R-1 / `resign` = R-2').shape).toEqual({
      kind: 'enum',
      values: ['out', 'resign'],
    });
    expect(d('enum; x', 'bot_personality').shape).toEqual({ kind: 'enum', values: ['q'] });
    expect(() => d('enum', 'unknown_ref')).toThrow('unresolved enum reference');
    expect(() => d('float')).toThrow('outside the grammar');
    expect(() => expected('e', { name: 'p', type: null }, [])).toThrow('no type');
    expect(() => closingParen('(a', 0)).toThrow('unbalanced');
  });
});
