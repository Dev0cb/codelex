/**
 * The draft opt-in token (ADR-0014 §D4). It is exported only from `@codelex/game-engine/draft`
 * (`src/draft.ts`), never from the root entry. Lint bans that entry under `apps/**` and `services/**`, so an app
 * or a service can never create, resume or replay a draft rules version.
 */
declare const draftOptInBrand: unique symbol;

/** A token, not a flag: only the one object below opts in, compared by identity. */
export interface DraftOptIn {
  readonly [draftOptInBrand]: 'draft-opt-in';
}

/** Simulator and engine tests only. Never stored in state, never logged. */
export const ALLOW_DRAFT_RULES: DraftOptIn = Object.freeze({}) as DraftOptIn;
