# Phase 1 internal playtest — lead-time plan

- Epic: E-1.5 (feeds the Phase 1 exit readout) · Sprint task: T2 (`docs/sprints/2026-10-03-phase1-bots-app-foundation.md`)
- Owner: product-strategist · Co-owners: privacy-compliance (consent), mobile-engineer (distribution), data-analyst
  (readout) · Status: Draft for review · Last update: 2026-10-16 (privacy-compliance: consent form v1.1 matching
  privacy policy v1.2, Google storage instead of "EU", owner decision of 2026-10-16 in §2). Previous: 2026-10-07
  (sprint 4 SP2: S6a–S6d slice names, AC-19 remote config as a Stage 1 gate, crash-free sources without a crash SDK,
  H1 device class; parent spec "Amendment SP2")
- Parent spec: `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.md` (its Decisions section is binding here: no
  backend, tester-triggered export, no crash SDK in all of Phase 1 (Q-15), adult cohort, written consent at
  enrollment). Nothing in this plan
  changes product scope; it prepares everything that has lead time so Stage 1 can start the day its gates are met.

## 0. What this plan must deliver (ROADMAP Phase 1 exit)

| Exit criterion         | Target                                             | Measured from                                                           | Section      |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- | ------------ |
| Internal playtest size | ≥ 30 players (= installs with ≥ 1 completed match) | `bot_match_finished` in exports, cross-checked with store tester counts | §1, §4       |
| Median session length  | ≥ 8 min (foreground time)                          | session envelope in exports                                             | §4           |
| "Would play again"     | ≥ 70 % Yes                                         | one-tap survey (last answer per install) + debrief                      | §4, §4.6     |
| Crash-free sessions    | ≥ 99.5 %, iOS and Android separately               | TestFlight / Play Console + local unclean-exit flag                     | §4           |
| First-player win rate  | ≤ 52 %                                             | E-1.3 simulator (B2), not this playtest                                 | out of scope |

Crash-free sources (parent spec Q-15, 2026-10-07): the local unclean-exit flag `app_opened.previous_exit_unclean`
(slice S6a) is the primary source; Play vitals are added once the Play organisation account exists, and TestFlight
crash statistics on iOS when available. No crash SDK is added in Phase 1.

Stage 1 starts on **gates, not dates** (§5): lexicon batch 3 (E-1.7, ≥ 2,000 forms, ≥ 30 two-letter) merged and
bundled, Strategist bot shipped (E-1.3), Stage 0 dogfood gate passed, legal review closed.

## 1. Enrollment

### 1.1 Cohort targets

| Quota                                                       | Target (enrolled) | Floor (active at readout)     | Why                                                            |
| ----------------------------------------------------------- | ----------------- | ----------------------------- | -------------------------------------------------------------- |
| Total                                                       | 40                | ≥ 30 with ≥ 1 completed match | ASSUMPTION: ~25 % attrition between enrollment and first match |
| Adults only                                                 | 100 %             | 100 %                         | Q-2; no age gate in the build                                  |
| Low-end Android (Android 10+, 2–3 GB RAM, Galaxy A0x class) | ≥ 13              | ≥ 30 % of active              | Design target (CLAUDE.md principle 6)                          |
| FR-locale players                                           | ≥ 15              | ≥ 10                          | Validate FR UI and definitions                                 |
| EN-locale players                                           | ≥ 15              | ≥ 10                          | Validate EN and the A–Z board with non-native EN speakers      |
| Non-engineers (no software job or study)                    | ≥ 14              | ≥ 1/3 of active               | Avoid testing only on experts (R-3, R-7)                       |
| Senegal-based testers                                       | ≥ 10              | ≥ 8                           | Intermittent network, low-end devices, CDP scope               |
| France-based testers                                        | ≥ 10              | ≥ 8                           | FR locale, EU baseline                                         |

Quotas are checked weekly during recruitment (§5). If the low-end Android quota is short at T−7 days, the playtest
lead lends reference devices (ASSUMPTION: 3–5 Galaxy A0x-class phones bought by the company, owned by `qa-engineer`)
rather than lowering the quota.

### 1.2 Recruitment channels

| Channel                          | Target | Expected profile                                | Contact owner                                                                                    | Notes                                                                                                                                             |
| -------------------------------- | ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team (employees, contractors)    | ≤ 8    | engineers, iOS-heavy                            | playtest lead                                                                                    | Capped to keep the cohort non-expert; participation voluntary, no link to performance review (`LEGAL_REVIEW_REQUIRED`: employee consent validity) |
| Friends and family               | ~8     | non-engineers, mixed devices                    | each team member invites ≤ 2                                                                     | Must be adults; the inviter never sees their invitee's data                                                                                       |
| Dakar tech community             | ~12    | developers and students, Android low-end, FR/EN | partnership contact (ASSUMPTION: a named community organiser, to be chosen by the product owner) | Main source for the low-end quota; offer an in-person kickoff, no payment                                                                         |
| French school (higher education) | ~12    | students 18+, FR, Android mid/low-end           | a teacher or student association contact                                                         | Voluntary, never graded, never announced as course work; each student confirms 18+ individually                                                   |

