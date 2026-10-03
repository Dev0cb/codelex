# @codelex/i18n

Message catalogs (EN, FR) in ICU MessageFormat and a tiny typed formatter shared by `apps/mobile` and, later,
`apps/web` and `apps/admin`. Zero runtime dependencies besides `@codelex/config/result`; works on Hermes without
an `Intl.PluralRules` polyfill. Contract and rationale: `docs/architecture/notes/mobile-app-foundation.md` §4.

- Owner: `frontend-web-engineer` (consult `ux-ui-designer` for copy, `mobile-engineer` for the app integration)
- Coverage preset: `base` (`@codelex/config/vitest`)
- Scaffolded by `tools/scaffold/scaffold.mjs`.

## API

```ts
import { createTranslator, resolveLocale } from '@codelex/i18n';

const { t, locale, direction } = createTranslator(resolveLocale(deviceLanguageTags), {
  onError: (e) => diagnostics.record(e), // optional; never receives parameter values
});
t('app.name'); // "CODELEX"
t('a11y.tile.letter', { letter: 'Z', points: 0 }); // EN "Letter Z, 0 points" · FR "Lettre Z, 0 point"
```

- `t(key, params?)`: `key` is typed (`MessageKey` = keys of the EN catalog), so a typo fails `typecheck`.
  It never throws: a key missing in FR falls back to EN, any other failure returns the key and calls `onError`.
- `resolveLocale(tags)`: first supported primary language subtag, else `en` (E-1.5 D-19).
- `textDirection(locale)`: `'ltr' | 'rtl'`, so layouts are RTL-ready before an RTL locale ships.
- `pluralCategory(locale, n)`, `parseMessage`, `formatMessage`, `checkCatalogs()` for tooling and tests.

## Catalogs

`src/catalogs/<locale>.json`, a flat object `key → ICU message`. English is the reference catalog: every locale has
exactly its keys, and every message takes the same argument names (`checkCatalogs()`, enforced by the tests).

### Key naming convention

- Dot-separated, lower `snake_case` segments, at least two: `<surface>.<element>[.<variant>…]`
  (regex `KEY_PATTERN`). Examples: `home.play_now`, `home.new_match.confirm.title`, `error.lexicon.code`.
- The first segment is the screen or surface (`home`, `match`, `summary`, `settings`, `error`, `splash`), or a shared
  namespace: `common.*` (generic buttons), `bot.<id>.*`, `a11y.*` (screen-reader-only labels and announcements).
- Keys describe the role, never the text (`home.play_now`, not `home.play_now_button_label_en`).
- Keys from the E-1.5 copy table (`docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.design.md` §10) are used as is.

### Supported ICU subset

`{arg}` (numbers are locale-formatted), `{arg, number}`, `{arg, plural, =N {…} one {…} other {…}}` with `#`,
`{arg, select, value {…} other {…}}`, apostrophe quoting (`''` is `'`; `'{x}'` is a literal `{x}`; a lone `'` before a
letter, as in `l'app`, is literal). Not supported (rejected at parse time, so CI fails): date/time/ordinal/spellout
arguments, number styles, plural `offset`. Add them here, with tests, when a spec needs them.

### Copy rules

- No hard-coded user-facing strings anywhere else (CLAUDE.md §1.6); plurals always via ICU `plural`, never
  string concatenation.
- French uses _tu_ and French typography (E-1.5 D-19): U+202F before `; ! ?`, U+00A0 before `:` and inside « »
  (checked by `checkCatalogs()`). Prefer the typographic apostrophe `’` in new FR copy.
- FR plurals: 0 and 1 are singular (`one`); exact millions are `many`, which falls back to `other` when absent.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/i18n
```

## Invariants

1. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
2. Every catalog passes `checkCatalogs()`; EN and FR are both mandatory for every key.
3. `t` never throws and never logs parameter values (they can be user data).
4. No dependency on `Intl.PluralRules` (absent on Hermes); `Intl.NumberFormat` is used for numbers.
