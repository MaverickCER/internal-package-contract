<!-- GENERATED FILE -- do not edit by hand. Regenerate it by re-running the script that calls `generateDocumentation()` / `generateUsageReport()` from `@maverickcer/env-cap/build`. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.
>
> Projected from env-cap's Evidence Model (<https://github.com/MaverickCER/env-cap/blob/main/GUIDE.md>), the same source every other generated artifact draws from.

# Environment Variables

_Produced by `generateDocumentation()` from `@maverickcer/env-cap/build`._

_Generated 2026-10-13T01:25:18.872Z_

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

Optional. Lets the pin-sync workflow change workflow files and start CI on its pull request; without it the workflow cannot push workflow-file changes, and `internal-package-contract upgrade <tag>` does the same by hand.

- Default: yes
- Processor: no
- Validator: yes
- Sensitivity: secret
- Refresh instructions: Create a fine-grained personal access token for this repository with Contents, Pull requests and Workflows write access, then replace the repository secret PIN_SYNC_TOKEN (Settings > Secrets and variables > Actions). Then give it an `expiresAt` here (the token's expiry), so a weekly check can warn before it lapses.

<a id="ci-secrets-socket_security_api_key"></a>

### `SOCKET_SECURITY_API_KEY`

Optional. Read by the `socket` CLI while the contract runs, for the SecuritySocket check; without it that check reports a warning and the rest of the contract runs.

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

<a id="tool-settings-code_scanning_max_pages"></a>

### `CODE_SCANNING_MAX_PAGES`

How many pages of code-scanning alerts to read before stopping.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_logs"></a>

### `IPC_LOGS`

Which per-check logs the contract keeps: all, failing (the default) or off. The --logs flag wins.

- Default: yes
- Processor: no
- Validator: yes

<a id="tool-settings-ipc_release"></a>

### `IPC_RELEASE`

Set to 1 while a release is verified, so a prompt a maintainer left unanswered fails the run (PromptBlocks).

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
| `CODE_SCANNING_MAX_PAGES`    | [tool-settings (`ci/env.schema.ts`)](#tool-settings-code_scanning_max_pages)    |
| `IPC_LOGS`                   | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_logs)                   |
| `IPC_RELEASE`                | [tool-settings (`ci/env.schema.ts`)](#tool-settings-ipc_release)                |
| `PIN_SYNC_TOKEN`             | [ci-secrets (`ci/env.schema.ts`)](#ci-secrets-pin_sync_token)                   |
| `PUPPETEER_EXECUTABLE_PATH`  | [tool-settings (`ci/env.schema.ts`)](#tool-settings-puppeteer_executable_path)  |
| `SOCKET_SCORE_RETRY_WAIT_MS` | [tool-settings (`ci/env.schema.ts`)](#tool-settings-socket_score_retry_wait_ms) |
| `SOCKET_SECURITY_API_KEY`    | [ci-secrets (`ci/env.schema.ts`)](#ci-secrets-socket_security_api_key)          |

## Lifecycle report

<a id="lifecycle-report"></a>

| Variable                                                         | Owner | Expires | Refresh instructions                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ----- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`PIN_SYNC_TOKEN`](#ci-secrets-pin_sync_token)                   | --    | --      | Create a fine-grained personal access token for this repository with Contents, Pull requests and Workflows write access, then replace the repository secret PIN_SYNC_TOKEN (Settings > Secrets and variables > Actions). Then give it an `expiresAt` here (the token's expiry), so a weekly check can warn before it lapses. |
| [`SOCKET_SECURITY_API_KEY`](#ci-secrets-socket_security_api_key) | --    | --      | Create an API token at socket.dev (Settings > API Tokens) with the `packages:list` permission, then replace the repository secret SOCKET_SECURITY_API_KEY.                                                                                                                                                                   |

## Security review

<a id="security-review"></a>

- Total contracts: 2
- Total variable declarations: 8 (8 from active contracts)
- Unique variable names: 8
- Variables with `expiresAt` set: 0
  - Already expired: 0
  - Expiring within 30 days: 0
- Variables marked `required: true`: 0
- Variables with refresh instructions: 2
- Variables with no assigned owner: 8
- Variable names declared by more than one contract: 0
- Undocumented contracts: 0
- Undocumented variables: 0
