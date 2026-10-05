# Runbook: v2 balance check workflow

- Workflow: `.github/workflows/balance-check.yml` (`workflow_dispatch` only). Owner: `devops-sre`; script owner: `ai-engineer`.
- Spec: `docs/specs/E-1.6-balance/v2-balance-check.md` (§5.3, §5.4, §6). Sections 1-6 of the spec are frozen, so this
  runbook lives here and not in the spec.
- Not a paging alert. It is the procedure for one pre-registered run.

## What the workflow fixes

Seed (`2026100400000e16`), variants, pairings, match counts and Strategist as primary bot are fixed by the simulator's
`--suite balance-check` and are not inputs. The only inputs are the three §6 values. A dispatch cannot change §2-§4.
The Strategist-late path (§5.2, `--primary greedy`) is deliberately not an input: using it needs a reviewed edit
of the workflow that changes only that flag.

## Before dispatching

1. Preconditions of §5.3-1 hold (C3, L7 with its derivation record, E6, B3, B4 merged, or §5.2 applies).
2. Pick the **code commit** (the `main` commit containing all of them) and the **lexicon commit** (§4.3). Use full
   40-char SHAs. The lexicon data must be identical at both commits (`packages/lexicon/data`), and the lexicon commit
   must be an ancestor of the code commit.
3. Get the blob SHA: `git rev-parse <code-commit>:docs/specs/E-1.6-balance/v2-balance-check.md`.
4. Start by D0+8 (2026-10-12) so that one invalid run can still be repeated before the cutoff (2026-10-13 23:59 UTC).

## Dispatch

Actions, "Balance check (v2, pre-registered)", Run workflow, branch `main`, then the three inputs. Or:

```bash
gh workflow run balance-check.yml --ref main \
  -f code_commit=<sha> -f lexicon_commit=<sha> -f prereg_blob=<blob-sha>
```

The `prepare` job fails fast (before any simulation) if the ref is not `main`, a SHA is malformed, the code commit is
not on `main`, the lexicon data differs, or the blob does not match. It computes `lexiconVersion` and `definitionHash`
from the checkout (`tools/balance-check/lexicon-identity.mjs`); nobody types them. A second dispatch queues behind
the running one (`concurrency: balance-check`, no cancellation).

Jobs: `prepare`, then in parallel `simulate` for `v1`, `v2-3612`, `v2-248` and `diagnostics` (`dx-dw-3612`,
`dx-dw-248`), then `merge`, which runs `readout --merge`. The merged readout is also written to the run summary.

## Infrastructure failure (§5.4 a)

Runner crash, timeout or cancelled job. Do not dispatch a new run and do not edit anything.

1. Open the failed run, "Re-run failed jobs". Inputs and commit are identical by construction (they come from the same
   run). Completed jobs are kept; `merge` runs when all jobs are green.
2. If the run cannot be re-run (retention, repository settings), dispatch again with exactly the same three inputs.
3. Determinism: completed parts must reproduce byte for byte. Compare the new results JSON with the failed attempt's
   artifacts (kept 90 days) for any job that finished in both. A mismatch is an I-class failure: stop, report to
   `ai-engineer`, and treat the run as invalid (§5.4 b).
4. The digest records the failure (run URL, job, cause) and any mismatch.

An I-1..I-3 failure or a defect in the simulator or readout is **not** an infrastructure failure: it is §5.4 b
(reviewed fix PR that changes no §2-§4 parameter, then re-run every variant).

## Recording the results (docs-only follow-up PR)

The workflow commits nothing. After a green run:

1. Download the artifacts: `balance-check-readout` (merged `balance-check-results.json`, `balance-check-readout.md`,
   `log-merge.txt`) and `balance-check-<job>` (per-job results JSON, readout, log, `job-seconds-<job>.txt`).
2. Open a PR with `game-designer` and `ai-engineer` as reviewers adding, under
   `docs/game/sim/2026-10-v2-balance-check/`: `results.json` (the merged results JSON, unchanged), `digest.md`
   (verdict table, §5.1 decision path, surprises against §1.2, risks), and `jobs.tsv` (the exact job specs: variants
   per job, the commands and the workflow run URL). Do not commit raw per-match records or edit any result.
3. Append the outcome to spec §8 (the only allowed edit), and record the decision in the sprint file's decision log
   (task BC), by the cutoff.
4. Artifacts expire after 90 days. Committing `results.json` is what keeps the run; a failed or invalid run's results
   stay committed too and are cited by any re-run (§5.4).

Wall time in the merged JSON is the elapsed time from the start of `prepare` to the merge step, in whole seconds
(including queue time and the delay of any re-run of failed jobs; per-job seconds are in `job-seconds-<job>.txt`).
