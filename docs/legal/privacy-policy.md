<!--
Owner-filled facts (filled 2026-10-07, from the product owner; confirmed 2026-10-16):
  Controller: Malick BA (individual; no postal address published on this playtest page).
  Privacy contact and playtest mailbox: titanfst00@gmail.com.
  Providers: Google (Gmail, Google Forms, Google Drive) on the owner's consumer Google account, not hosted in a single
  region (multi-region, including the United States); Expo (EAS) hosts the APK. Nothing is stored "in the EU" by us.
Owner decision (2026-10-16, product owner Malick BA): "I am the only tester and the only reader of the privacy policy
  for now, so update it where needed." See "Owner decision 2026-10-16" below.
-->

# CODELEX privacy policy (Phase 1 Android playtest)

- Document: `docs/legal/privacy-policy.md` · Owner: `privacy-compliance` · Approver: product owner + counsel
- Version: **playtest-privacy-v1.2** · Date: **2026-10-16** (previous: playtest-privacy-v1.1, 2026-10-07)
- Published copies: `site/privacy/index.html` (EN, <https://dev0cb.github.io/codelex/privacy/>) and
  `site/privacy/fr/index.html` (FR, <https://dev0cb.github.io/codelex/privacy/fr/>).
- **Sync rule.** This file is the source of truth. The two HTML pages are kept in sync by hand with it: any change
  here changes both pages in the same PR, with the same version and date. The HTML pages carry the version string
  `playtest-privacy-v1.2` so a reviewer can check them with
  `grep -c "playtest-privacy-v1.2" docs/legal/privacy-policy.md site/privacy/index.html site/privacy/fr/index.html`.
- Consent form shown with this policy: `playtest-consent-v1.1` (`docs/specs/E-1.5-play-vs-bot/playtest-plan.md` §2).
- Facts used: `docs/compliance/DATA_MAP.md`, `docs/standards/ANALYTICS_EVENTS.md` (client-local playtest events),
  `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.md` (AC-10, AC-11, AC-17 to AC-20, Flags & rollout, privacy
  notes, Q-1, Q-2, Q-7), `docs/specs/E-1.5-play-vs-bot/playtest-plan.md` (§1.3 roster, §2 consent text),
  `docs/security/threat-models/e-1.5-s1-persistence-match-log.md` (TM-03 to TM-06, §8, §12),
  `apps/mobile/src/analytics/` (`events.ts` envelope and events, `playtest-file.ts` export header `exportFormat: 1`,
  `survey.ts` survey counters, `consent.ts`, `recorder.ts` purge on withdrawal, `envelope.ts` locale),
  `apps/mobile/src/match-log/match-log-file.ts` (match-log export), `apps/mobile/src/config/flags.ts` and
  `apps/mobile/eas.json` (S6 features are off in the current `preview` build), `packages/i18n/src/catalogs/en.json`
  and `fr.json` (`settings.*`, `export.*`, `matchlog.*`, `survey.*` labels quoted below),
  `docs/architecture/notes/diagnostics-screen.md` (owner-only Diagnostics build).
- Re-review this policy before: any build that turns on `analytics.upload.enabled`, `playtest.survey.enabled` or
  `playtest.match_log.enabled` for anyone other than the owner, the remote config fetch (AC-19), any iOS build, any
  closed or public track, accounts (E-2.1), any backend or SDK, and before any tester other than the owner enrols.

## Owner decision 2026-10-16 (not published)

The product owner, Malick BA, decided on 2026-10-16: "I am the only tester and the only reader of the privacy policy
for now, so update it where needed." Consequences recorded by `privacy-compliance`:

- No tester other than the owner has enrolled, so no tester received consent v1 with its false "Data is stored in the
  EU" sentence, and none gave consent covering fewer fields than the app now records. No re-information or re-consent
  campaign is needed.
- From v1.2 on, every future tester reads this policy (v1.2) and consent form `playtest-consent-v1.1` **before
  enrolling**. Consent v1 is kept only as history and must not be shown to anyone.
- This decision does not answer counsel questions about the law itself (transfers, Google's role, retention). Those
  stay open below and still block Stage 1 (any external tester).

## Reviewer notes (not published)

`LEGAL_REVIEW_REQUIRED` items. They are not shown on the public pages. Status as of v1.2:

1. **Open.** Legal basis for the match-log email: this policy states legitimate interest (Art. 6(1)(f)) because the
   export must stay available with analytics consent off (TM-05, TM-06). DATA_MAP's mailbox row says "consent".
   Counsel picks one.
2. **Open (dormant while the owner is the only tester; blocks the first other tester).** Transfers out of the
   tester's country (Senegal, France, elsewhere) to Google's multi-region storage including the United States: legal
   ground and whether a prior declaration or authorisation from the CDP is required (Law 2008-12).
3. **Open (dormant: no team tester today).** Validity of employee consent (team testers).
4. **Open.** Retention periods (30 days on device, 7 days mailbox, 6 months raw files, playtest end + 12 months roster),
   and whether the survey counters may stay on the device after consent withdrawal as "strictly necessary"
   (ePrivacy Art. 5(3)) rather than under consent.
5. **Open.** Whether the controller (an individual) needs a postal address and an Art. 27 GDPR representative on this
   page.
6. **Open.** Remote config (AC-19): the host is not chosen. Before the fetch is turned on, name the host here and
   confirm it receives no identifier other than the IP address.
7. **Resolved in v1.2 (consent form v1.1).** The consent form named Apple TestFlight, Google Play and "[EU mail and
   storage provider]". Consent v1.1 is Android only, names the EAS install link, Google (Gmail, Forms, Drive) and
   Expo, and matches this policy.
8. **Open.** US transfer via Google: the sign-up form (Google Forms), the playtest mailbox (Gmail,
   `titanfst00@gmail.com`) and the restricted storage (Google Drive) run on a consumer Google account. Counsel must
   confirm (a) whether Google acts as processor or as independent controller under consumer terms (no Workspace data
   processing terms), (b) the transfer mechanism to the United States (EU-US Data Privacy Framework certification
   and/or SCCs) and its adequacy for Senegalese testers, and (c) whether moving to a Workspace account with signed data
   processing terms is required before Stage 1. v1.2 describes Google neutrally as a "provider" for this reason.
9. **Open.** Expo (650 Industries, United States) serves the APK download and sees the tester's IP address and
   device/browser data under its own privacy policy. Counsel to confirm that describing this as Expo's own processing
   is adequate.
10. **Resolved for Phase 1 by the owner decision of 2026-10-16.** Validity of consent given under consent v1, which
    said "Data is stored in the EU" while data actually goes to Google multi-region storage including the US. No tester
    other than the owner gave consent under v1; every future tester gets v1.2 and consent v1.1 before enrolling.
    Reopens if anyone other than the owner turns out to have enrolled under v1.
11. **Resolved for Phase 1 by the owner decision of 2026-10-16.** Fields recorded beyond the consent v1 list (network
    type, foreground time, onboarding steps, bot timings, Knowledge Card and graph browsing, summary actions, survey
    shown and dismissed, phone language and region code, export header counts). Consent v1.1 and §3.6 list them all;
    no tester other than the owner consented under v1.

## English

### In short

- CODELEX is a word game about technology. This policy covers the **Phase 1 playtest** of the Android app
  (`com.codelex.app`) and the sign-up form for that playtest. It is not the policy of a public release.
- The playtest is for **adults (18+) who were invited** through the sign-up form. The app is shared through a private
  install link only.
- **Today, nothing leaves your phone.** The app has no account, no server, no ads, no analytics service and no crash
  reporting service. Your matches are saved on your phone so you can resume them.
- Some features are already built into the app but **switched off in the current playtest build** (marked "when
  enabled" below): recording playtest stats on your phone, a one-question survey, and two files you can send yourself,
  by email, with a tap: your playtest data and a match log for bug reports. Nothing is ever sent automatically.
- **Where your data goes.** Everything we receive is kept in Malick BA's personal Google account (Gmail, Google Forms,
  Google Drive). Google may store it in several countries, including the United States. We do not store your data in
  the EU or in any single country we chose.

### 1. Who is responsible

Malick BA, an individual, is the controller of the personal data described here. Contact for any privacy question
or request: titanfst00@gmail.com.

### 2. Who can take part

You must be **18 or older** to take part. You confirm it when you sign up. The app is not meant for children. It is
not directed to children under 13 and we do not knowingly collect data from anyone under 18. If you are under 18,
please do not install the app. If we learn that someone under 18 took part, we remove them from the playtest and
delete the data we hold about them. If you think this happened, write to titanfst00@gmail.com.

The app has no age check of its own, because it is only shared with the invited roster. A public version will have an
age check before it is released.

### 3. What we collect, feature by feature

#### 3.1 Signing up for the playtest (now)

Through the sign-up form (a Google Form), we collect: your name, your email address (which we use to send you the
install link), a yes/no confirmation that you are 18 or older (not your birth date), your country, your preferred
language (English or French), your phone type (Android standard or entry-level), whether you work in software,
whether you want a debrief call, and the version and date of the consent you gave.

This list is kept apart from the game data. We never write the app's tester ID into it.

#### 3.2 Getting the app (now)

The app is not on Google Play. It is an Android app file (APK) built and hosted by Expo Application Services (EAS,
run by 650 Industries, "Expo"). We send you a private install link. When you open it, Expo's servers see the usual
technical data of a download, such as your IP address and your device and browser information. Expo handles that
data under its own privacy policy. We do not receive install or stability statistics from Google Play or from Expo.

#### 3.3 Playing and resuming a match (now; stays on your phone)

To let you pick up a match where you left it, the app saves on your phone:

- the **match log**: the moves played, the random seed of the match, the game and word-list versions, and check
  values used to detect a damaged file. It contains no time stamp, no identifier and nothing about you;
- a **snapshot** of the match, to resume faster;
- a small **resume-safety counter**, so that a damaged save shows a "start a new match" card instead of crashing.

Only the match in progress and the last finished match are kept. Older ones are deleted automatically. Your
animation choice (Settings, "Animations") is also saved on your phone.

#### 3.4 "New to you" (now; stays on your phone)

After a match, the summary shows how many terms you played for the first time on this phone. For this, the app keeps
on your phone the list of terms you have played (word ids only; no time, no identifier, nothing about the opponent).

#### 3.5 Language (now; stays on your phone, except as in 3.6)

The app reads your phone's language and region setting (for example `fr-SN` for French, Senegal) to show English or
French. It does not store it on its own. When "Record playtest stats" is on (section 3.6), every recorded event
carries this language and region code, so it is in the playtest data file if you send it.

#### 3.6 Playtest data (when enabled)

In Settings, the **"Playtest data"** section has a switch **"Record playtest stats"**. It is **on by default**,
because you agreed to it when you signed up; you can switch it off at any time. The first time you open the app, a
short notice tells you this. While the switch is on, the app records game events **on your phone**.

Every event carries:

- **your tester ID** ("Your tester ID" in Settings): a random number made by the app on your phone. It is not your
  phone's ID. A new one is made if you reinstall the app, or if you switch recording off and on again;
- the event's name and format version, a random event id, the time on your phone's clock, a session id (a new random
  one each time the app starts), the app version, the platform (Android) and your phone's language and region code
  (section 3.5).

The events, in plain words:

- **Opening and leaving the app:** each time the app comes to the front, the type of connection (Wi-Fi, mobile,
  other, none or unknown); after a fresh start, how long the start took and whether the previous session ended
  unexpectedly while the app was open (a crash, a forced stop or a power loss). When the app goes to the background,
  how long it was in front.
- **First-launch steps:** which first steps you reached (first launch, home screen seen, "PLAY NOW" tapped, first
  move, the three tips, first match finished) and the time between them.
- **Matches:** a random match id (new for each match); when a match starts: which bot you play against,
  who plays first, the rules, word-list and bot versions, and whether it is your first match; when it ends: the
  result, both scores and the difference, how it ended (out of tiles, too many turns without points, or resign),
  tiles left in the bag and on the board, passes at the end, playing time, number of turns, words, rejected attempts,
  exchanges and passes, and how many times you resumed it; when a match is dropped: why (you started a new one, a new
  app version, or a damaged save), turns and playing time; when a match is resumed: from the background or after a
  restart, how long you were away, how long the restore took and how it was done.
- **Words played** by you and by the bot: the term's id, its form (for example plural), category, difficulty,
  points, bonuses, your thinking time and the turn number.
- **Rejected attempts:** only the reason (not in the word list, bad placement, bad cross-word), the word length,
  your thinking time and the turn number, **never the letters you tried**.
- **The bot's turns:** its thinking time and search effort in coarse ranges, the kind of move (word, exchange or
  pass), and whether it used a fallback or recomputed after a resume.
- **After a match:** which button you tapped on the summary (play again, change opponent, home, discover) and how long
  you stayed on it.
- **Knowledge Cards and graph:** which card you opened and from where, how long you read it and how many related
  terms you tapped; in the graph, which term you moved from and to, and the link between them.
- **Survey (section 3.7):** that the "Would you play CODELEX again?" question was shown, your answer (yes, maybe, no)
  or that you closed it, and how many matches you had finished.
- **Sending:** when you send a file, how many events were sent, how many were dropped since the last file, and the
  age of the oldest one.

The file you send (`codelex-playtest-data.json`) starts with: the file format and type, the app version and build
number, the platform, your tester ID, the time of the export (phone clock), how many events were dropped (buffer full,
older than 30 days, or failed a check) and how many are still waiting for the next file. Then come the events.

It never includes your name, email address, contacts, location, advertising ID, phone model or serial number, phone
number, or any text you type.

To make this work, the app also keeps on your phone: your on/off choice and whether you saw the first-launch notice
(kept after you switch off, so the app remembers "off"); a tiny "app is open" marker used to detect a crash; and the
time the "Send your playtest data?" reminder was last shown. The marker and the reminder time are deleted when you
switch recording off.

These events **leave your phone only when you tap "Send playtest data"** in Settings (or "Review and send" on the
reminder), then "Share file…". Your phone's share menu opens, and you choose to email the file to
titanfst00@gmail.com. Because the email shows your address, the file can then be linked to you. The app then asks
"Did you send the file?": if you tap "Yes, I sent it", those events are cleared from your phone.

If you switch recording off ("Turn off and delete"), nothing more is recorded, and the unsent events, your tester ID,
the marker and the reminder time are deleted from your phone. Note your tester ID first if you want us to delete
data you already sent.

#### 3.7 Survey reminder (when enabled; stays on your phone)

While "Record playtest stats" is on, the summary after your 1st and 3rd finished match may ask "Would you play
CODELEX again?", at most twice. Your answer, or the fact that you closed the question, is an event of section 3.6.

So that it never asks more than twice, the app keeps a small file on your phone with three counts, each 3 or less:
matches finished, times the question was shown, and the match count when it was last shown. It holds no ID, no time
and no answer. It is never put in any file you send and is excluded from backups. It stays on your phone when you
switch recording off (so you are not asked again), and is deleted when you uninstall the app or clear its data.

#### 3.8 Send match log (when enabled)

For bug reports, Settings offers **"Send match log"** ("For bug reports. Contains moves, no personal data."), and so
does the card shown when a saved match is damaged. It shares one file, `codelex-match-log.json`, holding the match in
progress (or else the last finished one):

- the file format and type, the app version and build number, and the platform;
- the match settings, including the random seed, the rules and word-list versions;
- all moves of both players (letters placed, tiles exchanged, passes) and the check values;
- if the match no longer replays as it was saved, the first point where it differs;
- or, if the saved match cannot be read at all, the saved file's bytes as they are (the same kind of content).

It contains **no tester ID, no match id, no time stamp, no file path and no device details**. It works even when
"Record playtest stats" is off.

You send it yourself by email to titanfst00@gmail.com. We then see your email address and anything your email app
adds (such as your display name and the sending time).

#### 3.9 Settings download (when enabled)

When your phone is online, the app will download a small settings file in the background, used to switch features on
or off without a new version (for example, to pause a feature that has a bug). The request carries no identifier
from the app. Like any internet request, it shows your IP address to the server that hosts the file. We will name
that server in this policy before this feature is turned on.

#### 3.10 Debrief calls (only if you opt in)

If you join a debrief call, the interviewer takes notes without your name. We do not record audio or video.

#### 3.11 What we never collect

No account or password, no location, no contacts, no photos, no microphone, no advertising ID, no device model or
serial numbers, no payment data, no text you type. The app shows no ads and contains no analytics, advertising or
crash-reporting software from other companies.

#### 3.12 Owner-only test build

Malick BA also uses a separate test build, "CODELEX Diagnostics" (`com.codelex.app.diagnostics`), on his own phones to
measure speed. It is never given to testers. Its report holds the phone model and Android version, a device class
chosen by the owner, timings, and the app and code versions, with no tester ID.

### 4. Why we use it, and on what legal basis

| What                                                                                                                             | Why                                                                                                                           | Legal basis (GDPR)                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sign-up details                                                                                                                  | Check eligibility, invite you, contact you, keep a record of your consent                                                     | Your consent (Art. 6(1)(a)); keeping the record of consent: legal obligation (Art. 6(1)(c), Art. 7(1))  |
| Match log, snapshot, resume counter, "New to you" list, animation choice, recording choice, survey reminder counts on your phone | Let you resume matches, show the summary, remember your settings, never ask the survey more than twice. We never receive them | Storing them on your phone is strictly necessary for the feature you use (ePrivacy Directive Art. 5(3)) |
| Playtest data, including survey answers (when enabled)                                                                           | Decide whether the game is fun and stable enough to keep building                                                             | Your consent (Art. 6(1)(a)), which you can withdraw in Settings                                         |
| Match log email (when enabled)                                                                                                   | Reproduce and fix the bug you report                                                                                          | Our legitimate interest in fixing bugs you report yourself (Art. 6(1)(f))                               |
| Settings download (when enabled)                                                                                                 | Switch features on or off safely                                                                                              | Our legitimate interest in running the app safely (Art. 6(1)(f))                                        |
| Debrief notes                                                                                                                    | Understand what you liked and disliked                                                                                        | Your consent (Art. 6(1)(a))                                                                             |

We do not use any of this for advertising, we never sell it, we do not use it to evaluate employees, and we make no
automated decisions about you.

### 5. How long we keep it

| Data                                                 | How long                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Match log and snapshot on your phone                 | The match in progress and the last finished match only                                                                                          |
| "New to you" list and animation choice on your phone | Until you uninstall the app or clear its data                                                                                                   |
| Playtest events on your phone (when enabled)         | Until you confirm they were sent, and at most 30 days (at most 5,000 events, oldest dropped first); deleted at once if you switch recording off |
| Tester ID on your phone (when enabled)               | Until you switch recording off or uninstall the app                                                                                             |
| Recording choice on your phone (when enabled)        | Until you uninstall the app or clear its data                                                                                                   |
| Survey reminder counts on your phone (when enabled)  | Kept when you switch recording off; deleted when you uninstall the app or clear its data. Never sent                                            |
| Emails to our mailbox (when enabled)                 | Attachments are moved to restricted storage (Google Drive) within 7 days, then the emails are deleted                                           |
| The copy in your own "Sent" folder                   | Outside our control: your email provider keeps it until you delete it                                                                           |
| Received playtest files and match logs               | Deleted 6 months after the playtest ends. Only anonymous totals are kept                                                                        |
| Debrief notes                                        | Deleted 6 months after the playtest ends                                                                                                        |
| Sign-up details                                      | 12 months after the playtest ends, as a record of your consent                                                                                  |

Uninstalling the app deletes everything it stored on your phone. The app's data is excluded from Android backups and
from device-to-device transfer, so it does not end up in your Google backup.

### 6. Who can see it

At most three named analysts can see the received files. Only the playtest lead can see the sign-up details. The
mailbox uses two-factor sign-in and no automatic forwarding.

Service providers:

- **Google**, which provides the sign-up form (Google Forms), the playtest mailbox (Gmail) and the restricted storage
  (Google Drive), on Malick BA's personal Google account.
- **Expo (EAS, by 650 Industries)**, which builds and hosts the app file and serves the private install link. It
  handles download data under its own privacy policy.
- **Your own email provider**, when you choose to send a file (when enabled). You choose it; its terms apply.

There is no other third party.

### 7. Where it is stored

We do not store your data in the EU, or in any single country we chose. Data we receive (sign-up answers, emails and
files) is kept in Malick BA's personal (consumer) Google account: Gmail, Google Forms and Google Drive. Google may
store and process it in several countries, including the United States, under its own terms and data-transfer
commitments. So signing up or sending us a file may transfer your data outside your country. Expo, which serves the
app download, is based in the United States.

### 8. Your rights

You can ask to **access**, **correct** or **delete** your data, to **restrict** its use, to **object** to uses based on
our legitimate interest, and to receive it in a portable format. Where we rely on your consent, you can **withdraw** it
at any time; this does not affect what was done before.

How:

- **Data on your phone:** switch off "Record playtest stats" (when enabled), or uninstall the app. We have no copy of
  it. The survey reminder counts and your settings go when you uninstall the app or clear its data.
- **Data you sent us:** write to titanfst00@gmail.com. For playtest data, give us your tester ID (shown in Settings).
  For match logs, write from the address you sent them from. We delete the matching files.
- **Leaving the playtest:** write to titanfst00@gmail.com; we remove you from the roster, except the record of your consent
  that we must keep.

We answer within one month. You can also complain to a data protection authority: the CNIL in France, the CDP
(Commission de protection des données personnelles) in Senegal, or the authority where you live.

### 9. Security

Saved files on your phone sit in the app's private storage. Files you send contain only what is listed above. On our
side, access is limited to named people, and received files are checked as untrusted input before anyone opens them.

### 10. Changes

We will tell testers by email before any change that affects what we collect, and we will update the version and date
below. A public release of CODELEX will come with a new policy.

**What changed in v1.2 (2026-10-16), compared with v1.1 (2026-10-07):**

- Section 7 and "In short" now say plainly that we do not store your data in the EU: it is in Malick BA's personal
  Google account, which may use several countries including the United States. An earlier draft of the consent form
  said "Data is stored in the EU"; that was wrong and is replaced by consent form v1.1.
- Section 3.6 lists everything the playtest data file can contain: the file header and every event, including
  first-launch steps, summary buttons, graph browsing, survey dismissals and send counts.
- Section 3.5: when recording is on, events carry your phone's language and region code.
- New section 3.7 "Survey reminder" and its retention row.
- Section 3.8: the match log's contents in detail.
- Setting and button names now match the app ("Record playtest stats", "Send playtest data", "Your tester ID").
- Your tester ID also changes when you switch recording off and on again.
- New retention rows: tester ID, recording choice, the copy in your "Sent" folder.
- New section 3.12 on the owner-only "CODELEX Diagnostics" build.

When v1.2 was published, the only tester was Malick BA himself, so no one else had to be told again. Anyone who joins
later reads this version and consent form v1.1 before signing up.

Version playtest-privacy-v1.2 · 2026-10-16 · Contact: titanfst00@gmail.com

## Français

### En bref

- CODELEX est un jeu de mots autour de la technologie. Cette politique couvre le **playtest de la phase 1** de l'app
  Android (`com.codelex.app`) et le formulaire d'inscription à ce playtest. Ce n'est pas la politique d'une version
  publique.
- Le playtest est réservé aux **adultes (18 ans et plus) invités** via le formulaire d'inscription. L'app est diffusée
  uniquement par un lien d'installation privé.
- **Aujourd'hui, rien ne quitte ton téléphone.** L'app n'a ni compte, ni serveur, ni publicité, ni service de mesure
  d'audience, ni service de rapport de plantage. Tes parties sont enregistrées sur ton téléphone pour que tu puisses
  les reprendre.
- Certaines fonctions sont déjà dans l'app mais **désactivées dans la version de test actuelle** (marquées « une fois
  activé » ci-dessous) : l'enregistrement de statistiques de test sur ton téléphone, une question de sondage, et deux
  fichiers que tu pourras envoyer toi-même par e-mail, d'un geste : tes données de test et un journal de partie pour
  signaler un bug. Rien n'est jamais envoyé automatiquement.