Incentive: none monetary. ASSUMPTION: a thank-you (name in credits only if the tester opts in, and early access to
Phase 2). No incentive may depend on how much someone plays (would bias session length).

### 1.3 Roster (kept minimal)

Stored separately from event data, in the owner's consumer Google account (Google Forms responses and Google Drive;
multi-region, including the United States; not EU-hosted), access: playtest lead only. Retention: playtest end + 12
months (DATA_MAP). Fields:

| Field                                                                                                | Why needed                            | Already in DATA_MAP? |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------- |
| Name                                                                                                 | contact, consent record               | yes                  |
| Email (= Apple ID email for iOS, Google account email for Android)                                   | store invitation, contact, withdrawal | yes                  |
| 18+ confirmation (yes/no, no birth date)                                                             | eligibility                           | yes                  |
| Country (SN / FR / other)                                                                            | quotas, transfer basis                | yes                  |
| Consent version + date                                                                               | proof of consent                      | yes ("consent")      |
| Platform tier: iOS / Android standard / Android low-end (self-reported model, mapped then discarded) | low-end quota, track invite           | **no — add**         |
| Preferred language (EN / FR)                                                                         | quota, debrief language               | **no — add**         |
| Engineer: yes / no                                                                                   | non-engineer quota                    | **no — add**         |
| Debrief opt-in (yes/no)                                                                              | scheduling                            | **no — add**         |

Not collected: birth date, phone number, address, employer, device identifiers, install id. The install id is never
written into the roster; it only reaches us inside a tester's export email (see consent text). ASSUMPTION: the
four new fields are low-sensitivity and fit the existing "eligibility, consent records, contact" purpose;
`privacy-compliance` updates `docs/compliance/DATA_MAP.md` before enrollment opens.

Enrollment form: a Google Form on the owner's consumer Google account (owner fact, 2026-10-07; multi-region including
the United States, no EU data region), linking privacy policy v1.2 and showing consent text v1.1 (§2) before the
fields, one mandatory consent checkbox, no pre-ticked boxes. Platform tier in the form is Android standard / Android
entry-level only (the playtest is Android only; the iOS rows of this plan are kept for a later iOS stage).

## 2. Consent text (EN / FR)

> **Status: v1.1, published with privacy policy `playtest-privacy-v1.2` (2026-10-16). `LEGAL_REVIEW_REQUIRED` items
> are marked inline and still block Stage 1 (any tester other than the owner).** Version: `playtest-consent-v1.1`.
> Labels in quotes are the app's exact strings (`packages/i18n/src/catalogs/en.json`, `fr.json`).

**Owner decision (2026-10-16, product owner Malick BA):** "I am the only tester and the only reader of the privacy
policy for now, so update it where needed." No tester other than the owner enrolled under consent v1, so no
re-information or re-consent is needed. Every future tester reads privacy policy v1.2 and this consent form v1.1
**before enrolling**; consent v1 must not be shown to anyone.

