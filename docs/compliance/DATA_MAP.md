# Data Map

Owner: `privacy-compliance`. Every personal data field processed by CODELEX. Update in the same PR as the code.

| Field | Context/service | Purpose | Legal basis | Retention | Region | Processors | Access roles |
|---|---|---|---|---|---|---|---|
| user_id (pseudonymous) | identity | account | contract | life of account + 30 d | primary region | cloud provider | services |
| email | identity | login, account recovery | contract | life of account + 30 d | primary region | email provider | support (masked) |
| birth year / age band | identity | age gate, minors protections | legal obligation | life of account | primary region | — | services |
| display name, avatar | identity | public profile | contract | life of account | primary region | CDN | public |
| device identifiers (install id) | identity, integrity | security, anti-fraud | legitimate interest | 12 months | primary region | — | integrity team |
| match history | game | gameplay, replays, rankings | contract | 24 months detailed, aggregates indefinitely | match region | — | services |
| purchase receipts | commerce | entitlements, refunds | contract / legal | 10 years (accounting) | primary region | Apple, Google | finance |
| playtest install UUID + analytics events (E-1.5) | mobile (on device), playtest export | playtest KPIs (Phase 1 exit) | consent | on device ≤ 30 days; raw exported files 6 months after playtest end, aggregates kept | device; received files in Google (Gmail, Drive), consumer terms, multi-region including the US | Google (Gmail, Drive; consumer terms). Outside our control: the tester's own mail provider and the copy in the tester's Sent folder | ≤ 3 named analysts |
| playtest mailbox (sender email + attachments, and anything the tester's mail app adds such as the sender name) | playtest export | receive tester exports | consent | attachments moved to restricted Google Drive storage within 7 days, emails deleted | Google (Gmail, Drive), consumer terms, multi-region including the US | Google (Gmail, Drive; consumer terms). Outside our control: the tester's own mail provider and the copy in the tester's Sent folder | ≤ 3 named analysts |
| playtest enrollment roster (name, email, 18+ confirmation, country, consent version + date, preferred language, platform tier, engineer yes/no, debrief opt-in) | playtest operations | eligibility, quotas, consent records, contact | consent / legal obligation | playtest end + 12 months | EU | [EU_PROVIDER] (form) | playtest lead |
| on-device match data (E-1.5 S3: action log, snapshot, resume guard counter; no time, no identifier) | mobile (on device, `DATA_DIR`, excluded from Android backup and device transfer) | resume (AC-11) | not received by the controller; storage strictly necessary (ePrivacy Art. 5(3) exemption) | in-progress match + last finished match; removed on uninstall | device only | — | none (device owner) |
| "New to you" history (E-1.5 S3: canonical term ids played on this device) | mobile (on device, `DATA_DIR`) | summary count (AC-10) | not received by the controller; strictly necessary (ePrivacy Art. 5(3)) | until uninstall or app data cleared | device only | — | none (device owner) |
| match-log export (E-1.5 S6, TM-04/TM-06: allowlisted file, no install id) + sender email | playtest export by user-initiated email | bug reproduction (AC-20) | legitimate interest, user-initiated request (`LEGAL_REVIEW_REQUIRED`; mailbox row says consent) | same as playtest mailbox row; raw files 6 months after playtest end | Google (Gmail, Drive), consumer terms, multi-region including the US | Google (Gmail, Drive; consumer terms). Outside our control: the sender's own mail provider and the copy in the sender's Sent folder | ≤ 3 named analysts |
| IP address on remote config fetch (E-1.5 S6, AC-19; host not chosen) | mobile → config host | flags and kill switches | legitimate interest | per host logs, to be set before enabling (`LEGAL_REVIEW_REQUIRED`) | TBD | TBD | devops-sre |
| playtest debrief notes (pseudonymised) | playtest research | qualitative KPIs ("would play again") | consent | 6 months | EU | — | ≤ 3 named analysts |
| coach features (aggregated stats) | ai | personalised coaching | consent (adults) | 90 days | primary region | Anthropic | services |

All entries are initial assumptions — `LEGAL_REVIEW_REQUIRED` before launch.

Phase 1 playtest rows are disclosed to testers in `docs/legal/privacy-policy.md` (published under `site/privacy/`).
Change a playtest row and the policy in the same PR.
