# Releasing {{name}}

Releases are automated and Changesets-driven; nobody publishes from a developer machine.

1. Every user-visible change adds a changeset: `npx changeset`.
2. Merging to `main` opens (or updates) a single "Version Packages" pull request.
3. Merging that pull request publishes to npm with provenance and tags the release.

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