**History.** `playtest-consent-v1` (sprint 3 task T2, superseded 2026-10-16, never shown to a tester other than the owner)
named Apple TestFlight and Google Play, said "Data is stored in the EU" (FR: « Les données sont stockées dans
l'UE ») and "[EU mail and storage provider]", and listed fewer event fields than the app records. Those statements
were wrong for this playtest (Android only, EAS install link, Google consumer account, multi-region including the
US). Full v1 text: git history of this file.

### 2.1 EN

**CODELEX playtest — information and consent** (`playtest-consent-v1.1`)

**Who we are.** Malick BA, an individual, is the controller of your data. Contact: titanfst00@gmail.com. Full privacy
policy (version playtest-privacy-v1.2): <https://dev0cb.github.io/codelex/privacy/>.

**What the playtest is.** You test an early version of the CODELEX game on your own Android phone for about two
weeks. Taking part is voluntary. You must be 18 or older. If you work with us, saying no or stopping has no
consequence for your job or evaluation. `LEGAL_REVIEW_REQUIRED` (employee consent).

**What we collect.**

1. At sign-up (a Google Form): your name, email address, confirmation that you are 18+, country, preferred language,
   phone type (Android standard / Android entry-level), whether you work in software, whether you want a debrief
   call, and the version and date of this consent.
2. Getting the app: we email you a private install link. The app file is hosted by Expo (EAS, United States), whose
   servers see your IP address and device and browser data under Expo's own privacy policy. We receive no install or
   crash statistics.
3. On your phone only, never sent to us: your saved matches (in progress and last finished), the list of terms you
   played, your settings.
4. In the app, only while "Record playtest stats" is on (Settings, section "Playtest data"; on by default; you can
   switch it off at any time): game events stored on your phone and linked to "Your tester ID", a random number made
   by the app (not your name, not your phone's ID). They cover: app opens (connection type, start time, whether the
   previous session ended unexpectedly) and time spent in the app; first-launch steps; matches started, finished,
   dropped and resumed (opponent, who started, scores, result, how it ended, durations and counts); the words you and
   the bot played (term, category, difficulty, points, thinking time); rejected attempts (reason and word length only,
   never the letters); the bot's thinking time and effort in coarse ranges; the buttons you tap after a match;
   Knowledge Cards and graph browsing; whether the "Would you play CODELEX again?" question was shown and your answer
   or that you closed it; how many events were sent or dropped. Each event also carries the time on your phone's
   clock, a session id, the app version, Android, and your phone's language and region code (for example `fr-SN`).
   The file you send adds your tester ID, the export time, the app build and counts of dropped and waiting events.
   No name, email, contacts, location, advertising ID, phone model or text you type.
5. Survey reminder: three small counts on your phone (each 3 or less, no ID, no time, no answer) so the question is
   asked at most twice. They stay on your phone after you switch recording off, until you uninstall the app, and are
   never sent.
6. Nothing leaves your phone automatically. When you tap "Send playtest data", then "Share file…", your phone's share
   menu opens and you choose to email the file to titanfst00@gmail.com. Because the email shows your address, the
   file can then be linked to you.
7. "Send match log" (for bug reports): one file with the moves, seed, versions and check values of one match. No
   tester ID, no time stamp, no device details. It works even when "Record playtest stats" is off. You email it
   yourself; we see your address.
8. If you join a debrief call: the interviewer's notes, without your name. We do not record audio or video.

**Why.** Only to decide whether the game is fun and stable enough to continue development, and to fix bugs you
report. Never for advertising, never sold, never used to evaluate employees.

**Where.** Not in the EU. Everything we receive is kept in Malick BA's personal (consumer) Google account (Google
Forms, Gmail, Google Drive). Google may store it in several countries, including the United States. Expo is in the
United States. So your data may be transferred outside your country, for example from Senegal or France to the
United States. `LEGAL_REVIEW_REQUIRED` (legal ground for the transfer, prior declaration to the CDP under Law
2008-12, Google's role under consumer terms).

**How long.** On your phone: playtest events until you confirm you sent them, at most 30 days; survey counts until
you uninstall the app. Emails: the attachments are moved to restricted Google Drive storage within 7 days, then the
emails are deleted; the copy in your own Sent folder is outside our control. Received files and debrief notes:
deleted 6 months after the playtest ends; only anonymous totals are kept. Sign-up details: kept 12 months after the
playtest ends as a record of your consent. `LEGAL_REVIEW_REQUIRED` (retention periods). Access: at most 3 named
analysts; the playtest lead for sign-up details.

**Service providers.** Google (Forms, Gmail, Drive) and Expo (EAS). Your own email provider when you send a file.

**Your choices and rights.** In Settings, switch off "Record playtest stats" ("Turn off and delete"): nothing more is
recorded, and the unsent events and your tester ID are deleted from your phone (note your tester ID first). To
withdraw completely, email titanfst00@gmail.com: we remove you from the test, and if you give us your tester ID we
delete the playtest data you already sent (for match logs, write from the address you sent them from). You can ask
to access, correct or delete your data at any time, and complain to the CNIL (France), the CDP (Senegal) or the
authority where you live.

☐ I am 18 or older, I have read this information and the privacy policy (v1.2), and I agree to take part in the
CODELEX playtest.

### 2.2 FR

**Playtest CODELEX — information et consentement** (`playtest-consent-v1.1`)

**Qui sommes-nous.** Malick BA, personne physique, est responsable du traitement de tes données. Contact :
titanfst00@gmail.com. Politique de confidentialité complète (version playtest-privacy-v1.2) :
<https://dev0cb.github.io/codelex/privacy/fr/>.

**Le playtest.** Tu testes une première version du jeu CODELEX sur ton propre téléphone Android pendant environ deux
semaines. La participation est volontaire. Tu dois avoir 18 ans ou plus. Si tu travailles avec nous, refuser ou
arrêter n'a aucune conséquence sur ton emploi ni ton évaluation. `LEGAL_REVIEW_REQUIRED` (consentement des salariés).

**Ce que nous collectons.**

1. À l'inscription (un formulaire Google Forms) : nom, adresse e-mail, confirmation d'avoir 18 ans ou plus, pays,
   langue préférée, type de téléphone (Android standard / Android d'entrée de gamme), si tu travailles dans le
   logiciel, si tu souhaites un entretien de debrief, et la version et la date de ce consentement.
2. Obtenir l'app : nous t'envoyons par e-mail un lien d'installation privé. Le fichier de l'app est hébergé par Expo
   (EAS, États-Unis), dont les serveurs voient ton adresse IP et des données sur ton appareil et ton navigateur, selon
   la politique de confidentialité d'Expo. Nous ne recevons aucune statistique d'installation ou de plantage.
3. Uniquement sur ton téléphone, jamais envoyés : tes parties enregistrées (en cours et dernière terminée), la liste
   des termes joués, tes réglages.
4. Dans l'app, uniquement tant que « Enregistrer les statistiques de test » est activé (Réglages, section « Données
   de test » ; activé par défaut ; désactivable à tout moment) : des événements de jeu enregistrés sur ton téléphone
   et liés à « Ton identifiant testeur », un numéro aléatoire créé par l'app (ni ton nom, ni l'identifiant de ton
   téléphone). Ils couvrent : les ouvertures de l'app (type de connexion, durée du démarrage, si la session
   précédente s'est terminée de façon inattendue) et le temps passé dans l'app ; les premières étapes ; les parties
   commencées, terminées, abandonnées et reprises (adversaire, qui a commencé, scores, résultat, façon de finir,
   durées et nombres) ; les mots joués par toi et par le bot (terme, catégorie, difficulté, points, temps de
   réflexion) ; les essais refusés (raison et longueur du mot seulement, jamais les lettres) ; le temps et l'effort de
   réflexion du bot par tranches larges ; les boutons touchés après une partie ; les fiches et la navigation dans le
   graphe ; si la question « Rejouerais-tu à CODELEX ? » a été affichée, et ta réponse ou le fait que tu l'as fermée ;
   le nombre d'événements envoyés ou perdus. Chaque événement porte aussi l'heure de l'horloge de ton téléphone, un
   identifiant de session, la version de l'app, Android, et le code de langue et de région de ton téléphone (par
   exemple `fr-SN`). Le fichier envoyé ajoute ton identifiant testeur, l'heure de l'export, le build de l'app et le
   nombre d'événements perdus ou en attente. Ni nom, ni e-mail, ni contacts, ni position, ni identifiant publicitaire,
   ni modèle de téléphone, ni texte saisi.
