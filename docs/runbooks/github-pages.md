# Runbook: GitHub Pages (static `site/`)

Owner: `devops-sre`. Target: https://dev0cb.github.io/codelex/ (privacy policy at `/privacy/`, French at `/privacy/fr/`).

## How it works
`.github/workflows/pages.yml` runs on push to `main` touching `site/**`, or manually (workflow_dispatch). It uploads only `site/` and deploys it. Nothing outside `site/` is published.

## One-time setup (repo owner)
1. Settings -> Pages -> Source: **GitHub Actions**.
2. Run the workflow once (Actions -> pages -> Run workflow) or merge a change under `site/`.
3. Check https://dev0cb.github.io/codelex/privacy/ once the privacy pages are merged.

## Plan constraint
The repository is **private**. GitHub Pages for private repositories requires a paid GitHub plan (Pro/Team/Enterprise). The published site is **public** even when the repo is private, so put nothing confidential under `site/`.

## Fallback
If the plan does not allow Pages on this repo, create a separate small **public** repo containing only `site/`, with the same workflow, keeping the URL path (`/privacy/`) identical. Update links in store listings if the host changes.

## Troubleshooting
- Deploy job fails at configure-pages: Pages is not enabled or the source is not "GitHub Actions".
- 404 after deploy: confirm `site/privacy/index.html` exists on `main`.
