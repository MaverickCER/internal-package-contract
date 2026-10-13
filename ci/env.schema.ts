// What this repository's workflows and scripts read from the environment, written down once. None of it is required:
// every variable has a default, a missing credential is a warning, and a setting falls back to a sensible value.
// `internal-package-contract env` reads this file (it never runs it) and writes docs/ENVIRONMENT.md.
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
}

export const ciSecretsEnv = createEnv(ciSecrets, { name: "ci-secrets" })
export const toolSettingsEnv = createEnv(toolSettings, { name: "tool-settings" })

documentEnv(ciSecrets, {
  category: "CI secrets",
  variables: {
    PIN_SYNC_TOKEN: {
      description:
        "Optional. Lets the pin-sync workflow change workflow files and start CI on its pull request; without it the workflow cannot push workflow-file changes, and `internal-package-contract upgrade <tag>` does the same by hand.",
      refreshInstructions:
        "Create a fine-grained personal access token for this repository with Contents, Pull requests and Workflows write access, then replace the repository secret PIN_SYNC_TOKEN (Settings > Secrets and variables > Actions). Then give it an `expiresAt` here (the token's expiry), so a weekly check can warn before it lapses.",
      sensitivity: "secret",
    },
    SOCKET_SECURITY_API_KEY: {
      description:
        "Optional. Read by the `socket` CLI while the contract runs, for the SecuritySocket check; without it that check reports a warning and the rest of the contract runs.",
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
  },
})