5. Rappel du sondage : trois petits compteurs sur ton téléphone (chacun de 3 au plus, sans identifiant, sans heure,
   sans réponse) pour que la question ne soit posée que deux fois au plus. Ils restent sur ton téléphone après la
   désactivation de l'enregistrement, jusqu'à la désinstallation de l'app, et ne sont jamais envoyés.
6. Rien ne quitte ton téléphone automatiquement. Quand tu touches « Envoyer les données de test », puis « Partager le
   fichier… », le menu de partage s'ouvre et tu choisis d'envoyer le fichier par e-mail à titanfst00@gmail.com.
   Comme l'e-mail montre ton adresse, le fichier peut alors être relié à toi.
7. « Envoyer le journal de partie » (pour signaler un bug) : un fichier avec les coups, la graine, les versions et les
   valeurs de contrôle d'une partie. Ni identifiant testeur, ni horodatage, ni détail sur l'appareil. Cela fonctionne
   même si « Enregistrer les statistiques de test » est désactivé. Tu l'envoies toi-même par e-mail ; nous voyons ton
   adresse.
8. Si tu participes à un entretien : les notes de la personne qui le mène, sans ton nom. Aucun enregistrement audio ou
   vidéo.

**Pourquoi.** Uniquement pour décider si le jeu est assez fun et stable pour poursuivre son développement, et pour
corriger les bugs que tu signales. Jamais pour de la publicité, jamais vendu, jamais utilisé pour évaluer des
salariés.

**Où.** Pas dans l'UE. Tout ce que nous recevons est conservé dans le compte Google personnel (grand public) de Malick
BA (Google Forms, Gmail, Google Drive). Google peut le stocker dans plusieurs pays, dont les États-Unis. Expo est aux
États-Unis. Tes données peuvent donc être transférées hors de ton pays, par exemple du Sénégal ou de France vers les
États-Unis. `LEGAL_REVIEW_REQUIRED` (base légale du transfert, déclaration préalable à la CDP selon la loi 2008-12,
rôle de Google sous ses conditions grand public).

