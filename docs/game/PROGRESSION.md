# Progression & Technology Profile

Owner: `game-designer` (design) · `backend-engineer` (services/progression).

## Player XP and level
- XP sources (server-computed from events): match completion (by mode, win bonus), Knowledge XP of each **newly
  discovered** term (first time played or opened), missions, achievements, Daily.
- Level curve: `xpToNext(level) = round(100 × level^1.5)` ⚙. No XP from purchases.

## Technology profile (V-06)
For each category *c*, mastery `M_c ∈ [0, 100]`:
```
M_c = 100 × (0.40·Coverage_c + 0.25·Depth_c + 0.15·Accuracy_c + 0.10·Speed_c + 0.10·Competitive_c)
Coverage_c    = discovered terms in c / playable terms in c   (log-scaled ⚙)
Depth_c       = weighted share of advanced/expert terms discovered in c
Accuracy_c    = valid / attempted words in c (last 200 attempts, Bayesian prior)
Speed_c       = percentile of think time for words in c vs. same-rating players
Competitive_c = rating-adjusted win contribution of words in c (ranked only)
```
Displayed as bars per category; the profile title (e.g. "CLOUD ARCHITECT") derives from the top categories.

## Missions & achievements
Data-driven definitions (`progression` config) with predicates on events, e.g. *MASTER PYTHON* = discover
{LIST, TUPLE, DICT, SET, ITERATOR, GENERATOR, DECORATOR}. Achievements are idempotent and retro-computable from
event history.
