---
"internal-package-contract": minor
---

`ApiContract` and `SurfaceContract` no longer accept a version bump as the declaration of a change. Before, a package whose version had reached "baseline plus the required level" passed with no changeset. Baselines were never refreshed after a release, so env-cap (baseline 0.6.0, package 0.7.5) and data-cap (0.7.0, 0.10.0) passed every later breaking change. Now:

- Both checks fail when a committed baseline records another version than `package.json`. The message says to run `internal-package-contract update-baseline` and to add it to the `version` script.
- The template's `version` script, and this repository's own, run `update-baseline` after the build. The "chore: version packages" pull request then carries the baselines at the new version.
- Only a changeset at the required level satisfies a diff.

What to do after upgrading: run `npx internal-package-contract update-baseline`, commit the result, and append `&& internal-package-contract update-baseline` to your `version` script after `npm run build`.

`SurfaceContract` now also reads every command a CLI's help lists. It runs `<bin> <command> --help` for each one. A removed command is breaking. A command's own flags and exit code are judged like the top-level ones. A baseline taken before this release is compared on the top-level help until `update-baseline` records the commands. Every listed command must print its help and exit without side effects.

`CodeScanning` now counts the directories a root `action.yml` runs code from as shipped, such as `scripts/github-action/`. Before, an alert there was excused as development-only, although users run that code through the action's tag.

The run help lists `--scope <mode>` and `--base <ref>`.

The managed `release.yml` and `sync-internal-package-contract.yml` callers now set `permissions: {}` at the top, so only each job's own grant applies. OpenSSF Scorecard's Token-Permissions finding flagged the missing top-level block. `ManagedFiles` reports the difference until `sync --apply --update` copies it.

New check, `Prose`: no em-dash and no `--` dash substitute in the prose a package writes, meaning Markdown outside code, comments in TypeScript and JavaScript, and full-line YAML and shell comments. Code, strings and tool directives such as ESLint's `-- reason` are never read. It judges one punctuation habit, not whether the writing is clear.

`generate` has two regions that read only the package's own files: `action-inputs` (the inputs of `action.yml`: name, whether required, default, first sentence of the description) and `supported-versions` (`engines.node` and each peer dependency, marked optional where `peerDependenciesMeta` says so). Neither needs `docs/surface.json`.

`SurfaceContract` also baselines each reusable workflow under `.github/workflows/` (one with `on.workflow_call`): its inputs, secrets and outputs, judged like an Action's. A removed input, secret, output or workflow is breaking.

This repository's own release now tags a version only after proving a workflow run on the same tree passed its `contract` job, as the consumers' shared release already did.

`ApiContract` and `SurfaceContract` also fail when a branch rewrites a committed baseline while `package.json` keeps the base branch's version. Comparing against a baseline edited in the same pull request would hide that pull request's own change. The comparison point is the merge base with `origin/$GITHUB_BASE_REF` (or `origin/main`). A release (a new version), a first baseline, and the refresh of a baseline that was already stale on the base branch are allowed. Without the base branch in the clone, the comparison is skipped.

`SurfaceContract` can baseline the Markdown headings a package's generators write. List the renderer source files under `internal-package-contract.surfaceRenderers` in `package.json`. Every heading in a plain string literal is recorded, and a removed heading is breaking. Headings built from data are left out.

The shared release workflow now publishes a tree only when a run on it passed `contract` and, where the run has one, `required`. This repository's own release does the same before tagging, and runs again when CI finishes on `main`, so a tag that could not be proven on the first try is retried.

The baseline guard treats a version change as a release only on a `changeset-release/*` branch. On a pull request that branch must live in the same repository, so a fork cannot borrow the name. On any other branch a changed version excuses nothing, so a feature branch that runs `npm run version` cannot refresh its own baselines past a breaking change. Dropping `surfaceRenderers` from `package.json` reads as every recorded heading removed, which is breaking.

`EnvContract` now fails when a file `internal-package-contract env` generates is stale. It still only warns about credential dates and ownership, which depend on the calendar.

