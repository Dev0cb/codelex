export interface DraftOptIn {
  readonly kind: 'draft-opt-in';
}

export const ALLOW_DRAFT_RULES: DraftOptIn = Object.freeze({ kind: 'draft-opt-in' });
