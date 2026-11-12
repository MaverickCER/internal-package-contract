/**
 * `SecuritySecrets`: no secret is committed, as secretlint finds them.
 *
 * Reads: the files git tracks or would track, listed by `scripts/run-secretlint.mjs`. Listing them
 * keeps secretlint from expanding its recursive glob over generated trees first. Also the bundled
 * `config/secretlintignore`. The rules are the package's own `.secretlintrc.*` or
 * `secretlint.config.*` when one exists, else the bundled `config/secretlint.config.json`
 * (`@secretlint/secretlint-rule-preset-recommend`). Outside a git repository, or with too many
 * files for one command line, the glob is passed through unchanged.
 *
 * Fails and warns exactly as repo-contract's `securitySecrets` preset does on secretlint's report.
 * This file only chooses the files and the config.
 *
 * Exceptions: none in a registry. A `secretlint-disable` comment is read back by `Suppressions`.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import type { CheckDefinitionConfig } from "repo-contract"
import { securitySecrets as securitySecretsPreset } from "repo-contract/presets"
import { bundledConfig, resolveConfig } from "./shared.js"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Lists the repository's own files for secretlint instead of letting it expand the recursive glob over every generated directory.
const runSecretlint = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/run-secretlint.mjs",
)

const CONFIG_CANDIDATES = [
  ".secretlintrc.json",
  ".secretlintrc.jsonc",
  ".secretlintrc.yml",
  ".secretlintrc.yaml",
  ".secretlintrc.js",
  ".secretlintrc",
  "secretlint.config.js",
  "secretlint.config.mjs",
]

/** @returns the `SecuritySecrets` check. */
export function securitySecrets(): CheckDefinitionConfig {
  const rc = resolveConfig(CONFIG_CANDIDATES, "secretlint.config.json")
  const presetRun = securitySecretsPreset.run as string[]

  // presetRun ends with the "**/*" positional; insert flags before it.
  const positional = presetRun.at(-1)
  const head = presetRun.slice(0, -1)

  const run = [
    ...head,
    "--secretlintignore",
    bundledConfig("secretlintignore"),
    ...(rc.isBundled ? ["--secretlintrc", rc.path] : []),
    ...(positional ? [positional] : []),
  ]

  return { ...securitySecretsPreset, run: ["node", runSecretlint, ...run] }
}