**Combien de temps.** Sur ton téléphone : événements de test jusqu'à ce que tu confirmes leur envoi, 30 jours au
plus ; compteurs du sondage jusqu'à la désinstallation de l'app. E-mails : les pièces jointes sont déplacées vers un
stockage Google Drive restreint sous 7 jours, puis les e-mails sont supprimés ; la copie dans tes messages envoyés
est hors de notre contrôle. Fichiers reçus et notes d'entretien : supprimés 6 mois après la fin du playtest ; seuls
des totaux anonymes sont conservés. Données d'inscription : conservées 12 mois après la fin du playtest comme preuve
du consentement. `LEGAL_REVIEW_REQUIRED` (durées). Accès : 3 analystes nommés au maximum ; la personne responsable du
playtest pour l'inscription.

**Prestataires.** Google (Forms, Gmail, Drive) et Expo (EAS). Ton propre fournisseur de messagerie quand tu envoies un
fichier.

**Tes choix et tes droits.** Dans les Réglages, désactive « Enregistrer les statistiques de test » (« Désactiver et
supprimer ») : plus rien n'est enregistré, et les événements non envoyés et ton identifiant testeur sont supprimés de
ton téléphone (note d'abord ton identifiant testeur). Pour te retirer complètement, écris à titanfst00@gmail.com :
nous te retirons du test et, si tu nous donnes ton identifiant testeur, nous supprimons les données de test déjà
envoyées (pour les journaux de partie, écris depuis l'adresse utilisée pour les envoyer). Tu peux demander l'accès,
la rectification ou l'effacement de tes données à tout moment, et saisir la CNIL (France), la CDP (Sénégal) ou
l'autorité de ton pays.

☐ J'ai 18 ans ou plus, j'ai lu ces informations et la politique de confidentialité (v1.2), et j'accepte de participer
au playtest CODELEX.

ASSUMPTION: "tu" in FR, consistent with the in-app tone (parent spec); counsel may require "vous" for a legal text.

## 3. Distribution

### 3.1 Accounts and ownership (needs a human)

| Item                                                                                                                                      | Owner (human)                      | Operator (agent)                   | Lead time                                                    | Notes                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Apple Developer Program, organisation account                                                                                             | product owner (Account Holder)     | mobile-engineer (App Manager role) | ASSUMPTION: 1–3 weeks (D-U-N-S number + Apple verification)  | Org account so the app is not published under a person's name      |
| Google Play Console, organisation account                                                                                                 | product owner                      | mobile-engineer                    | ASSUMPTION: days to 2 weeks (D-U-N-S, identity verification) | One-time fee; the **package name is permanent** once uploaded      |
| Bundle ID / package name                                                                                                                  | product owner decides              | mobile-engineer                    | —                                                            | ASSUMPTION: `com.codelex.app`; irreversible on Play, confirm first |
| Expo / EAS organisation                                                                                                                   | product owner                      | mobile-engineer, devops-sre        | 1 day                                                        | Signing credentials stored in EAS, never in git                    |
| Privacy policy URL (playtest version)                                                                                                     | product owner + privacy-compliance | tech-writer                        | after legal review                                           | Required by TestFlight external testing (Beta App Review)          |
| Playtest mailbox (Gmail `titanfst00@gmail.com`, owner's consumer Google account, multi-region incl. US; MFA, ≤ 3 analysts, no forwarding) | product owner                      | data-analyst                       | 1 day                                                        | Parent spec Q-1; done (owner fact 2026-10-07)                      |
| Enrollment form (Google Forms) + roster storage (Google Drive), same account, multi-region incl. US                                       | playtest lead                      | product-strategist                 | 1 day                                                        | §1.3                                                               |

### 3.2 iOS — TestFlight checklist

- [ ] App record created in App Store Connect (name "CODELEX", bundle ID confirmed).
- [ ] **Internal group** `team`: App Store Connect users only (team members, ≤ 100). No Beta App Review.
- [ ] **External groups** `ext-fr`, `ext-sn`, `ext-ff` (by channel, so invites and reminders are targeted; groups
      are an ops convenience, not an analysis dimension). Invite by email from the roster; **no public link**
      (eligibility must stay checked).
- [ ] Beta App Review submitted with the first Stage 1 build: test notes EN, privacy policy URL, contact; budget
      ASSUMPTION: 1–2 days for the first review, faster for later builds.
- [ ] "What to test" notes per build (EN/FR), including how to send playtest data.
- [ ] Build expiry: TestFlight builds expire after 90 days; the playtest fits in one window.

### 3.3 Android — Google Play internal testing checklist

- [ ] App created in Play Console, internal testing track only (≤ 100 testers, no review). No closed or open
      track: those would trigger the Data safety form and policy review (parent spec, Minors).
- [ ] Tester list = Google account emails from the roster (or a Google Group per channel); opt-in link shared
      privately per tester.
- [ ] App signing by Google Play enabled; upload key in EAS.
- [ ] Android vitals checked on day 1 of Stage 0. ASSUMPTION: at ~20 Android testers vitals may stay under display
      thresholds; the local unclean-exit flag is then the primary crash-free source for Android (§4.4).
- [ ] Fallback for a tester without a Google account: none in Stage 1 (sideloaded APKs lose Play crash data and
      update control); the tester is replaced from the waitlist.

### 3.4 Build cadence

| Stage                           | Cadence                                                                                     | Rule                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Stage 0 (team, 3–5 days)        | as needed, up to daily                                                                      | internal group/track only                                                                       |
| Stage 1 (≥ 30 players, 14 days) | one planned build at day 0 and at most one at day 7; hotfix any time a halt criterion fires | No feature changes during Stage 1 (keeps the readout comparable); tuning via remote config only |
| Version naming                  | `0.1.<build>` with `lexiconVersion` and engine version shown in Settings                    | each build pinned to one `lexiconVersion`                                                       |

Build pipeline: `eas build` → `eas submit` to TestFlight and the Play internal track (owner: mobile-engineer;
devops-sre wires CI). Halt criteria and kill switches are the parent spec's ("Flags & rollout").

Remote config (parent spec AC-19, Q-16): not built for Stage 0. Stage 0 flags come from bundled defaults, so a flag
change or a halt means a new build or expiring the build. "Tuning via remote config only" in Stage 1 therefore
depends on the AC-19 fetch, which is a Stage 1 gate (§5).

## 4. Readout template (for `data-analyst`)

Copy this section into `docs/specs/E-1.5-play-vs-bot/playtest-readout.md` at the end of Stage 1.

### 4.1 Definitions (fixed before data arrives)

| Metric              | Definition                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active tester       | install id with ≥ 1 `bot_match_finished` in exported data                                                                                                                                                                                                                                                                                                                                                      |
| Session             | foreground time between app foreground and background; a session closes after 30 min in background (Q-12). Length = sum of foreground intervals in the session                                                                                                                                                                                                                                                 |
| Median session      | **primary:** median over all sessions of active testers; **secondary:** median of per-tester medians (guards against a few heavy players). Sessions < 10 s reported separately, not excluded. Sessions whose last interval was found open by a cold start (app-switcher swipe, crash) have only a lower-bound length: excluded from median and IQR, and the median is also reported with them plus their count |
| Match completion    | `bot_match_finished` ÷ `bot_match_started`; matches still in progress at export are excluded from both                                                                                                                                                                                                                                                                                                         |
| `score_margin`      | `player_score − bot_score` per finished match (from `bot_match_finished`), reported per bot personality: median, IQR, share of losses by > 100 points                                                                                                                                                                                                                                                          |
| Would play again    | last non-dismissed `playtest_survey_answered` per install; Yes ÷ (Yes + Maybe + No); Wilson 95 % CI. Dismissals reported as a separate rate                                                                                                                                                                                                                                                                    |
| Crash-free sessions | 1 − (sessions containing an unclean exit ÷ sessions), per platform; a crash does not end a session (a relaunch within 30 min continues it, Q-12) and a boot crash with nothing open is a separate zero-length crashed session; sessions whose last interval closed with `app_backgrounded` are clean; a session still open at export is left out; compared with TestFlight / Play Console figures              |
| Export completeness | installs that sent ≥ 1 export ÷ active installs in the stores; < 80 % after week 1 triggers parent spec Q-1 follow-up                                                                                                                                                                                                                                                                                          |

"Per install" caveat (S6b review m3): the survey counters (`survey.state`) survive a consent withdrawal, but turning
consent off then on gives the tester a new install id (`user_id`). The same tester can therefore appear under two ids,
with the survey answered under the first and not asked again under the second. The KR readout de-duplicates "would
play again" through the debrief roster (tester ↔ install ids, from the ids testers read out of Settings) where it can,
and reports the number of testers it could not map.

Readout script (sprint 4 KR): `node tools/readout/cli.mjs [--roster roster.csv] export.json...` computes median session,
would-play-again and crash-free from the exports exactly as defined above (usage, roster CSV format, assumptions in
`tools/readout/README.md`; dry run on a synthetic export in `exit-kpi-readout-dry-run.md`). ASSUMPTION pending owner
confirmation (OQ-SP2-4): an OS kill of a backgrounded app is not a crash; only `previous_exit_unclean` counts.

Dependency for `data-analyst` and `mobile-engineer`: `app_backgrounded { foreground_ms }` and
`app_opened.previous_exit_unclean` (bool) were added to `docs/standards/ANALYTICS_EVENTS.md` in sprint 3 SP1,
together with `bot_match_finished.score_margin` and `bag_count_at_end`. Data-analyst sign-off: given in sprint 4 D1
(OQ-3, answered below).

### 4.2 Headline

| Exit criterion                | Target        | Result | CI / n | Pass? |
| ----------------------------- | ------------- | ------ | ------ | ----- |
| Active testers                | ≥ 30          |        |        |       |
| Median session (all sessions) | ≥ 8 min       |        |        |       |
| Would play again = Yes        | ≥ 70 %        |        |        |       |
| Crash-free iOS / Android      | ≥ 99.5 % each |        |        |       |

Note: with n ≈ 30 the 95 % CI on a proportion is about ± 16 points; a result of 72 % is "consistent with the
target", not proof. The recommendation weighs survey, debrief and behaviour together.

### 4.3 Cohort

Active testers by platform tier, locale, country, engineer/non-engineer; quota met? (§1.1). Attrition from enrolled
to installed to active.

### 4.4 Behaviour and secondary KPIs

Time-to-first-match p50/p90; matches per tester per week; match completion; `score_margin` per personality; human
win rate per personality vs guardrails; resign rate; rejected attempts per turn; Knowledge Card open rate and dwell;
terms discovered per tester per week; play again rate; resume failures; bot response p95 on low-end Android. Each
cut by low-end Android vs other and EN vs FR.

### 4.5 Stability

Crash-free per platform from three sources (TestFlight, Play vitals, unclean-exit flag) with their disagreements
explained; ANR rate; halt criteria fired and actions taken.

### 4.6 Debrief interview guide (≤ 10 questions, 20 min, notes only, pseudonymised)

Two moderated sessions (5–8 testers each; one FR in Dakar or remote, one mixed EN/FR), plus 1:1 calls if needed.

| #   | EN                                                                                            | FR                                                                                                           |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Tell me about the last time you opened CODELEX: where were you, and what made you open it?    | Raconte-moi la dernière fois que tu as ouvert CODELEX : où étais-tu, et qu'est-ce qui t'a donné envie ?      |
| 2   | What was the most satisfying moment you had in a match?                                       | Quel a été ton meilleur moment pendant une partie ?                                                          |
| 3   | What frustrated you most?                                                                     | Qu'est-ce qui t'a le plus frustré·e ?                                                                        |
| 4   | Did a word you expected to be valid get rejected? Which one, if you remember?                 | Un mot que tu pensais valide a-t-il été refusé ? Lequel, si tu t'en souviens ?                               |
| 5   | How did the bots feel: too easy, fair, too hard? Did they feel like an opponent or a machine? | Comment as-tu trouvé les bots : trop faciles, équilibrés, trop forts ? Plutôt un adversaire ou une machine ? |
| 6   | How long did a match feel? When did you stop, and why?                                        | Une partie t'a semblé longue comment ? Quand t'es-tu arrêté·e, et pourquoi ?                                 |
| 7   | Did you open a term card after a match? What made you open it, or not?                        | As-tu ouvert une fiche de terme après une partie ? Pourquoi, ou pourquoi pas ?                               |
| 8   | Did anything feel like homework rather than a game?                                           | Est-ce que quelque chose t'a semblé être un devoir plutôt qu'un jeu ?                                        |
| 9   | Did the app ever crash, freeze, lose your match or feel slow on your phone?                   | L'application a-t-elle planté, gelé, perdu ta partie ou été lente sur ton téléphone ?                        |
| 10  | Would you play CODELEX again next week? What would make it a clear yes?                       | Rejouerais-tu à CODELEX la semaine prochaine ? Qu'est-ce qui en ferait un oui franc ?                        |

Interviewer rules: no names in notes (tester code only), no leading on fun, no recording, quotes kept short.

### 4.7 Recommendation

Go / no-go for Phase 2 by `product-strategist` with the evidence above; top 5 issues with owners; decisions for the
product owner (e.g. Quick Classic 11×11, lexicon gaps, bot tuning).

## 5. Timeline (backwards from Stage 1 day 0 = T)

T is set when **all** gates are true: lexicon batch 3 bundled (≥ 2,000 forms, ≥ 30 two-letter, E-1.6/B2
diagnostics within the game-designer thresholds), Strategist bot merged (E-1.3) and within AC-8 latency on the
reference device, slices S1–S6d behind flags, AC-19 remote config fetch and remote kill switch working (parent spec
Q-16), Stage 0 gate passed, `LEGAL_REVIEW_REQUIRED` items closed, store groups ready. "On the reference device"
means a low-end reference-class phone: an H1 result labelled "owner device" does not meet this gate on its own
(parent spec Q-17). Everything below can start now (2026-10-03), so lead time should never be on the critical path.

| When                     | Item                                                                                                        | Owner                              | Done when                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| Now (week of 2026-10-03) | Start Apple and Google org enrollments (D-U-N-S); decide bundle ID / package name                           | product owner                      | accounts verified                                |
| Now                      | Send consent text, DATA_MAP additions and the three `LEGAL_REVIEW_REQUIRED` items to counsel                | privacy-compliance                 | counsel answer recorded in parent spec Decisions |
| T−5 weeks (or now)       | Name channel contacts (Dakar community organiser, school contact); EAS org created                          | product owner, mobile-engineer     | contacts agreed                                  |
| T−4 weeks                | Catalogue additions (`app_backgrounded`, `previous_exit_unclean`) accepted into ANALYTICS_EVENTS            | data-analyst                       | merged before S6a                                |
| T−4 weeks                | Enrollment form live with consent v1.1 and policy v1.2 (after counsel); recruitment opens                   | product-strategist                 | form live                                        |
| T−3 weeks                | Privacy policy URL published (v1.2 published 2026-10-16); mailbox and restricted Google Drive storage ready | tech-writer, data-analyst          | URLs tested                                      |
| T−2 weeks                | Quota check #1; device loans ordered if low-end Android < 13 enrolled                                       | product-strategist, qa-engineer    | quotas on track                                  |
| T−2 weeks                | TestFlight groups and Play internal tester list loaded from roster                                          | mobile-engineer                    | invites drafted, not sent                        |
| T−10 days                | Stage 0 starts (team dogfood, 3–5 days, internal group/track)                                               | mobile-engineer                    | Stage 0 gate (parent spec)                       |
| T−7 days                 | Roster closed (waitlist kept); debrief slots scheduled for T+8 to T+14                                      | product-strategist                 | ≥ 40 enrolled                                    |
| T−3 days                 | Stage 1 build submitted to Beta App Review; Play internal release prepared                                  | mobile-engineer                    | review passed                                    |
| T                        | Invites sent; kickoff message EN/FR (how to play, how to send data, how to withdraw)                        | product-strategist                 | ≥ 30 installs by T+3                             |
| T+7                      | Export reminder; completeness check (< 80 % → Q-1 follow-up); optional build 2                              | data-analyst                       |                                                  |
| T+8 to T+14              | Debriefs                                                                                                    | product-strategist, ux-ui-designer | notes filed                                      |
| T+14                     | Final export reminder; Stage 1 ends                                                                         | data-analyst                       |                                                  |
| T+21                     | Readout (§4) and go/no-go                                                                                   | data-analyst, product-strategist   | readout merged                                   |
| T+14 + 6 months          | Delete raw event files and debrief notes; T+14 + 12 months: delete roster                                   | data-analyst, playtest lead        | deletion logged                                  |

If gates slip, only the "T−" rows that touch testers (invites, kickoff) move; legal, accounts and tooling stay early.
Recruited testers get a short "we are a bit later than planned" note if T moves by more than 2 weeks.

## 6. Decisions recorded in this plan (reversible)

| Decision                 | Chosen                                                             | Rejected                       | Why                                                            |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| Enrollment target        | 40 for ≥ 30 active                                                 | exactly 30                     | attrition would fail the exit criterion on headcount alone     |
| Low-end shortfall        | lend devices                                                       | lower the quota                | the device target is a product principle                       |
| Roster                   | + platform tier, language, engineer flag, debrief opt-in           | full demographics              | the minimum needed to check quotas                             |
| Debriefs                 | notes only                                                         | audio/video recording          | data minimisation; recordings add retention and consent burden |
| Store tracks             | TestFlight internal + external (email invites), Play internal only | public link, Play closed track | eligibility control; closed track triggers Data safety form    |
| Build changes in Stage 1 | ≤ 1 planned rebuild + hotfixes; tuning via remote config           | weekly feature builds          | comparable data across the 14 days                             |
| Median session           | pooled median primary, per-tester median secondary                 | per-tester only                | matches the ROADMAP wording; secondary catches skew            |

## 7. Open questions

- OQ-1 (product owner): legal entity, privacy contact, mailbox domain, community and school contacts.
- OQ-2 (privacy-compliance + counsel): the three `LEGAL_REVIEW_REQUIRED` items; whether TestFlight per-tester crash
  attribution needs to be mentioned more prominently.
- OQ-3 (data-analyst): accept the two catalogue additions in §4.1 or propose another way to measure foreground time.
  **Answered (sprint 4 D1):** both accepted; session and crash-free reconstruction are written in
  `docs/standards/ANALYTICS_EVENTS.md`, "Data-analyst notes (sprint 4 D1)".
- OQ-4 (mobile-engineer): confirm Android vitals visibility for internal-track builds at ~20 testers.

## Reviews required

`privacy-compliance` (consent text, roster fields, DATA_MAP additions), `data-analyst` (readout definitions,
catalogue additions), `mobile-engineer` (distribution checklists, cadence), `game-designer` (debrief guide, bot and
score_margin cuts). No new service is touched, so no `solution-architect` review.
