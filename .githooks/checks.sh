# shellcheck shell=bash
# What pre-push runs in this repo, after the gitleaks scans in pre-push.
# Mirror CI (.github/workflows) and the box deploy gate; keep it read only.
repo_checks() {
  step "tests (npm test)" npm test
  step "typecheck (npm run typecheck)" npm run typecheck
  step "docs in sync (node scripts/sync-docs.mjs --check)" node scripts/sync-docs.mjs --check
}
