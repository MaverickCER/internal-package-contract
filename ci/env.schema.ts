// What this repository's workflows and scripts read from the environment, written down once. None of it is required:
// every variable has a default, a missing credential is a warning, and a missing setting takes its default.
// `internal-package-contract env` reads this file (it never runs it) and writes docs/ENVIRONMENT.md.
// test/env-schema-coverage.test.ts fails when the code reads an `IPC_*` variable this file does not declare.
import { createEnv, documentEnv } from "../reexports/env-cap/index.ts"

// Anything is accepted: none of these is required, and a missing one is not an error.
const accept = (): true => true

const ciSecrets = {
  PIN_SYNC_TOKEN: { default: "", validator: accept },
  SOCKET_SECURITY_API_KEY: { default: "", validator: accept },
}

const toolSettings = {
  IPC_RELEASE: { default: "", validator: accept },
  IPC_LOGS: { default: "failing", validator: accept },
  CODE_SCANNING_MAX_PAGES: { default: "20", validator: accept },
  SOCKET_SCORE_RETRY_WAIT_MS: { default: "5000", validator: accept },
  CHROME_PATH: { default: "", validator: accept },
  PUPPETEER_EXECUTABLE_PATH: { default: "", validator: accept },
  IPC_HOOK_FULL: { default: "", validator: accept },
  IPC_MUTATION_SHARD: { default: "", validator: accept },
  IPC_MUTATION_REPORT: { default: "", validator: accept },
  IPC_MUTATION_MEMO: { default: "", validator: accept },
  IPC_SOCKET_CACHE: { default: "", validator: accept },
  IPC_SOCKET_CACHE_DIR: { default: "", validator: accept },
  IPC_SOCKET_CACHE_TTL_HOURS: { default: "24", validator: accept },
  CI: { default: "", validator: accept },
}

export const ciSecretsEnv = createEnv(ciSecrets, { name: "ci-secrets" })
export const toolSettingsEnv = createEnv(toolSettings, { name: "tool-settings" })

documentEnv(ciSecrets, {
  category: "CI secrets",
  variables: {
    PIN_SYNC_TOKEN: {
      description:
        "Optional. Lets the pin-sync workflow change workflow files and merge its pull request once CI is green. Without it the workflow cannot push workflow-file changes, and `internal-package-contract upgrade <tag>` does the same by hand.",
      refreshInstructions:
        "Create a fine-grained personal access token for this repository with Contents, Pull requests and Workflows write access. Replace the repository secret PIN_SYNC_TOKEN with it (Settings > Secrets and variables > Actions). Then set its `expiresAt` in `ci/env.schema.ts` to the token's expiry, so a weekly check can warn before it lapses.",
      sensitivity: "secret",
    },
    SOCKET_SECURITY_API_KEY: {
      description:
        "Optional. Read by the `socket` CLI while the contract runs, for the SecuritySocket check. Without it that check warns; under CI the warning fails unless `.repo-contract/exceptions/environment.json` records `environment:SecuritySocket:no-key`.",
      refreshInstructions:
        "Create an API token at socket.dev (Settings > API Tokens) with the `packages:list` permission, then replace the repository secret SOCKET_SECURITY_API_KEY.",
      sensitivity: "secret",
    },
  },
})

documentEnv(toolSettings, {
  category: "Tool settings",
  variables: {
    IPC_RELEASE: {
      description:
        "Set to 1 while a release is verified, so a prompt a maintainer left unanswered fails the run (PromptBlocks).",
    },
    IPC_LOGS: {
      description:
        "Which per-check logs the contract keeps: all, failing (the default) or off. The --logs flag wins.",
    },
    CODE_SCANNING_MAX_PAGES: {
      description: "How many pages of code-scanning alerts to read before stopping.",
    },
    SOCKET_SCORE_RETRY_WAIT_MS: {
      description:
        "How long to wait, in milliseconds, before asking Socket for a package score again.",
    },
    CHROME_PATH: {
      description:
        "A Chrome or Chromium to use for the accessibility scan, read when PUPPETEER_EXECUTABLE_PATH is not set.",
    },
    PUPPETEER_EXECUTABLE_PATH: {
      description:
        "A Chrome or Chromium to use for the accessibility scan, under the name Puppeteer uses. It wins over CHROME_PATH.",
    },
    IPC_HOOK_FULL: {
      description:
        "Set to 1 by the pre-commit hook. The pre-push hook then runs `--scope affected`, slow analyses included, instead of skipping Coverage, Crap and Mutation.",
    },
    IPC_MUTATION_SHARD: {
      description:
        "`i/n` makes the Mutation check mutate slice i of n, cut by file. The reusable contract workflow sets it per shard job. Ignored when IPC_MUTATION_REPORT is set.",
    },
    IPC_MUTATION_REPORT: {
      description:
        "A merged Stryker report for the Mutation check to judge instead of mutating. The reusable contract workflow sets it after merging the shards.",
    },
    IPC_MUTATION_MEMO: {
      description:
        "Set to 0 so a local run mutates again instead of reusing the last clean run. The memo is off under CI whatever this says.",
    },
    IPC_SOCKET_CACHE: {
      description:
        "Set to `off` so SecuritySocket asks Socket for every score instead of reading its on-disk cache.",
    },
    IPC_SOCKET_CACHE_DIR: {
      description:
        "Where SecuritySocket keeps its score cache. Empty means `~/.cache/ipc-socket-score-cache`. On Linux and macOS, a directory another user owns or can write is ignored. Windows checks neither; the per-user home is the boundary there.",
    },
    IPC_SOCKET_CACHE_TTL_HOURS: {
      description:
        "How many hours a cached Socket score stays valid. A value that is not a positive number means 24.",
    },
    CI: {
      description:
        "Set by the CI service. Readers disagree on its values. Any value but empty, `false` or `0` makes the run `--strict`, as `GITHUB_ACTIONS=true` does; the git hooks, CodeScanning and SecuritySocket agree. Any value but empty or `false` turns off the mutation memo (IPC_MUTATION_MEMO), so `CI=0` turns it off too. SurfaceContract counts only `true`, and the benchmark results location only `true` or `1`. CodeRabbit and the benchmark records count any non-empty value.",
    },
  },
})
