---
name: release-mobile
description: Prepare an iOS/Android release of apps/mobile — version bump, EAS build profiles, OTA vs binary decision, store metadata EN/FR, privacy labels/data safety, phased rollout, crash monitoring. Use for every store submission.
argument-hint: "<version>"
---

# Mobile release

Version: $ARGUMENTS

1. `mobile-engineer`: confirm changes since last release (`git log` on `apps/mobile` and its deps), decide OTA
   (JS-only, same runtimeVersion) vs binary, bump versions/build numbers, run E2E (Maestro) on the device matrix.
2. `qa-engineer`: release go/no-go per its checklist (crash-free ≥ 99.7% in beta, no open S1/S2).
3. `privacy-compliance`: `docs/compliance/STORE_CHECKLIST.md` (privacy labels, data safety, age rating, account
   deletion, Sign in with Apple, IAP rules).
4. `tech-writer`: "What's new" EN/FR.
5. Phased rollout plan (iOS phased release 7 days; Play staged 5% → 20% → 50% → 100%) with halt criteria.
Never submit or promote a build yourself; prepare commands for the human.
