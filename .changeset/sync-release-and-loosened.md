---
"internal-package-contract": minor
---

Breaking: the `exceptions` command of `internal-package-contract` is removed. Run `npx repo-contract exceptions` for the same
inventory. The old command now exits 1 and names the new one. The contract report still carries the inventory,
now from repo-contract's helpers, so `report.json`'s `exceptions` gains `schemaVersion: 1` and always has `errors`.

New: `internal-package-contract sync --release` is a whole `version` script. It runs `changeset version`,
updates `package-lock.json`, runs `build` when the package has it, and refreshes the API and surface baselines.
Then it regenerates the example goldens, agent skill and landing page where the package has them. It rewrites the
SBOMs when `docs/sbom.cdx.json` exists or `Sbom` is turned on, with the package's `sbom` script or else `tool sbom`.
It refuses to start outside a git repository, on uncommitted changes, without `@changesets/cli` or without a
`package.json`, each with its own message. Pending `.changeset/*.md` files and `.changeset/.release-bump.json` do
not count as uncommitted changes, because the release workflow generates them in the step before the version step. A
test runs that sequence on a `feat:` commit and the run exits 0. It stops at the first failing step and names only
the files the run changed or created, with how to undo each. A pending changeset the run consumed is named
separately: git restore cannot bring it back. It exits 2 when combined with `--apply`, `--update` or `--add`. A
scaffolded package's `version` script is now this one command. A package that copies it gains the lockfile step
if it lacked one.

New: the contract report compares the run with the standard itself. `report.json` gains `explanation`, and the
summary gains a "Compared with the standard" section. It lists each standard check that is missing or turned off.
It lists each numeric setting looser than the standard's: coverage, duplication, CRAP, complexity and the mutation
score. Other options, such as scan paths and ignore lists, are not compared. Neither is a check replaced under the
same id, so a note names the seven IPC replaces. Settings come from repo-contract's tier metadata, so a config
without it is compared by checks only.

`ci/env.schema.ts` now documents `CI` and seven `IPC_*` variables: `IPC_HOOK_FULL`, `IPC_MUTATION_SHARD`,
`IPC_MUTATION_REPORT`, `IPC_MUTATION_MEMO`, `IPC_SOCKET_CACHE`, `IPC_SOCKET_CACHE_DIR` and
`IPC_SOCKET_CACHE_TTL_HOURS`. A test fails when the code reads an `IPC_*` variable the schema lacks. A consumer's
`docs/ENVIRONMENT.md` lists them too, so `EnvContract` fails until it is regenerated. `upgrade` regenerates it.

`init` now writes `contract.yml` as a thin caller of the reusable `contract.yml`, pinned by commit SHA. Its
`standard` job runs the sharded, full contract; a bare `contract` job and `required` keep the status checks the
ruleset needs. Without a commit to pin, `init` skips the file and says so. The scaffolded README marks its install
command as the quick start block `QuickStart` runs. A test checks the markers; no test runs `QuickStart` on the
scaffold.
