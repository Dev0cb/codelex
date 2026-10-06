# Runbook: Android internal test build (EAS, APK link)

- Owner: `mobile-engineer`. Run by: the product owner (Expo account `m67`).
- Not a paging alert. It is the procedure to produce the first Android test build of `apps/mobile` and share it with
  a small group of testers as an install link.
- App identifier: `com.codelex.app` (Android package and iOS bundle identifier, `apps/mobile/app.json`).
- Build profile: `preview` in `apps/mobile/eas.json`: internal distribution, an `.apk` file, and the flag
  `play_vs_bot.enabled` turned on for this profile only (`EXPO_PUBLIC_CODELEX_FLAGS=play_vs_bot.enabled=1`). The
  default in the code stays off (`apps/mobile/src/config/flags.ts`), so any other build still shows the "paused" card.
- Privacy policy: `https://dev0cb.github.io/codelex/privacy/` (`expo.extra.privacyPolicyUrl` in `app.json`).

## What you need

- A computer with Node.js 22 and this repository checked out (`pnpm install` done at the repository root).
- The Expo account `m67` (username and password, or a sign-in link).
- Nothing else: Expo creates and keeps the Android signing key for you on the first build.

You do not need to install the Expo tools globally. Every command below uses `npx`, which downloads the tool the
first time. If you prefer a global install: `npm install -g eas-cli`, then type `eas` instead of `npx eas-cli`.

## Steps (one time)

1. Open a terminal in the `apps/mobile` folder of the repository.
2. Sign in to Expo:

   ```bash
   npx eas-cli login
   ```

   Enter the `m67` username and password. Check with `npx eas-cli whoami`: it must print `m67`.
3. Link the app to an Expo project:

   ```bash
   npx eas-cli init
   ```

   Accept the proposal to create the project `@m67/codelex`. This adds `extra.eas.projectId` to
   `apps/mobile/app.json`. Then either commit that change (`chore(mobile): set the EAS project id`) and open a pull
   request, or give the projectId (a long id like `0f1e2d3c-…`) to Claude, who will add it. The projectId is not a
   secret.

## Steps (each build)

4. Still in `apps/mobile`, start the build:

   ```bash
   npx eas-cli build -p android --profile preview
   ```

   - On the first build, the tool asks whether to generate a new Android keystore: answer **yes**. Expo stores it;
     never download it into the repository.
   - The build runs on Expo's servers (about 10 to 20 minutes). Before compiling, the build runs the app's
     `eas-build-post-install` script, which builds the shared packages and the lexicon file the app embeds.
   - At the end, the terminal prints a link to the build page on expo.dev, with an **Install** link and a QR code.
     The same link is under expo.dev → project `codelex` → Builds.
5. Share that build page link (or the QR code) with the testers, for example by email or chat. Only people with the
   link can download the APK; anyone who has the link can, so send it only to enrolled testers.

## How testers install the APK (Android phone)

1. Open the link on the phone and tap **Install** (or scan the QR code with the camera). The `.apk` file downloads.
2. Open the downloaded file (from the notification or the Files / Downloads app).
3. Android says the source is not allowed to install apps. Tap **Settings**, turn on **Allow from this source** for
   the app that opened the file (usually Chrome or Files), then go back and tap **Install**.
4. If Google Play Protect warns about an unknown app, tap **More details** → **Install anyway**. This is expected
   for an app that does not come from the Play Store.
5. Open CODELEX. After installing, testers may turn **Allow from this source** off again.

A later build installs over the previous one with the same steps (match data on the phone is kept). If the phone
refuses the update, uninstall CODELEX first, then install the new file.

## Optional, later: let GitHub Actions build

Not set up yet; no workflow builds the app today. To prepare it:

1. On expo.dev, open **Account settings** → **Access tokens** and create a token (name it `github-actions`).
2. In the GitHub repository, open **Settings** → **Secrets and variables** → **Actions** → **New repository
   secret**, name it `EXPO_TOKEN` and paste the token. Never paste it in a file, an issue or a chat.
3. Ask `devops-sre` / Claude to add the build workflow; it will read `EXPO_TOKEN` from the secrets.

Revoke the token on expo.dev if it may have leaked.

## Follow-ups

- The Settings screen of E-1.5 (design §5.8 "About this build") has no privacy policy row yet, and the Settings screen
  is not built. Adding a "Privacy policy" link there needs a spec and string update (`ux-ui-designer`,
  `privacy-compliance`); the URL is already readable in the app as `expo.extra.privacyPolicyUrl`.
- Play Console (internal testing track) and App Store Connect / TestFlight ask for the privacy policy URL in their
  own forms; enter the URL above there when those tracks are set up. An APK shared by link does not need it.
- iOS builds are out of scope for this runbook.
