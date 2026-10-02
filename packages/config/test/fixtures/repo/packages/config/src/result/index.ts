export type Ok<T> = { readonly ok: true; readonly value: T };

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
