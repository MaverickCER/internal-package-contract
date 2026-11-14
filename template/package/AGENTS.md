# AGENTS.md

Rules for AI coding agents working in `{{name}}`. A human contributor follows the same rules;
[CONTRIBUTING.md](CONTRIBUTING.md) has the reasons.

## Loop

1. Run `npm ci` once per clone.
2. Write the test first and run it. It fails, for the reason you expect. A bug fix starts with a test that
   reproduces the bug.
3. Write the code that makes it pass. `npm run verify` is the fast loop.
4. Run `npm run contract`, the full gate CI runs. The change is done when it passes. Report any check you
   could not run, with its cause.

`npx internal-package-contract --help` lists the commands. `npx internal-package-contract doctor` says what is
set up and what is left.

## Hard rules

- **Meet every gate as it stands.** Commit and push with the hooks running (never `--no-verify`), and keep
  every workflow and threshold as it is. When a gate fails, fix the cause. When you think the gate is wrong,
  say so in the pull request and leave the gate in place.
- **Commit with Conventional Commits and no `Co-Authored-By:` trailer.** The commit-msg hook and the `Commits`
  check reject a message that breaks either.
- **Change a generated file through its source.** `dist/` comes from `src/` (`npm run build`).
  `docs/api-report/` and `docs/api/` come from TSDoc (`npm run docs:api:report`, `npm run docs:api`). A region
  between `<!-- ipc:begin -->` and `<!-- ipc:end -->` comes from `package.json` and `docs/surface.json`
  (`npx internal-package-contract generate`). `docs/ENVIRONMENT.md` comes from `ci/env.schema.ts`
  (`npm run docs:env`).
- **Propose the version bump; the maintainer sets it.** Add a changeset (`.changeset/<name>.md`) at the level
  [VERSIONING.md](VERSIONING.md) gives, and name that level in the pull request. `ApiContract` and
  `SurfaceContract` fail a level smaller than the change.
- **Land every change through a pull request.** The release workflow versions, tags and publishes after a
  person merges the release pull request.

## Conventions

- Commit headers are imperative and lowercase. Keep header and body lines to 100 characters.
- A suppression comment (`eslint-disable`, `@ts-expect-error`, `// Stryker disable`) says why, on the
  same line, in words a reviewer can check.
- The public API is what `package.json` `exports` lists. Everything else can change in any release.

## Public API map

One row per entry point `package.json` exports. The table is generated: describe a new entry point in
`docs/surface.json`, then run `npx internal-package-contract generate`.

<!-- ipc:begin entry-points -->
<!-- ipc:end entry-points -->
