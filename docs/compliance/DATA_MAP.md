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
| playtest install UUID + analytics events (E-1.5) | mobile (on device), playtest export | playtest KPIs (Phase 1 exit) | consent | on device ≤ 30 days; raw exported files 6 months after playtest end, aggregates kept | EU | — | ≤ 3 named analysts |
| playtest mailbox (sender email + attachments) | playtest export | receive tester exports | consent | attachments moved to restricted EU storage within 7 days, emails deleted | EU | mail provider (EU-hosted) | ≤ 3 named analysts |
| playtest enrollment roster (name, email, 18+ confirmation, country, consent) | playtest operations | eligibility, consent records, contact | consent / legal obligation | playtest end + 12 months | EU | — | playtest lead |
| playtest debrief notes (pseudonymised) | playtest research | qualitative KPIs ("would play again") | consent | 6 months | EU | — | ≤ 3 named analysts |
| coach features (aggregated stats) | ai | personalised coaching | consent (adults) | 90 days | primary region | Anthropic | services |

All entries are initial assumptions — `LEGAL_REVIEW_REQUIRED` before launch.
