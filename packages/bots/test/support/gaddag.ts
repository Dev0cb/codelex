/**
 * Test-only GADDAG (Gordon 1994) over the forms of any `LexiconIndex`, until L5 ships the `.clxi` GADDAG section.
 * Neither the reference index (L3) nor the `.clxi` decoder (L4) exposes `gaddag` today, so the bots' GADDAG path
 * is exercised against this builder: each form w of length n is inserted as rev(w) and as
 * rev(w[0..i]) ◇ w[i..n] for i = 1..n−1 (lexicon-index note §2.3). An unminimised trie: correct, not compact.
 */
import {
  GADDAG_SEPARATOR,
  type FormRef,
  type Gaddag,
  type GaddagNode,
  type LexiconIndex,
} from '@codelex/lexicon/index';

const CODE_A = 65;
const STRIDE = 32;

export function buildGaddag(forms: readonly string[]): Gaddag {
  const arcMasks: number[] = [0];
  const finals: boolean[] = [false];
  const children = new Map<number, number>();

  function insert(symbols: readonly number[]): void {
    let node = 0;
    for (const symbol of symbols) {
      const key = node * STRIDE + symbol;
      let child = children.get(key);
      if (child === undefined) {
        child = arcMasks.length;
        arcMasks.push(0);
        finals.push(false);
        children.set(key, child);
        arcMasks[node] = (arcMasks[node] ?? 0) | (1 << symbol);
      }
      node = child;
    }
    finals[node] = true;
  }

  for (const form of forms) {
    const codes = Array.from(form, (ch) => ch.charCodeAt(0) - CODE_A);
    insert([...codes].reverse());
    for (let i = 1; i < codes.length; i += 1) {
      insert([...codes.slice(0, i).reverse(), GADDAG_SEPARATOR, ...codes.slice(i)]);
    }
  }

  return Object.freeze({
    root: 0 as GaddagNode,
    arcs: (node: GaddagNode): number => arcMasks[node] ?? 0,
    next: (node: GaddagNode, symbol: number): GaddagNode | -1 =>
      (children.get(node * STRIDE + symbol) ?? -1) as GaddagNode | -1,
    isFinal: (node: GaddagNode): boolean => finals[node] ?? false,
  });
}

/** Every playable form of `index`, in FormRef order. */
export function formsOf(index: LexiconIndex): string[] {
  const forms: string[] = [];
  for (let ref = 0; ref < index.size; ref += 1) forms.push(index.formMeta(ref as FormRef).form);
  return forms;
}

/** `index` with a GADDAG attached (same identity, same members otherwise). */
export function withGaddag(index: LexiconIndex): LexiconIndex {
  return Object.freeze({ ...index, gaddag: buildGaddag(formsOf(index)) });
}
