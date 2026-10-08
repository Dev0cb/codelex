/**
 * Envelope helpers (catalogue "Conventions"): the `locale` field is the device's first preferred locale reduced to
 * language, optional script and optional region, so Unicode extensions (Android 14 regional preferences such as
 * `en-US-u-fw-mon`) or private-use subtags never reach an event. Pure; tested.
 */
import { GUARD_LOCALE as LOCALE_PATTERN } from './event-guard';

/** `und` (undetermined) when the tag has no usable language subtag. */
export function normalizeLocale(tag: string | null | undefined): string {
  const parts = (tag ?? '').replace(/_/g, '-').split('-');
  const language = (parts[0] ?? '').toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return 'und';
  let out = language;
  let i = 1;
  const script = parts[i] ?? '';
  if (/^[A-Za-z]{4}$/.test(script)) {
    out += `-${script[0]?.toUpperCase() ?? ''}${script.slice(1).toLowerCase()}`;
    i += 1;
  }
  const region = parts[i] ?? '';
  if (/^([A-Za-z]{2}|\d{3})$/.test(region)) out += `-${region.toUpperCase()}`;
  return LOCALE_PATTERN.test(out) ? out : language;
}
