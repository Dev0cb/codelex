<!--
=====================================================================================================================
OWNER-FILLED PLACEHOLDERS — the product owner must replace every one of these before publication.
They appear verbatim in this file and in site/privacy/index.html and site/privacy/fr/index.html.

  [CONTROLLER_NAME]   Legal name (and postal address) of the entity or person responsible for the playtest data.
                      Do not publish until a real controller is named. No legal entity is assumed here.
  [CONTACT_EMAIL]     Privacy contact address (requests for access, deletion, objection, withdrawal).
  [PLAYTEST_MAILBOX]  The fixed EU-hosted address that "Send playtest data" and "Send match log" suggest (spec Q-1,
                      threat model TM-07). Only needed once slice S6 ships; keep the placeholder until then.
  [EU_PROVIDER]       Name of the EU-hosted provider for the enrollment form, the playtest mailbox and the restricted
                      storage (playtest plan §1.3, spec Q-1).
=====================================================================================================================
-->

# CODELEX privacy policy (Phase 1 Android playtest)

- Document: `docs/legal/privacy-policy.md` · Owner: `privacy-compliance` · Approver: product owner + counsel
- Version: **playtest-privacy-v1.0** · Date: **2026-10-06**
- Published copies: `site/privacy/index.html` (EN, <https://dev0cb.github.io/codelex/privacy/>) and
  `site/privacy/fr/index.html` (FR, <https://dev0cb.github.io/codelex/privacy/fr/>).
- **Sync rule.** This file is the source of truth. The two HTML pages are kept in sync by hand with it: any change
  here changes both pages in the same PR, with the same version and date. The HTML pages carry the version string
  `playtest-privacy-v1.0` so a reviewer can check them with
  `grep -c "playtest-privacy-v1.0" docs/legal/privacy-policy.md site/privacy/index.html site/privacy/fr/index.html`.
- Facts used: `docs/compliance/DATA_MAP.md`, `docs/standards/ANALYTICS_EVENTS.md` (client-local playtest events),
  `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.md` (AC-10, AC-11, AC-17, AC-19, AC-20, privacy notes, Q-1, Q-2,
  Q-7), `docs/specs/E-1.5-play-vs-bot/playtest-plan.md` (§1.3 roster, §2 consent text),
  `docs/security/threat-models/e-1.5-s1-persistence-match-log.md` (TM-03, TM-04, TM-05, TM-06, §8),
  `apps/mobile` (persistence under `DATA_DIR`, backup exclusion).
- Re-review this policy before: slice S6 ships (analytics, match-log export, remote config), any iOS build, any
  closed or public track, accounts (E-2.1), any backend or SDK.

## Reviewer notes (not published)

`LEGAL_REVIEW_REQUIRED` items. They are not shown on the public pages; counsel must clear them before Stage 1:

1. Legal basis for the match-log email: this policy states legitimate interest (Art. 6(1)(f)) because the export must
   stay available with analytics consent off (TM-05, TM-06). DATA_MAP's mailbox row says "consent". Counsel picks one.
2. Senegal → EU transfer: legal ground and whether a prior declaration to the CDP is required (Law 2008-12).
3. Validity of employee consent (team testers).
4. Retention periods (30 days on device, 7 days mailbox, 6 months raw files, playtest end + 12 months roster).
5. Whether the controller needs a postal address and an EU representative on this page.
6. Remote config (AC-19, S6): the host is not chosen. Before the fetch is turned on, name the host here and confirm it
   receives no identifier other than the IP address.
7. The consent form (`playtest-plan.md` §2) still names Apple TestFlight. The playtest is now Android only; align the
   form with this policy (or the reverse if iOS returns).

## English

### In short

- CODELEX is a word game about technology. This policy covers the **Phase 1 playtest** of the Android app
  (`com.codelex.app`) and the sign-up form for that playtest. It is not the policy of a public release.
- The playtest is for **adults (18+) who were invited** through the sign-up form. The app is shared through an
  internal Google Play testing link only.
- **Today, nothing leaves your phone.** The app has no account, no server, no ads, no analytics service and no crash
  reporting service. Your matches are saved on your phone so you can resume them.
- **When the next update ships** (marked "when enabled" below), you will be able to send two files yourself, by
  email, with a tap: your playtest data (if the "Playtest data" setting is on) and a match log for bug reports.
  Nothing is ever sent automatically.

### 1. Who is responsible

[CONTROLLER_NAME] is the controller of the personal data described here. Contact for any privacy question or
request: [CONTACT_EMAIL].

### 2. Who can take part

You must be **18 or older** to take part. You confirm it when you sign up. The app is not meant for children. It is
not directed to children under 13 and we do not knowingly collect data from anyone under 18. If you are under 18,
please do not install the app. If we learn that someone under 18 took part, we remove them from the playtest and
delete the data we hold about them. If you think this happened, write to [CONTACT_EMAIL].

The app has no age check of its own, because it is only shared with the invited roster. A public version will have an
age check before it is released.

### 3. What we collect, feature by feature

#### 3.1 Signing up for the playtest (now)

Through the sign-up form, we collect: your name, your email address (the Google account email we use to invite you to
the test track), a yes/no confirmation that you are 18 or older (not your birth date), your country, your preferred
language (English or French), your phone type (Android standard or entry-level), whether you work in software,
whether you want a debrief call, and the version and date of the consent you gave.

This list is kept apart from the game data. We never write the app's random identifier into it.

#### 3.2 Getting the app through Google Play (now)

Google delivers the app through its internal testing track using your Google account. Google Play shows us
aggregated statistics about installs, crashes and app stability. Google's own privacy policy applies to your Google
account and to the data Google collects through Google Play.

#### 3.3 Playing and resuming a match (now; stays on your phone)

To let you pick up a match where you left it, the app saves on your phone:

- the **match log**: the moves played, the random seed of the match, the game and word-list versions, and check
  values used to detect a damaged file. It contains no time stamp, no identifier and nothing about you;
- a **snapshot** of the match, to resume faster;
- a small **resume-safety counter**, so that a damaged save shows a "start a new match" card instead of crashing.

Only the match in progress and the last finished match are kept. Older ones are deleted automatically.

#### 3.4 "New to you" (now; stays on your phone)

After a match, the summary shows how many terms you played for the first time on this phone. For this, the app keeps
on your phone the list of terms you have played (word ids only; no time, no identifier, nothing about the opponent).

#### 3.5 Language (now; stays on your phone)

The app reads your phone's language setting to show English or French. It does not store or send it.

#### 3.6 Playtest data (when enabled)

A "Playtest data" setting will appear in Settings. It is **on by default**, because you agreed to it when you signed
up; you can switch it off at any time. While it is on, the app records game events **on your phone**:

- a random identifier created on your phone (shown in Settings; a new one is created if you reinstall the app);
- for each event: an event id, the time on your phone's clock, a session id, the app version, the platform
  (Android), the app language and a format version;
- app opens (start-up time, type of network connection such as Wi-Fi, mobile or none, and whether the previous
  session ended in a crash) and time spent in the app;
- matches started, finished, abandoned and resumed: opponent level, who played first, result, scores, how the match
  ended, number of turns, words, passes and exchanges, and match duration;
- the terms played by you and by the bot (word ids, category, difficulty, points) and how long you thought;
- rejected attempts: only the reason and the word length, **never the letters you tried**;
- the bot's thinking time and effort, in coarse ranges;
- Knowledge Cards opened and how long you read them;
- your answer to the "Would you play CODELEX again?" question;
- how many events were sent or dropped.

It does not include your name, email, location, contacts, advertising ID, device model, phone number or any text you
type.

These events **leave your phone only when you tap "Send playtest data"**. Your phone's share menu opens, and you choose
to email the file to [PLAYTEST_MAILBOX]. Because the email shows your address, the file can then be linked to you.

If you switch the setting off, nothing more is recorded and the events still on your phone are deleted.

#### 3.7 Send match log (when enabled)

For bug reports, Settings will offer "Send match log". It shares the match in progress (or the last finished one) as a
file with: the moves, the seed, the game and word-list versions, the check values, the app version and build number,
and the platform. It contains **no identifier, no time stamp and no device details**, and it does not include the
random identifier of section 3.6. It works even when "Playtest data" is off.

You send it yourself by email to [PLAYTEST_MAILBOX]. The team then sees your email address and anything your email
app adds (such as your display name and the sending time).

#### 3.8 Settings download (when enabled)

When your phone is online, the app will download a small settings file in the background, used to switch features on
or off without a new version (for example, to pause a feature that has a bug). The request carries no identifier
from the app. Like any internet request, it shows your IP address to the server that hosts the file. We will name
that server in this policy before this feature is turned on.

#### 3.9 Debrief calls (only if you opt in)

If you join a debrief call, the interviewer takes notes without your name. We do not record audio or video.

#### 3.10 What we never collect

No account or password, no location, no contacts, no photos, no microphone, no advertising ID, no device model or
serial numbers, no payment data, no text you type. The app shows no ads and contains no analytics, advertising or
crash-reporting software from other companies.

### 4. Why we use it, and on what legal basis

| What                                                                 | Why                                                                       | Legal basis (GDPR)                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sign-up details                                                      | Check eligibility, invite you, contact you, keep a record of your consent | Your consent (Art. 6(1)(a)); keeping the record of consent: legal obligation (Art. 6(1)(c), Art. 7(1))  |
| Match log, snapshot, resume counter, "New to you" list on your phone | Let you resume matches and show the summary. We never receive them        | Storing them on your phone is strictly necessary for the feature you use (ePrivacy Directive Art. 5(3)) |
| Google Play statistics                                               | See whether the app is stable                                             | Our legitimate interest in shipping a stable app (Art. 6(1)(f))                                         |
| Playtest data (when enabled)                                         | Decide whether the game is fun and stable enough to keep building         | Your consent (Art. 6(1)(a)), which you can withdraw in Settings                                         |
| Match log email (when enabled)                                       | Reproduce and fix the bug you report                                      | Our legitimate interest in fixing bugs you report yourself (Art. 6(1)(f))                               |
| Settings download (when enabled)                                     | Switch features on or off safely                                          | Our legitimate interest in running the app safely (Art. 6(1)(f))                                        |
| Debrief notes                                                        | Understand what you liked and disliked                                    | Your consent (Art. 6(1)(a))                                                                             |

We do not use any of this for advertising, we never sell it, we do not use it to evaluate employees, and we make no
automated decisions about you.

### 5. How long we keep it

| Data                                         | How long                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match log and snapshot on your phone         | The match in progress and the last finished match only                                                                                            |
| "New to you" list on your phone              | Until you uninstall the app or clear its data                                                                                                     |
| Playtest events on your phone (when enabled) | Until you confirm they were sent, and at most 30 days (at most 5,000 events, oldest dropped first); deleted at once if you switch the setting off |
| Emails to [PLAYTEST_MAILBOX] (when enabled)  | Attachments are moved to restricted storage in the EU within 7 days, then the emails are deleted                                                  |
| Received playtest files and match logs       | Deleted 6 months after the playtest ends. Only anonymous totals are kept                                                                          |
| Debrief notes                                | Deleted 6 months after the playtest ends                                                                                                          |
| Sign-up details                              | 12 months after the playtest ends, as a record of your consent                                                                                    |

Uninstalling the app deletes everything it stored on your phone. The app's data is excluded from Android backups and
from device-to-device transfer, so it does not end up in your Google backup.

### 6. Who can see it

At most three named analysts can see the received files. Only the playtest lead can see the sign-up details. The
mailbox uses two-factor sign-in and no automatic forwarding.

Service providers:

- **Google** (Google Play internal testing and its statistics), under its own terms for your Google account.
- **[EU_PROVIDER]**, which hosts the sign-up form, the playtest mailbox and the restricted storage in the EU.
- **Your own email provider**, when you choose to send a file (when enabled). You choose it; its terms apply.

There is no other third party.

### 7. Where it is stored

Data we receive is stored in the European Union. If you live outside the EU (for example in Senegal), sending us a
file or signing up transfers your data to the EU. Google may process data in other countries under its own terms.

### 8. Your rights

You can ask to **access**, **correct** or **delete** your data, to **restrict** its use, to **object** to uses based on
our legitimate interest, and to receive it in a portable format. Where we rely on your consent, you can **withdraw** it
at any time; this does not affect what was done before.

How:

- **Data on your phone:** switch off "Playtest data" (when enabled), or uninstall the app. We have no copy of it.
- **Data you sent us:** write to [CONTACT_EMAIL]. For playtest data, give us the identifier shown in Settings. For
  match logs, write from the address you sent them from. We delete the matching files.
- **Leaving the playtest:** write to [CONTACT_EMAIL]; we remove you from the roster, except the record of your consent
  that we must keep.

We answer within one month. You can also complain to a data protection authority: the CNIL in France, the CDP
(Commission de protection des données personnelles) in Senegal, or the authority where you live.

### 9. Security

Saved files on your phone sit in the app's private storage. Files you send contain only what is listed above. On our
side, access is limited to named people, and received files are checked as untrusted input before anyone opens them.

### 10. Changes

We will tell testers by email before any change that affects what we collect, and we will update the version and date
below. A public release of CODELEX will come with a new policy.

Version playtest-privacy-v1.0 · 2026-10-06 · Contact: [CONTACT_EMAIL]

## Français

### En bref

- CODELEX est un jeu de mots autour de la technologie. Cette politique couvre le **playtest de la phase 1** de l'app
  Android (`com.codelex.app`) et le formulaire d'inscription à ce playtest. Ce n'est pas la politique d'une version
  publique.
- Le playtest est réservé aux **adultes (18 ans et plus) invités** via le formulaire d'inscription. L'app est diffusée
  uniquement par un lien de test interne Google Play.
- **Aujourd'hui, rien ne quitte ton téléphone.** L'app n'a ni compte, ni serveur, ni publicité, ni service de mesure
  d'audience, ni service de rapport de plantage. Tes parties sont enregistrées sur ton téléphone pour que tu puisses
  les reprendre.
- **Avec la prochaine mise à jour** (marquée « une fois activé » ci-dessous), tu pourras envoyer toi-même deux
  fichiers par e-mail, d'un geste : tes données de playtest (si le réglage « Données de playtest » est activé) et un
  journal de partie pour signaler un bug. Rien n'est jamais envoyé automatiquement.

### 1. Responsable du traitement

[CONTROLLER_NAME] est responsable du traitement des données personnelles décrites ici. Contact pour toute question
ou demande : [CONTACT_EMAIL].

### 2. Qui peut participer

Tu dois avoir **18 ans ou plus** pour participer. Tu le confirmes à l'inscription. L'app n'est pas destinée aux
enfants. Elle ne s'adresse pas aux moins de 13 ans et nous ne collectons pas sciemment de données sur des personnes de
moins de 18 ans. Si tu as moins de 18 ans, n'installe pas l'app. Si nous apprenons qu'une personne mineure a
participé, nous la retirons du playtest et supprimons les données que nous détenons sur elle. Si tu penses que c'est
le cas, écris à [CONTACT_EMAIL].

L'app n'a pas de contrôle d'âge intégré, car elle n'est partagée qu'avec la liste des personnes invitées. Une version
publique aura un contrôle d'âge avant sa sortie.

### 3. Ce que nous collectons, fonction par fonction

#### 3.1 Inscription au playtest (maintenant)

Via le formulaire d'inscription, nous collectons : ton nom, ton adresse e-mail (celle de ton compte Google, utilisée
pour t'inviter sur la piste de test), une confirmation oui/non que tu as 18 ans ou plus (pas ta date de naissance),
ton pays, ta langue préférée (anglais ou français), ton type de téléphone (Android standard ou d'entrée de gamme), si
tu travailles dans le logiciel, si tu souhaites un entretien de debrief, et la version et la date du consentement
donné.

Cette liste est conservée à part des données de jeu. Nous n'y inscrivons jamais l'identifiant aléatoire de l'app.

#### 3.2 Obtenir l'app via Google Play (maintenant)

Google distribue l'app via sa piste de test interne, avec ton compte Google. Google Play nous montre des statistiques
agrégées sur les installations, les plantages et la stabilité de l'app. La politique de confidentialité de Google
s'applique à ton compte Google et aux données que Google collecte via Google Play.

#### 3.3 Jouer et reprendre une partie (maintenant ; reste sur ton téléphone)

Pour te permettre de reprendre une partie là où tu l'as laissée, l'app enregistre sur ton téléphone :

- le **journal de partie** : les coups joués, la graine aléatoire de la partie, les versions du jeu et de la liste de
  mots, et des valeurs de contrôle qui servent à détecter un fichier abîmé. Il ne contient ni horodatage, ni
  identifiant, ni rien sur toi ;
- un **instantané** de la partie, pour reprendre plus vite ;
- un petit **compteur de sécurité de reprise**, pour qu'une sauvegarde abîmée affiche une carte « nouvelle partie »
  au lieu de faire planter l'app.

Seules la partie en cours et la dernière partie terminée sont conservées. Les plus anciennes sont supprimées
automatiquement.

#### 3.4 « Nouveaux pour toi » (maintenant ; reste sur ton téléphone)

Après une partie, le résumé indique combien de termes tu as joués pour la première fois sur ce téléphone. Pour cela,
l'app garde sur ton téléphone la liste des termes que tu as joués (identifiants de mots uniquement ; ni heure, ni
identifiant, rien sur l'adversaire).

#### 3.5 Langue (maintenant ; reste sur ton téléphone)

L'app lit la langue de ton téléphone pour s'afficher en anglais ou en français. Elle ne l'enregistre pas et ne
l'envoie pas.

#### 3.6 Données de playtest (une fois activé)

Un réglage « Données de playtest » apparaîtra dans les Réglages. Il est **activé par défaut**, parce que tu l'as
accepté à l'inscription ; tu peux le désactiver à tout moment. Tant qu'il est activé, l'app enregistre des événements
de jeu **sur ton téléphone** :

- un identifiant aléatoire créé sur ton téléphone (affiché dans les Réglages ; un nouveau est créé si tu réinstalles
  l'app) ;
- pour chaque événement : un identifiant d'événement, l'heure de l'horloge de ton téléphone, un identifiant de
  session, la version de l'app, la plateforme (Android), la langue de l'app et une version de format ;
- les ouvertures de l'app (temps de démarrage, type de connexion comme Wi-Fi, mobile ou aucune, et si la session
  précédente s'est terminée par un plantage) et le temps passé dans l'app ;
- les parties commencées, terminées, abandonnées et reprises : niveau de l'adversaire, qui a commencé, résultat,
  scores, façon dont la partie s'est terminée, nombre de tours, de mots, de passes et d'échanges, et durée ;
- les termes joués par toi et par le bot (identifiants de mots, catégorie, difficulté, points) et ton temps de
  réflexion ;
- les tentatives refusées : seulement la raison et la longueur du mot, **jamais les lettres essayées** ;
- le temps et l'effort de réflexion du bot, par tranches larges ;
- les fiches Knowledge Card ouvertes et leur temps de lecture ;
- ta réponse à la question « Rejouerais-tu à CODELEX ? » ;
- le nombre d'événements envoyés ou perdus.

Cela n'inclut ni ton nom, ni ton e-mail, ni ta position, ni tes contacts, ni ton identifiant publicitaire, ni le
modèle de ton téléphone, ni ton numéro, ni aucun texte que tu saisis.

Ces événements **ne quittent ton téléphone que lorsque tu touches « Envoyer les données de playtest »**. Le menu de
partage de ton téléphone s'ouvre et tu choisis d'envoyer le fichier par e-mail à [PLAYTEST_MAILBOX]. Comme l'e-mail
montre ton adresse, le fichier peut alors être relié à toi.

Si tu désactives le réglage, plus rien n'est enregistré et les événements encore présents sur ton téléphone sont
supprimés.

#### 3.7 Envoyer le journal de partie (une fois activé)

Pour signaler un bug, les Réglages proposeront « Envoyer le journal de partie ». Cela partage la partie en cours (ou
la dernière terminée) sous forme d'un fichier contenant : les coups, la graine, les versions du jeu et de la liste de
mots, les valeurs de contrôle, la version et le numéro de build de l'app, et la plateforme. Il ne contient **ni
identifiant, ni horodatage, ni détail sur l'appareil**, ni l'identifiant aléatoire de la section 3.6. Cela fonctionne
même si « Données de playtest » est désactivé.

Tu l'envoies toi-même par e-mail à [PLAYTEST_MAILBOX]. L'équipe voit alors ton adresse e-mail et ce que ton app de
messagerie ajoute (comme ton nom affiché et l'heure d'envoi).

#### 3.8 Téléchargement des réglages (une fois activé)

Quand ton téléphone est en ligne, l'app téléchargera en arrière-plan un petit fichier de réglages, qui sert à activer
ou désactiver des fonctions sans nouvelle version (par exemple, mettre en pause une fonction qui a un bug). La requête
ne transmet aucun identifiant de l'app. Comme toute requête internet, elle montre ton adresse IP au serveur qui
héberge le fichier. Nous nommerons ce serveur dans cette politique avant d'activer cette fonction.

#### 3.9 Entretiens de debrief (seulement si tu le choisis)

Si tu participes à un entretien de debrief, la personne qui mène l'entretien prend des notes sans ton nom. Nous
n'enregistrons ni audio ni vidéo.

#### 3.10 Ce que nous ne collectons jamais

Ni compte ni mot de passe, ni position, ni contacts, ni photos, ni micro, ni identifiant publicitaire, ni modèle ou
numéro de série de l'appareil, ni données de paiement, ni texte saisi. L'app n'affiche pas de publicité et ne contient
aucun logiciel de mesure d'audience, de publicité ou de rapport de plantage d'une autre entreprise.

### 4. Pourquoi nous les utilisons, et sur quelle base légale

| Quoi                                                                                              | Pourquoi                                                                                 | Base légale (RGPD)                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Données d'inscription                                                                             | Vérifier l'éligibilité, t'inviter, te contacter, garder la preuve de ton consentement    | Ton consentement (art. 6(1)(a)) ; conservation de la preuve du consentement : obligation légale (art. 6(1)(c), art. 7(1)) |
| Journal de partie, instantané, compteur de reprise, liste « Nouveaux pour toi » sur ton téléphone | Te permettre de reprendre tes parties et afficher le résumé. Nous ne les recevons jamais | Leur stockage sur ton téléphone est strictement nécessaire à la fonction que tu utilises (directive ePrivacy, art. 5(3))  |
| Statistiques Google Play                                                                          | Vérifier que l'app est stable                                                            | Notre intérêt légitime à livrer une app stable (art. 6(1)(f))                                                             |
| Données de playtest (une fois activé)                                                             | Décider si le jeu est assez fun et stable pour continuer à le développer                 | Ton consentement (art. 6(1)(a)), que tu peux retirer dans les Réglages                                                    |
| E-mail du journal de partie (une fois activé)                                                     | Reproduire et corriger le bug que tu signales                                            | Notre intérêt légitime à corriger les bugs que tu signales toi-même (art. 6(1)(f))                                        |
| Téléchargement des réglages (une fois activé)                                                     | Activer ou désactiver des fonctions en sécurité                                          | Notre intérêt légitime à faire fonctionner l'app en sécurité (art. 6(1)(f))                                               |
| Notes de debrief                                                                                  | Comprendre ce qui t'a plu ou déplu                                                       | Ton consentement (art. 6(1)(a))                                                                                           |

Nous n'utilisons rien de tout cela pour de la publicité, nous ne le vendons jamais, nous ne l'utilisons pas pour
évaluer des salariés, et nous ne prenons aucune décision automatisée te concernant.

### 5. Durée de conservation

| Données                                                    | Durée                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal de partie et instantané sur ton téléphone          | Uniquement la partie en cours et la dernière partie terminée                                                                                                                |
| Liste « Nouveaux pour toi » sur ton téléphone              | Jusqu'à ce que tu désinstalles l'app ou effaces ses données                                                                                                                 |
| Événements de playtest sur ton téléphone (une fois activé) | Jusqu'à ce que tu confirmes leur envoi, et 30 jours au plus (5 000 événements au plus, les plus anciens supprimés d'abord) ; supprimés aussitôt si tu désactives le réglage |
| E-mails envoyés à [PLAYTEST_MAILBOX] (une fois activé)     | Les pièces jointes sont déplacées vers un stockage restreint dans l'UE sous 7 jours, puis les e-mails sont supprimés                                                        |
| Fichiers de playtest et journaux de partie reçus           | Supprimés 6 mois après la fin du playtest. Seuls des totaux anonymes sont conservés                                                                                         |
| Notes de debrief                                           | Supprimées 6 mois après la fin du playtest                                                                                                                                  |
| Données d'inscription                                      | 12 mois après la fin du playtest, comme preuve de ton consentement                                                                                                          |

Désinstaller l'app supprime tout ce qu'elle a enregistré sur ton téléphone. Les données de l'app sont exclues des
sauvegardes Android et du transfert d'un appareil à l'autre : elles ne se retrouvent pas dans ta sauvegarde Google.

### 6. Qui peut y accéder

Trois analystes nommément désignés au plus peuvent voir les fichiers reçus. Seule la personne responsable du playtest
voit les données d'inscription. La boîte de réception utilise une connexion à deux facteurs et aucun transfert
automatique.

Prestataires :

- **Google** (piste de test interne Google Play et ses statistiques), selon ses propres conditions pour ton compte
  Google.
- **[EU_PROVIDER]**, qui héberge dans l'UE le formulaire d'inscription, la boîte de réception du playtest et le
  stockage restreint.
- **Ton propre fournisseur de messagerie**, quand tu choisis d'envoyer un fichier (une fois activé). C'est toi qui le
  choisis ; ses conditions s'appliquent.

Il n'y a aucun autre tiers.

### 7. Lieu de stockage

Les données que nous recevons sont stockées dans l'Union européenne. Si tu vis hors de l'UE (par exemple au Sénégal),
t'inscrire ou nous envoyer un fichier transfère tes données vers l'UE. Google peut traiter des données dans d'autres
pays selon ses propres conditions.

### 8. Tes droits

Tu peux demander à **accéder** à tes données, à les **rectifier** ou à les **supprimer**, à en **limiter** l'usage, à
t'**opposer** aux usages fondés sur notre intérêt légitime, et à les recevoir dans un format portable. Quand nous nous
appuyons sur ton consentement, tu peux le **retirer** à tout moment ; cela ne remet pas en cause ce qui a été fait
avant.

Comment :

- **Données sur ton téléphone :** désactive « Données de playtest » (une fois activé) ou désinstalle l'app. Nous n'en
  avons pas de copie.
- **Données que tu nous as envoyées :** écris à [CONTACT_EMAIL]. Pour les données de playtest, donne-nous
  l'identifiant affiché dans les Réglages. Pour les journaux de partie, écris depuis l'adresse utilisée pour les
  envoyer. Nous supprimons les fichiers correspondants.
- **Quitter le playtest :** écris à [CONTACT_EMAIL] ; nous te retirons de la liste, sauf la preuve de ton
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

Version playtest-privacy-v1.0 · 2026-10-06 · Contact : [CONTACT_EMAIL]
