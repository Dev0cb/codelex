# 0002 — React Native + Expo for mobile, Next.js for web

- Status: Accepted · Date: 2026-10-01 · Reversibility: One-way door (high cost)

## Context
Mobile-first game with a custom board, animations, IAP, push, OTA fixes, and the need to run the TS rules engine
on device for prediction.

## Options considered
- **A. React Native + Expo (EAS) + Skia + Reanimated** — shares TS engine natively, OTA updates, strong ecosystem;
  Skia gives 60 fps custom rendering.
- **B. Flutter** — excellent rendering; engine must be ported to Dart (duplicate rules → fairness risk).
- **C. Unity** — great for heavy 2D/3D; heavy runtime, poor fit for app-like UI, social, web reuse.
- **D. Native Swift/Kotlin** — best performance, double the work, engine duplicated twice.

## Decision
A for mobile; Next.js for web/admin sharing `packages/design-system` tokens, `packages/i18n` and protocol types.

## Consequences
Performance budgets enforced in CI; board rendering isolated in a Skia component; native modules only via Expo
config plugins; revisit if 60 fps cannot be held on reference mid-range Android.