- **Où vont tes données.** Tout ce que nous recevons est conservé dans le compte Google personnel de Malick BA (Gmail,
  Google Forms, Google Drive). Google peut le stocker dans plusieurs pays, dont les États-Unis. Nous ne stockons pas tes
  données dans l'UE ni dans un pays unique que nous aurions choisi.

### 1. Responsable du traitement

Malick BA, personne physique, est responsable du traitement des données personnelles décrites ici. Contact pour
toute question ou demande : titanfst00@gmail.com.

### 2. Qui peut participer

Tu dois avoir **18 ans ou plus** pour participer. Tu le confirmes à l'inscription. L'app n'est pas destinée aux
enfants. Elle ne s'adresse pas aux moins de 13 ans et nous ne collectons pas sciemment de données sur des personnes de
moins de 18 ans. Si tu as moins de 18 ans, n'installe pas l'app. Si nous apprenons qu'une personne mineure a
participé, nous la retirons du playtest et supprimons les données que nous détenons sur elle. Si tu penses que c'est
le cas, écris à titanfst00@gmail.com.

L'app n'a pas de contrôle d'âge intégré, car elle n'est partagée qu'avec la liste des personnes invitées. Une version
publique aura un contrôle d'âge avant sa sortie.

### 3. Ce que nous collectons, fonction par fonction

