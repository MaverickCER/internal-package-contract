# Releasing {{name}}

Maintainer-facing. Contributors don't run any of this: a normal change is just a pull request, and its
changeset is generated if it has none (see [`CONTRIBUTING.md`](CONTRIBUTING.md#making-a-change)).
For what semver actually covers, see [`VERSIONING.md`](VERSIONING.md).

## How releases work

Releases are driven by [Changesets](https://github.com/changesets/changesets) and npm's
[OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers), through
[`.github/workflows/release.yml`](https://github.com/{{owner}}/{{repo}}/blob/main/.github/workflows/release.yml),
which calls a shared, pinned workflow. **No `NPM_TOKEN` secret exists in this repository** and none is
needed: npm verifies the workflow's OIDC identity against a one-time trusted-publisher registration on
npmjs.com (see [First-time setup](#first-time-setup)). A person merges the release pull request; nothing
publishes without that.

The loop:

1. A pull request that changes user-facing behavior carries a changeset in `.changeset/` (Markdown,
   `patch`/`minor`/`major` plus a consumer-facing description). When it does not, one is generated on `main`
   from the commit messages (`feat`, `fix`, `perf`, `revert` or a breaking marker; a `Changeset: <bump>`
   trailer overrides). Below 1.0.0 a generated bump never exceeds minor, so 1.0.0 is reached only by a
   deliberate `major` changeset.
2. On each push to `main`, the workflow opens or updates a pull request titled **"chore: version packages"**
   from the branch **`changeset-release/main`** and dispatches CI on it. That pull request consumes the
   changeset files, bumps `package.json`'s `version` and rewrites `CHANGELOG.md`. Review it and merge it
   yourself; it is never merged automatically.
3. Merging it runs the workflow again. A **build** job, which holds no publishing credentials, runs
   `npm run verify` when the package defines it, packs the tarball, installs that tarball into an empty
   project and imports every entry point it declares. Only if all of that passes does the **publish** job
   run, and only from the default branch. It publishes exactly the tarball the build job made, over OIDC with
   a provenance attestation.
4. After publishing, the workflow tags the release `v<major>.<minor>.<patch>` on the merged commit,
   force-updates the floating major tag (`v0` while the package is 0.x, `v1` from 1.0.0), and asks npm what
   it now serves: the version must be there and must carry the provenance attestation, or the run goes red.
   The floating tag tracks the composite Action's interface (`action.yml` inputs and outputs), so
   `uses: {{ownerLower}}/{{repo}}@v0` keeps pointing at the latest compatible build until `action.yml` itself
   has a breaking change.

`CHANGELOG.md` is generated; never hand-edit it. Fix a wrong entry by correcting the offending changeset
before the version pull request is merged, or with a follow-up changeset after.

## First-time setup

One-time, before the very first automated release. Requires npm account
access, so it can't be done from a PR.

1. On [npmjs.com](https://www.npmjs.com), open `{{name}}`'s
   package settings → **Publishing access** → add a **trusted publisher** for
   GitHub Actions:
   - Organization or user: `{{ownerLower}}`
   - Repository: `{{repo}}`
   - Workflow filename: `release.yml` (exactly — just the filename, not a
     path; a mismatch here is the most common cause of the OIDC flow failing
     with a misleading `E404`)
   - Environment: leave blank unless `release.yml` is later scoped to a
     GitHub Environment
2. That's the whole trust relationship — `release.yml`'s `id-token: write`
   permission plus this registration. There is no token to copy anywhere.

Until the package exists on npm, its settings page doesn't either. For the
**first ever publish**, register the trusted publisher immediately after the
first `npm publish` (a one-time manual `npm publish --access public` from a
maintainer machine, from a clean `npm run verify` tree), then let every
subsequent release go through `release.yml`. Alternatively, publish an empty
`0.0.0` placeholder manually first, register the trusted publisher, then let
the first real version pull request publish `0.1.0` over OIDC.

## Recovering from a failed release

Identify which state you're in first — the recovery differs and the wrong
one can double-publish or lose a version.

### A. The version pull request is open, nothing published yet

Safe state. The bump only exists on the `changeset-release/main` branch.
Fix forward: push more changesets to `main` (the PR auto-updates), or edit
the PR branch directly if the generated `CHANGELOG.md`/version is wrong.
Nothing is on npm; nothing to undo.

### B. The version pull request is merged, but the release failed

`main` now has the version bump and changelog commit, but npm does not have the version. This is the common
failure (OIDC misconfiguration, a failing `npm run verify` or packed-consumer check in the build job, a
registry blip).

1. Confirm npm really doesn't have it: `npm view {{name}} versions --json`, and check the bumped version is
   absent.
2. Find the cause (see [Common failures](#common-failure-causes)).
3. If it was transient or a configuration problem outside the repository (a registry blip, the
   trusted-publisher registration), fix that and re-run the failed `release.yml` run from the Actions tab
   ("Re-run failed jobs"). A re-run uses the same commit.
4. If the cause is in the code, a re-run cannot help: it would build the same commit again. Fix it in a normal
   pull request to `main`. What happens next depends on the commit type. A `fix`, `feat`, `perf` or `revert`
   commit gets a changeset generated for it, so the workflow opens a new version pull request instead of
   publishing the stuck version; merging that publishes the next version, and the stuck version number is
   simply skipped. A commit type that releases nothing (`chore`, `ci`, `docs`) leaves no changeset, so the
   workflow sees that the current `package.json` version isn't on npm and builds and publishes that version.
5. Publishing by hand is the last resort, and it publishes without the provenance attestation that the
   workflow adds. If you must, publish that exact version from a clean tree
   (`git checkout main && npm ci && npm run verify && npm publish --access public`), then confirm the next push
   to `main` produces no spurious version pull request.

### C. Published to npm, but a later workflow step failed

e.g. the publish succeeded but the floating major tag (`v0` or `v1`) roll failed. The release itself
is done and correct. Just fix the trailing step manually:

```bash
git checkout main && git pull
git tag -f v0 && git push origin v0 --force   # while the package is 0.x
git tag -f v1 && git push origin v1 --force   # from 1.0.0
```

Do **not** re-run the whole workflow — `changeset publish` is idempotent and
will no-op on the already-published version, but re-running risks masking
whatever the real trailing failure was.

### D. Wrong version published

npm publishes are effectively permanent (`npm unpublish` is allowed only
within 72 hours and only if nothing depends on it, and the version number
can never be reused). Don't try to unpublish a normal mistake. Instead:

- Wrong contents, right version number: publish a patch (`x.y.z+1`) with a
  changeset that fixes it, and `npm deprecate {{name}}@x.y.z
"Broken publish — use x.y.z+1"`.
- Accidental major/minor bump: it stays. Continue from the new baseline; a
  version number is cheap, a rewritten history is not.

### E. First release, package not yet on npm

See [First-time setup](#first-time-setup) — the trusted-publisher
registration cannot exist before the package does, so the first publish is
the one manual step. Every release after that is automated.

## Common failure causes

- **`E404` on publish with OIDC**: the trusted-publisher registration's
  workflow filename doesn't exactly match `release.yml`, or the
  org/user/repo fields are wrong.
- **The build job's verify or packed-consumer step fails**: the version pull request merged with a red
  `main`, or the tarball does not contain what `exports` promises. Fix `main` first, then recover per case B.
- **The final "Verify what npm now serves" step fails**: npm did not return the version or its provenance
  attestation. Nothing is unpublished by the failure; look at the registry before doing anything else.
- **A version pull request appears when you didn't expect one**: there's a stray changeset file in `.changeset/` on `main`. If it's
  spurious, delete it in a normal PR.
- **Two version pull requests**: an older one wasn't closed when `main` moved. Close the stale one; the
  workflow only maintains the newest.

## Related

- [`VERSIONING.md`](VERSIONING.md) — what each bump type means, and which
  surface semver actually covers.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — the contributor-side workflow
  (branch, changeset, PR).
- [`SECURITY.md`](SECURITY.md#supported-versions) — which versions get
  security fixes.
