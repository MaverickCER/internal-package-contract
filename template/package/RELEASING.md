# Releasing {{name}}

Releases are automated and Changesets-driven; nobody publishes from a developer machine.

1. Every user-visible change adds a changeset: `npx changeset`.
2. Merging to `main` opens (or updates) a single "Version Packages" pull request.
3. That pull request is merged automatically once CI is green -- except a release that crosses a major
   version (0.x to 1.0.0, 1.x to 2.0.0), which a person must read and merge. Merging it publishes to npm
   with provenance and tags the release.

Tags: every release is `v<major>.<minor>.<patch>`. If the package ships a composite GitHub Action, the
floating `v<major>` tag (`v0` while the package is 0.x) is moved to each release of that major, and never
moves across a major boundary.

## One-time setup

1. On [npmjs.com](https://www.npmjs.com), open `{{name}}`'s Settings > Trusted Publisher and add
   a GitHub Actions publisher:
   - Organization or user: `{{owner}}`
   - Repository: `{{repo}}`
   - Workflow filename: `release.yml`
2. In the GitHub repository, allow Actions to create pull requests (Settings > Actions > General).

## If a publish fails part-way

1. Confirm npm really does not have the version: `npm view {{name}} versions`.
2. Re-run the failed workflow run; the publish step is idempotent for an unpublished version.

## Bad release

Never unpublish. Ship a fix with a new changeset and deprecate the broken version:
`npm deprecate {{name}}@x.y.z "reason -- use x.y.z+1"`.