`Prose` also reads a comment after a comma or before a closing bracket, and treats a code span that wraps across two `//` lines as code.

This repository's release retries a tag on the commit CI ran on (`workflow_run.head_sha`), never on a later `main` commit.

Check rationales, report text and the benchmark report's prose use a colon, semicolon, comma or parentheses where they used `--` or an em-dash. Only wording changed; a script that matched the old text exactly needs updating. The `GENERATED FILE -- do not edit by hand` banner is unchanged. `GeneratedRegions` now runs on this repository itself, and its README states the Node.js range from `engines.node` in a generated region.

Wording only: the benchmark workflows' log messages, two reusable-workflow input descriptions and the scaffolded issue-template contact link no longer use `--` as a dash. The generated `BENCHMARKS.md` uses shorter sentences. No check compares a committed `BENCHMARKS.md` with a fresh render, so nothing fails. To pick up the new wording without measuring again, run the suite with `--render`.

`BranchProtection` now also requires the `required` status check where the package's CI has that job. That is a workflow under `.github/workflows` with both a `contract` and a `required` job, like the scaffolded `contract.yml`. A consumer whose ruleset names only `contract` fails the check until `required` is added to the ruleset (`internal-package-contract init --github` writes both). When the rulesets cannot be read, the check degrades exactly as before.

Documentation only: the README defines a degradation once, before the check tables. Each check row names the degradation ids that check can record, such as `Commits:no-base`. The `Prose` row lists what the scan does not read. For the `PIN_SYNC_TOKEN` permissions, the README links to `docs/ENVIRONMENT.md`.

Behaviour change: `upgrade` now also regenerates what the new release writes. After it syncs the managed files it runs `generate`, then `skill` when the package has `docs/skill.json` or turns on `AgentSkill`, then `env` when it has `ci/env.schema.ts`. It still never runs `update-baseline`: the baselines follow the package's own releases. The daily pin-sync pull request commits these files with the pin, since it stages every change. The move to this release still runs the previous release's `upgrade`, so run `internal-package-contract generate`, `skill` and `env` once by hand after it.

Wording only, for adopters:

- The README opens with what a package gets from the standard, what adopting it costs, and what it is not.
- The pitch in `package.json`, the README and `--help` is now one sentence: "Reusable CI checks, workflows and document generators shared by every MaverickCER package, added and kept current with one command." `--help` names `init` and `upgrade` as those commands, and the README shows a real excerpt of `npm run contract` output.
- `--help` lists `ambient` under `tool`.
- The console prints a check's id once on a result line whose rationale already starts with it ("[FAIL] GeneratedRegions: [generate] stale …", not "GeneratedRegions: GeneratedRegions: …"). The rationale in `report.json`, the logs and the Markdown summary is unchanged.
- The README's `Mutation`, `Tests`, `SecurityDeps` and `SecuritySocket` rows name the exception registry each check reads. The opening's "zero surviving mutants" now says a hand-verified record in `.repo-contract/exceptions/mutation.json` can exempt one.
- The `PIN_SYNC_TOKEN` description of the reusable `dependency-pin-sync.yml` links to `docs/ENVIRONMENT.md` instead of listing the token's permissions.
- The generated agent skill's "Authority" paragraph states what to do instead of what to avoid. `AgentSkill` reports the old text as stale.
- `docs/ENVIRONMENT.md` takes this package's new wording for `SOCKET_SECURITY_API_KEY` (it fails under CI without a recorded exception) and `PIN_SYNC_TOKEN` (where to set `expiresAt`).
- The benchmark report no longer says its dollar figures compare packages, which `READING-BENCHMARKS.md` advises against. Re-render with `run-suite.mjs <suite> --render`.
- The managed `RELEASING.md` copy describes what a re-run does after a publish, and drops an em-dash from the `npm deprecate` example. `sync --apply --update` copies it.
- New packages get a scaffolded `AGENTS.md` with a numbered loop and a done criterion, and `VERSIONING.md`, `CONTRIBUTING.md` and `SECURITY.md` that match what `ApiContract`, `SurfaceContract` and `BranchProtection` check today.