#### 3.1 Inscription au playtest (maintenant)

Via le formulaire d'inscription (un formulaire Google Forms), nous collectons : ton nom, ton adresse e-mail (utilisée
pour t'envoyer le lien d'installation), une confirmation oui/non que tu as 18 ans ou plus (pas ta date de naissance),
ton pays, ta langue préférée (anglais ou français), ton type de téléphone (Android standard ou d'entrée de gamme), si
tu travailles dans le logiciel, si tu souhaites un entretien de debrief, et la version et la date du consentement
donné.

Cette liste est conservée à part des données de jeu. Nous n'y inscrivons jamais ton identifiant testeur.

#### 3.2 Obtenir l'app (maintenant)

L'app n'est pas sur Google Play. C'est un fichier d'app Android (APK) compilé et hébergé par Expo Application Services
(EAS, exploité par 650 Industries, « Expo »). Nous t'envoyons un lien d'installation privé. Quand tu l'ouvres, les
serveurs d'Expo voient les données techniques habituelles d'un téléchargement, comme ton adresse IP et des
informations sur ton appareil et ton navigateur. Expo traite ces données selon sa propre politique de
confidentialité. Nous ne recevons aucune statistique d'installation ou de stabilité, ni de Google Play ni d'Expo.

#### 3.3 Jouer et reprendre une partie (maintenant ; reste sur ton téléphone)

Pour te permettre de reprendre une partie là où tu l'as laissée, l'app enregistre sur ton téléphone :

- le **journal de partie** : les coups joués, la graine aléatoire de la partie, les versions du jeu et de la liste de
  mots, et des valeurs de contrôle qui servent à détecter un fichier abîmé. Il ne contient ni horodatage, ni
  identifiant, ni rien sur toi ;
- un **instantané** de la partie, pour reprendre plus vite ;
- un petit **compteur de sécurité de reprise**, pour qu'une sauvegarde abîmée affiche une carte « nouvelle partie »
  au lieu de faire planter l'app.

Seules la partie en cours et la dernière partie terminée sont conservées. Les plus anciennes sont supprimées
automatiquement. Ton choix d'animations (Réglages, « Animations ») est aussi enregistré sur ton téléphone.

#### 3.4 « Nouveaux pour toi » (maintenant ; reste sur ton téléphone)

Après une partie, le résumé indique combien de termes tu as joués pour la première fois sur ce téléphone. Pour cela,
l'app garde sur ton téléphone la liste des termes que tu as joués (identifiants de mots uniquement ; ni heure, ni
identifiant, rien sur l'adversaire).

#### 3.5 Langue (maintenant ; reste sur ton téléphone, sauf comme indiqué en 3.6)

L'app lit la langue et la région de ton téléphone (par exemple `fr-SN` pour français, Sénégal) pour s'afficher en
anglais ou en français. Elle ne l'enregistre pas à part. Quand « Enregistrer les statistiques de test » est activé
(section 3.6), chaque événement enregistré porte ce code de langue et de région : il figure donc dans le fichier de
données de test si tu l'envoies.

#### 3.6 Données de test (une fois activé)

Dans les Réglages, la section **« Données de test »** contient un interrupteur **« Enregistrer les statistiques de
test »**. Il est **activé par défaut**, parce que tu l'as accepté à l'inscription ; tu peux le désactiver à tout
moment. Au premier lancement, un court message te le rappelle. Tant qu'il est activé, l'app enregistre des événements
de jeu **sur ton téléphone**.

Chaque événement contient :

- **ton identifiant testeur** (« Ton identifiant testeur » dans les Réglages) : un numéro aléatoire créé par l'app sur
  ton téléphone. Ce n'est pas l'identifiant de ton téléphone. Un nouveau est créé si tu réinstalles l'app, ou si tu
  désactives puis réactives l'enregistrement ;
- le nom et la version de format de l'événement, un identifiant d'événement aléatoire, l'heure de l'horloge de ton
  téléphone, un identifiant de session (un nouveau à chaque démarrage de l'app), la version de l'app, la plateforme
  (Android) et le code de langue et de région de ton téléphone (section 3.5).

Les événements, en clair :

- **Ouverture et sortie de l'app :** à chaque retour de l'app au premier plan, le type de connexion (Wi-Fi, mobile,
  autre, aucune ou inconnue) ; après un démarrage complet, la durée du démarrage et si la session précédente s'est
  terminée de façon inattendue pendant que l'app était ouverte (plantage, arrêt forcé ou coupure de courant). Quand
  l'app passe en arrière-plan, combien de temps elle est restée au premier plan.
- **Premières étapes :** les premières étapes atteintes (premier lancement, écran d'accueil vu, « JOUER » touché,
  premier coup, les trois astuces, première partie terminée) et le temps entre elles.
- **Parties :** un identifiant de partie aléatoire (nouveau à chaque partie) ; au début : le bot que tu affrontes,
  qui commence, les versions des règles, de la liste de mots et du bot, et s'il s'agit de ta première
  partie ; à la fin : le résultat, les deux scores et l'écart, la façon dont elle s'est terminée (plus de lettres,
  trop de tours sans points, ou abandon), les lettres restant dans le sac et sur le plateau, les passes de fin, la
  durée de jeu, le nombre de tours, de mots, d'essais refusés, d'échanges et de passes, et le nombre de reprises ;
  quand une partie est abandonnée par l'app : pourquoi (nouvelle partie, nouvelle version de l'app ou sauvegarde
  abîmée), les tours et la durée ; quand une partie est reprise : depuis l'arrière-plan ou après un redémarrage, le
  temps d'absence, la durée et la méthode de restauration.
- **Mots joués** par toi et par le bot : l'identifiant du terme, sa forme (par exemple pluriel), sa catégorie, sa
  difficulté, les points, les bonus, ton temps de réflexion et le numéro du tour.
- **Essais refusés :** seulement la raison (absent de la liste, mauvais placement, mot croisé invalide), la longueur
  du mot, ton temps de réflexion et le numéro du tour, **jamais les lettres essayées**.
- **Tours du bot :** son temps et son effort de réflexion par tranches larges, le type de coup (mot, échange ou passe),
  et s'il a utilisé une solution de repli ou recalculé après une reprise.
- **Après une partie :** le bouton touché sur le résumé (rejouer, changer d'adversaire, accueil, découvrir) et le temps
  passé sur le résumé.
- **Fiches et graphe :** la fiche ouverte et d'où, le temps de lecture et le nombre de termes liés touchés ; dans le
  graphe, le terme de départ, le terme d'arrivée et le lien entre eux.
- **Sondage (section 3.7) :** que la question « Rejouerais-tu à CODELEX ? » a été affichée, ta réponse (oui, peut-être,
  non) ou le fait que tu l'as fermée, et le nombre de parties terminées.
- **Envoi :** quand tu envoies un fichier, le nombre d'événements envoyés, le nombre d'événements perdus depuis le
  fichier précédent et l'âge du plus ancien.

Le fichier que tu envoies (`codelex-playtest-data.json`) commence par : le format et le type du fichier, la version et
le numéro de build de l'app, la plateforme, ton identifiant testeur, l'heure de l'export (horloge du téléphone), le
nombre d'événements perdus (mémoire pleine, plus de 30 jours, ou contrôle échoué) et le nombre d'événements qui
attendent le fichier suivant. Viennent ensuite les événements.

Il ne contient jamais ton nom, ton adresse e-mail, tes contacts, ta position, ton identifiant publicitaire, le modèle
ou le numéro de série de ton téléphone, ton numéro, ni aucun texte que tu saisis.

Pour que cela fonctionne, l'app garde aussi sur ton téléphone : ton choix activé/désactivé et si tu as vu le message
du premier lancement (gardés après la désactivation, pour que l'app se souvienne de « désactivé ») ; un petit
marqueur « app ouverte » qui sert à détecter un plantage ; et l'heure du dernier rappel « Envoyer tes données de
test ? ». Le marqueur et l'heure du rappel sont supprimés quand tu désactives l'enregistrement.

Ces événements **ne quittent ton téléphone que lorsque tu touches « Envoyer les données de test »** dans les Réglages
(ou « Voir et envoyer » sur le rappel), puis « Partager le fichier… ». Le menu de partage de ton téléphone s'ouvre et
tu choisis d'envoyer le fichier par e-mail à titanfst00@gmail.com. Comme l'e-mail montre ton adresse, le fichier peut
alors être relié à toi. L'app te demande ensuite « As-tu envoyé le fichier ? » : si tu touches « Oui, je l'ai
envoyé », ces événements sont effacés de ton téléphone.

Si tu désactives l'enregistrement (« Désactiver et supprimer »), plus rien n'est enregistré, et les événements non
envoyés, ton identifiant testeur, le marqueur et l'heure du rappel sont supprimés de ton téléphone. Note d'abord ton
identifiant testeur si tu veux que nous supprimions les données déjà envoyées.

#### 3.7 Rappel du sondage (une fois activé ; reste sur ton téléphone)

Tant que « Enregistrer les statistiques de test » est activé, le résumé après ta 1re et ta 3e partie terminée peut
te demander « Rejouerais-tu à CODELEX ? », deux fois au plus. Ta réponse, ou le fait que tu as fermé la question, est
un événement de la section 3.6.

Pour ne jamais demander plus de deux fois, l'app garde sur ton téléphone un petit fichier avec trois compteurs, chacun
de 3 au plus : les parties terminées, le nombre d'affichages de la question et le nombre de parties lors du dernier
affichage. Il ne contient ni identifiant, ni heure, ni réponse. Il n'est jamais mis dans un fichier que tu envoies et
il est exclu des sauvegardes. Il reste sur ton téléphone quand tu désactives l'enregistrement (pour que la question ne
revienne pas), et il est supprimé quand tu désinstalles l'app ou effaces ses données.

#### 3.8 Envoyer le journal de partie (une fois activé)

Pour signaler un bug, les Réglages proposent **« Envoyer le journal de partie »** (« Pour signaler un bug. Contient
les coups, aucune donnée personnelle. »), tout comme la carte affichée quand une partie enregistrée est abîmée. Cela
partage un fichier, `codelex-match-log.json`, avec la partie en cours (ou sinon la dernière terminée) :

- le format et le type du fichier, la version et le numéro de build de l'app, et la plateforme ;
- les paramètres de la partie, dont la graine aléatoire et les versions des règles et de la liste de mots ;
- tous les coups des deux joueurs (lettres posées, lettres échangées, passes) et les valeurs de contrôle ;
- si la partie ne se rejoue plus comme enregistrée, le premier point où elle diffère ;
- ou, si la partie enregistrée est illisible, les octets du fichier enregistré tels quels (le même genre de contenu).

Il ne contient **ni identifiant testeur, ni identifiant de partie, ni horodatage, ni chemin de fichier, ni détail sur
l'appareil**. Cela fonctionne même si « Enregistrer les statistiques de test » est désactivé.

Tu l'envoies toi-même par e-mail à titanfst00@gmail.com. Nous voyons alors ton adresse e-mail et ce que ton app de
messagerie ajoute (comme ton nom affiché et l'heure d'envoi).

#### 3.9 Téléchargement des réglages (une fois activé)

Quand ton téléphone est en ligne, l'app téléchargera en arrière-plan un petit fichier de réglages, qui sert à activer
ou désactiver des fonctions sans nouvelle version (par exemple, mettre en pause une fonction qui a un bug). La requête
ne transmet aucun identifiant de l'app. Comme toute requête internet, elle montre ton adresse IP au serveur qui
héberge le fichier. Nous nommerons ce serveur dans cette politique avant d'activer cette fonction.

#### 3.10 Entretiens de debrief (seulement si tu le choisis)

Si tu participes à un entretien de debrief, la personne qui mène l'entretien prend des notes sans ton nom. Nous
n'enregistrons ni audio ni vidéo.

#### 3.11 Ce que nous ne collectons jamais

Ni compte ni mot de passe, ni position, ni contacts, ni photos, ni micro, ni identifiant publicitaire, ni modèle ou
numéro de série de l'appareil, ni données de paiement, ni texte saisi. L'app n'affiche pas de publicité et ne contient
aucun logiciel de mesure d'audience, de publicité ou de rapport de plantage d'une autre entreprise.

#### 3.12 Version de test réservée au propriétaire

Malick BA utilise aussi une version de test séparée, « CODELEX Diagnostics » (`com.codelex.app.diagnostics`), sur ses
propres téléphones pour mesurer la vitesse. Elle n'est jamais donnée aux testeurs. Son rapport contient le modèle du
téléphone et la version d'Android, une classe d'appareil choisie par le propriétaire, des durées, et les versions de
l'app et du code, sans identifiant testeur.

### 4. Pourquoi nous les utilisons, et sur quelle base légale

| Quoi                                                                                                                                                                | Pourquoi                                                                                                                                                   | Base légale (RGPD)                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Données d'inscription                                                                                                                                               | Vérifier l'éligibilité, t'inviter, te contacter, garder la preuve de ton consentement                                                                      | Ton consentement (art. 6(1)(a)) ; conservation de la preuve du consentement : obligation légale (art. 6(1)(c), art. 7(1)) |
| Journal de partie, instantané, compteur de reprise, liste « Nouveaux pour toi », choix d'animations, choix d'enregistrement, compteurs du sondage sur ton téléphone | Te permettre de reprendre tes parties, afficher le résumé, retenir tes réglages, ne jamais poser le sondage plus de deux fois. Nous ne les recevons jamais | Leur stockage sur ton téléphone est strictement nécessaire à la fonction que tu utilises (directive ePrivacy, art. 5(3))  |
| Données de test, y compris les réponses au sondage (une fois activé)                                                                                                | Décider si le jeu est assez fun et stable pour continuer à le développer                                                                                   | Ton consentement (art. 6(1)(a)), que tu peux retirer dans les Réglages                                                    |
| E-mail du journal de partie (une fois activé)                                                                                                                       | Reproduire et corriger le bug que tu signales                                                                                                              | Notre intérêt légitime à corriger les bugs que tu signales toi-même (art. 6(1)(f))                                        |
| Téléchargement des réglages (une fois activé)                                                                                                                       | Activer ou désactiver des fonctions en sécurité                                                                                                            | Notre intérêt légitime à faire fonctionner l'app en sécurité (art. 6(1)(f))                                               |
| Notes de debrief                                                                                                                                                    | Comprendre ce qui t'a plu ou déplu                                                                                                                         | Ton consentement (art. 6(1)(a))                                                                                           |

Nous n'utilisons rien de tout cela pour de la publicité, nous ne le vendons jamais, nous ne l'utilisons pas pour
évaluer des salariés, et nous ne prenons aucune décision automatisée te concernant.

### 5. Durée de conservation

| Données                                                             | Durée                                                                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal de partie et instantané sur ton téléphone                   | Uniquement la partie en cours et la dernière partie terminée                                                                                                                      |
| Liste « Nouveaux pour toi » et choix d'animations sur ton téléphone | Jusqu'à ce que tu désinstalles l'app ou effaces ses données                                                                                                                       |
| Événements de test sur ton téléphone (une fois activé)              | Jusqu'à ce que tu confirmes leur envoi, et 30 jours au plus (5 000 événements au plus, les plus anciens supprimés d'abord) ; supprimés aussitôt si tu désactives l'enregistrement |
| Identifiant testeur sur ton téléphone (une fois activé)             | Jusqu'à ce que tu désactives l'enregistrement ou désinstalles l'app                                                                                                               |
| Choix d'enregistrement sur ton téléphone (une fois activé)          | Jusqu'à ce que tu désinstalles l'app ou effaces ses données                                                                                                                       |
| Compteurs du sondage sur ton téléphone (une fois activé)            | Gardés quand tu désactives l'enregistrement ; supprimés quand tu désinstalles l'app ou effaces ses données. Jamais envoyés                                                        |
| E-mails envoyés à notre boîte (une fois activé)                     | Les pièces jointes sont déplacées vers un stockage restreint (Google Drive) sous 7 jours, puis les e-mails sont supprimés                                                         |
| La copie dans tes propres « messages envoyés »                      | Hors de notre contrôle : ton fournisseur de messagerie la garde jusqu'à ce que tu la supprimes                                                                                    |
| Fichiers de test et journaux de partie reçus                        | Supprimés 6 mois après la fin du playtest. Seuls des totaux anonymes sont conservés                                                                                               |
| Notes de debrief                                                    | Supprimées 6 mois après la fin du playtest                                                                                                                                        |
| Données d'inscription                                               | 12 mois après la fin du playtest, comme preuve de ton consentement                                                                                                                |

Désinstaller l'app supprime tout ce qu'elle a enregistré sur ton téléphone. Les données de l'app sont exclues des
sauvegardes Android et du transfert d'un appareil à l'autre : elles ne se retrouvent pas dans ta sauvegarde Google.

### 6. Qui peut y accéder

Trois analystes nommément désignés au plus peuvent voir les fichiers reçus. Seule la personne responsable du playtest
voit les données d'inscription. La boîte de réception utilise une connexion à deux facteurs et aucun transfert
automatique.

Prestataires :

- **Google**, qui fournit le formulaire d'inscription (Google Forms), la boîte de réception du playtest (Gmail) et le
  stockage restreint (Google Drive), sur le compte Google personnel de Malick BA.
- **Expo (EAS, de 650 Industries)**, qui compile et héberge le fichier de l'app et sert le lien d'installation privé.
  Expo traite les données de téléchargement selon sa propre politique de confidentialité.
- **Ton propre fournisseur de messagerie**, quand tu choisis d'envoyer un fichier (une fois activé). C'est toi qui le
  choisis ; ses conditions s'appliquent.

Il n'y a aucun autre tiers.

### 7. Lieu de stockage

Nous ne stockons pas tes données dans l'UE, ni dans un pays unique que nous aurions choisi. Les données que nous
recevons (réponses d'inscription, e-mails et fichiers) sont conservées dans le compte Google personnel (grand public)
de Malick BA : Gmail, Google Forms et Google Drive. Google peut les stocker et les traiter dans plusieurs pays, dont
les États-Unis, selon ses propres conditions et ses engagements en matière de transfert de données. T'inscrire ou nous
envoyer un fichier peut donc transférer tes données hors de ton pays. Expo, qui sert le téléchargement de l'app, est
établie aux États-Unis.

### 8. Tes droits

Tu peux demander à **accéder** à tes données, à les **rectifier** ou à les **supprimer**, à en **limiter** l'usage, à
t'**opposer** aux usages fondés sur notre intérêt légitime, et à les recevoir dans un format portable. Quand nous nous
appuyons sur ton consentement, tu peux le **retirer** à tout moment ; cela ne remet pas en cause ce qui a été fait
avant.

Comment :

- **Données sur ton téléphone :** désactive « Enregistrer les statistiques de test » (une fois activé) ou désinstalle
  l'app. Nous n'en avons pas de copie. Les compteurs du sondage et tes réglages partent quand tu désinstalles l'app ou
  effaces ses données.
- **Données que tu nous as envoyées :** écris à titanfst00@gmail.com. Pour les données de test, donne-nous ton
  identifiant testeur (affiché dans les Réglages). Pour les journaux de partie, écris depuis l'adresse utilisée pour
  les envoyer. Nous supprimons les fichiers correspondants.
- **Quitter le playtest :** écris à titanfst00@gmail.com ; nous te retirons de la liste, sauf la preuve de ton
  consentement que nous devons conserver.

Nous répondons sous un mois. Tu peux aussi saisir une autorité de protection des données : la CNIL en France, la CDP
(Commission de protection des données personnelles) au Sénégal, ou l'autorité de ton pays.

### 9. Sécurité

Les fichiers enregistrés sur ton téléphone sont dans le stockage privé de l'app. Les fichiers que tu envoies ne
contiennent que ce qui est listé plus haut. De notre côté, l'accès est limité à des personnes nommément désignées, et
les fichiers reçus sont contrôlés comme des données non fiables avant d'être ouverts.

### 10. Modifications

Nous préviendrons les testeurs par e-mail avant tout changement qui touche à ce que nous collectons, et nous mettrons
à jour la version et la date ci-dessous. Une version publique de CODELEX aura une nouvelle politique.

**Ce qui change dans la v1.2 (2026-10-16) par rapport à la v1.1 (2026-10-07) :**

- La section 7 et « En bref » disent clairement que nous ne stockons pas tes données dans l'UE : elles sont dans le
  compte Google personnel de Malick BA, qui peut utiliser plusieurs pays dont les États-Unis. Un ancien projet de
  formulaire de consentement disait « Les données sont stockées dans l'UE » ; c'était faux, et il est remplacé par le
  formulaire de consentement v1.1.
- La section 3.6 liste tout ce que le fichier de données de test peut contenir : l'en-tête du fichier et chaque
  événement, y compris les premières étapes, les boutons du résumé, la navigation dans le graphe, les fermetures du
  sondage et les compteurs d'envoi.
- Section 3.5 : quand l'enregistrement est activé, les événements portent le code de langue et de région de ton
  téléphone.
- Nouvelle section 3.7 « Rappel du sondage » et sa ligne de durée de conservation.
- Section 3.8 : le contenu du journal de partie en détail.
- Les noms des réglages et des boutons correspondent maintenant à l'app (« Enregistrer les statistiques de test »,
  « Envoyer les données de test », « Ton identifiant testeur »).
- Ton identifiant testeur change aussi quand tu désactives puis réactives l'enregistrement.
- Nouvelles lignes de conservation : identifiant testeur, choix d'enregistrement, copie dans tes « messages envoyés ».
- Nouvelle section 3.12 sur la version « CODELEX Diagnostics » réservée au propriétaire.

Quand la v1.2 a été publiée, le seul testeur était Malick BA lui-même : personne d'autre n'avait à être informé à
nouveau. Toute personne qui rejoint le playtest plus tard lit cette version et le formulaire de consentement v1.1
avant de s'inscrire.

Version playtest-privacy-v1.2 · 2026-10-16 · Contact : titanfst00@gmail.com
