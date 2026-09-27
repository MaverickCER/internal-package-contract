# internal-package-contract

## 0.2.2

### Patch Changes

- 5c18493: `release-npm-changesets.yml` now dispatches the consumer's own `ci.yml` on the release PR's branch
  right after `changesets/action` creates or updates it. `changesets/action` pushes that branch with
  the default `GITHUB_TOKEN`, which GitHub deliberately never lets trigger `push`/`pull_request`-based
  workflows (an anti-recursion guard) -- confirmed directly against real Release PRs across two
  consumers this session, each sitting with zero CI checks until a human manually pushed a real commit
  to unstick it. `gh workflow run` is explicitly exempted from that restriction, and its run's checks
  attach to the branch's head SHA exactly as a normal `pull_request` run's would, so a consumer's
  required status checks are already green by the time a human reviews the PR.

## 0.2.1

### Patch Changes

- a919691: Fixes `release-npm-changesets.yml` (the reusable workflow consumers like
  `data-cap`/`env-cap` call for their npm-publishing releases) to give
  `changesets/action` a Conventional-Commits-compliant commit/PR title
  (`chore: version packages` instead of the default `"Version Packages"`).
  A consumer's own `commits` check (bundled from this package) was failing
  the resulting bot commit on `origin/main..HEAD` for exactly this reason,
  confirmed directly against a real Release PR. This is the reusable
  workflow's counterpart to the same fix already applied to this repo's own
  non-publishing `release.yml` in #11.

## 0.2.0

### Minor Changes

- c001355: Adds a new `BranchProtection` check (28 total) plus init-time GitHub ruleset
  setup -- `internal-package-contract init` now idempotently configures the
  default branch to block deletion, block force-pushes, and require every
  merge to go through a pull request, and the same state is verified on every
  `npm run contract` going forward. Fixes the self-contract Mutation
  regression in `checks/coverage.ts`. Adds `CODEOWNERS`/`SECURITY.md`/
  `CONTRIBUTING.md` templates (scaffolded by `init`, and adopted by this repo
  itself). Fills in missing `package.json` metadata (`repository`, `homepage`,
  `bugs`, `author`, `keywords`). Drops the `.`/`./contract` exports map
  entries, which never worked from a real installed `node_modules` tree and
  nothing in the fleet used -- the CLI is the one supported entry point. Adds
  a Windows CI leg for `bin/init.mjs`'s path/file-I/O and git-hook wiring.
  Hardens four checks (`coverage`, `accessibility`, `github-actions`,
  `mutation`) to give clear, actionable results for a genuinely brand-new
  consumer package instead of a vague failure or a false pass. Fixes a
  pre-push hook bug where an absolute-path `file:` dependency's symlink could
  make a consumer's `git push` run this repo's own self-tests instead of its
  own.
