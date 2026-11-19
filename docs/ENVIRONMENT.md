<!-- GENERATED FILE -- do not edit by hand. Regenerate it by re-running the script that calls `generateDocumentation()` / `generateUsageReport()` from `@maverickcer/env-cap/build`. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.
>
> Projected from env-cap's Evidence Model (<https://github.com/MaverickCER/env-cap/blob/main/GUIDE.md>), the same source every other generated artifact draws from.

# Environment Variables

_Produced by `generateDocumentation()` from `@maverickcer/env-cap/build`._

_Generated 2026-11-17T23:32:09.665Z_

## Changes since last report

No changes.

## Table of contents

- [Catalog](#catalog)
  - [ci-secrets](#contract-ci-secrets)
  - [tool-settings](#contract-tool-settings)
- [Lifecycle report](#lifecycle-report)
- [Security review](#security-review)

## Catalog

<a id="catalog"></a>

<a id="contract-ci-secrets"></a>

## ci-secrets

Source: `ci/env.schema.ts`

- Active: yes
- Category: CI secrets

<a id="ci-secrets-pin_sync_token"></a>

### `PIN_SYNC_TOKEN`

Optional. Lets the pin-sync workflow change workflow files and merge its pull request once CI is green. Without it the workflow cannot push workflow-file changes, and `internal-package-contract upgrade <tag>` does the same by hand.

- Default: yes
- Processor: no
- Validator: yes
- Sensitivity: secret
- Refresh instructions: Create a fine-grained personal access token for this repository with Contents, Pull requests and Workflows write access. Replace the repository secret PIN_SYNC_TOKEN with it (Settings > Secrets and variables > Actions). Then set its `expiresAt` in `ci/env.schema.ts` to the token's expiry, so a weekly check can warn before it lapses.

<a id="ci-secrets-socket_security_api_key"></a>

### `SOCKET_SECURITY_API_KEY`

Optional. Read by the `socket` CLI while the contract runs, for the SecuritySocket check. Without it that check warns; under CI the warning fails unless `.repo-contract/exceptions/environment.json` records `environment:SecuritySocket:no-key`.

- Default: yes
- Processor: no
- Validator: yes
- Sensitivity: secret
- Refresh instructions: Create an API token at socket.dev (Settings > API Tokens) with the `packages:list` permission, then replace the repository secret SOCKET_SECURITY_API_KEY.

<a id="contract-tool-settings"></a>

## tool-settings

Source: `ci/env.schema.ts`

- Active: yes
- Category: Tool settings

<a id="tool-settings-chrome_path"></a>

### `CHROME_PATH`

A Chrome or Chromium to use for the accessibility scan, read when PUPPETEER_EXECUTABLE_PATH is not set.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ci"></a>

### `CI`

Set by the CI service. Readers disagree on its values. Any value but empty, `false` or `0` makes the run `--strict`, as `GITHUB_ACTIONS=true` does; the git hooks, CodeScanning and SecuritySocket agree. Any value but empty or `false` turns off the mutation memo (IPC_MUTATION_MEMO), so `CI=0` turns it off too. SurfaceContract counts only `true`, and the benchmark results location only `true` or `1`. CodeRabbit and the benchmark records count any non-empty value.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-code_scanning_max_pages"></a>

### `CODE_SCANNING_MAX_PAGES`

How many pages of code-scanning alerts to read before stopping.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_hook_full"></a>

### `IPC_HOOK_FULL`

Set to 1 by the pre-commit hook. The pre-push hook then runs `--scope affected`, slow analyses included, instead of skipping Coverage, Crap and Mutation.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_logs"></a>

### `IPC_LOGS`

Which per-check logs the contract keeps: all, failing (the default) or off. The --logs flag wins.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_mutation_memo"></a>

### `IPC_MUTATION_MEMO`

Set to 0 so a local run mutates again instead of reusing the last clean run. The memo is off under CI whatever this says.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_mutation_report"></a>

### `IPC_MUTATION_REPORT`

A merged Stryker report for the Mutation check to judge instead of mutating. The reusable contract workflow sets it after merging the shards.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_mutation_shard"></a>

### `IPC_MUTATION_SHARD`

`i/n` makes the Mutation check mutate slice i of n, cut by file. The reusable contract workflow sets it per shard job. Ignored when IPC_MUTATION_REPORT is set.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_release"></a>

### `IPC_RELEASE`

Set to 1 while a release is verified, so a prompt a maintainer left unanswered fails the run (PromptBlocks).

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_socket_cache"></a>

### `IPC_SOCKET_CACHE`

Set to `off` so SecuritySocket asks Socket for every score instead of reading its on-disk cache.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_socket_cache_dir"></a>

### `IPC_SOCKET_CACHE_DIR`

Where SecuritySocket keeps its score cache. Empty means `~/.cache/ipc-socket-score-cache`. On Linux and macOS, a directory another user owns or can write is ignored. Windows checks neither; the per-user home is the boundary there.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_socket_cache_ttl_hours"></a>

### `IPC_SOCKET_CACHE_TTL_HOURS`

How many hours a cached Socket score stays valid. A value that is not a positive number means 24.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-puppeteer_executable_path"></a>

### `PUPPETEER_EXECUTABLE_PATH`

A Chrome or Chromium to use for the accessibility scan, under the name Puppeteer uses. It wins over CHROME_PATH.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-socket_score_retry_wait_ms"></a>

### `SOCKET_SCORE_RETRY_WAIT_MS`

How long to wait, in milliseconds, before asking Socket for a package score again.

- Default: yes
- Processor: no
- Validator: yes

## Dependency graph

<a id="dependency-graph"></a>

One row per unique variable name; more than one location means more than one feature declares it (see the package README's "Duplicate variables" section for how that's handled at runtime).

| Variable                     | Declared in                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `CHROME_PATH`                | [tool-settings (`ci/env.schema.ts`)](#tool-settings-chrome_path)                |
| `CI`                         | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ci)                         |
| `CODE_SCANNING_MAX_PAGES`    | [tool-settings (`ci/env.schema.ts`)](#tool-settings-code_scanning_max_pages)    |
| `IPC_HOOK_FULL`              | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_hook_full)              |
| `IPC_LOGS`                   | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_logs)                   |
| `IPC_MUTATION_MEMO`          | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_mutation_memo)          |
| `IPC_MUTATION_REPORT`        | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_mutation_report)        |
| `IPC_MUTATION_SHARD`         | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_mutation_shard)         |
| `IPC_RELEASE`                | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_release)                |
| `IPC_SOCKET_CACHE`           | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_socket_cache)           |
| `IPC_SOCKET_CACHE_DIR`       | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_socket_cache_dir)       |
| `IPC_SOCKET_CACHE_TTL_HOURS` | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_socket_cache_ttl_hours) |
| `PIN_SYNC_TOKEN`             | [ci-secrets (`ci/env.schema.ts`)](#ci-secrets-pin_sync_token)                   |
| `PUPPETEER_EXECUTABLE_PATH`  | [tool-settings (`ci/env.schema.ts`)](#tool-settings-puppeteer_executable_path)  |
| `SOCKET_SCORE_RETRY_WAIT_MS` | [tool-settings (`ci/env.schema.ts`)](#tool-settings-socket_score_retry_wait_ms) |
| `SOCKET_SECURITY_API_KEY`    | [ci-secrets (`ci/env.schema.ts`)](#ci-secrets-socket_security_api_key)          |

## Lifecycle report

<a id="lifecycle-report"></a>

| Variable                                                         | Owner | Expires | Refresh instructions                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`PIN_SYNC_TOKEN`](#ci-secrets-pin_sync_token)                   | --    | --      | Create a fine-grained personal access token for this repository with Contents, Pull requests and Workflows write access. Replace the repository secret PIN_SYNC_TOKEN with it (Settings > Secrets and variables > Actions). Then set its `expiresAt` in `ci/env.schema.ts` to the token's expiry, so a weekly check can warn before it lapses. |
| [`SOCKET_SECURITY_API_KEY`](#ci-secrets-socket_security_api_key) | --    | --      | Create an API token at socket.dev (Settings > API Tokens) with the `packages:list` permission, then replace the repository secret SOCKET_SECURITY_API_KEY.                                                                                                                                                                                     |

## Security review

<a id="security-review"></a>

- Total contracts: 2
- Total variable declarations: 16 (16 from active contracts)
- Unique variable names: 16
- Variables with `expiresAt` set: 0
  - Already expired: 0
  - Expiring within 30 days: 0
- Variables marked `required: true`: 0
- Variables with refresh instructions: 2
- Variables with no assigned owner: 16
- Variable names declared by more than one contract: 0
- Undocumented contracts: 0
- Undocumented variables: 0
