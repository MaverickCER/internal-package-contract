/**
 * Secret-leak scanning via secretlint (the `securitySecrets` preset).
 *
 * secretlint ships no rules and no ignore defaults, so this always passes the
 * bundled `config/secretlintignore` (node_modules, dist, lockfiles, ...) and,
 * when the consumer has no `.secretlintrc.*`, the bundled
 * `config/secretlint.config.json` (`@secretlint/secretlint-rule-preset-recommend`,
 * which ships with this package).
 */
import type { CheckDefinitionConfig } from "repo-contract"
import { securitySecrets as securitySecretsPreset } from "repo-contract/presets"
import { bundledConfig, resolveConfig } from "./shared.js"

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
  // `secretlint` hoisted out as a literal first element (rather than spreading `head`, which
  // starts with it, at position 0) so the preset-commands scan (checks/preset-commands.ts) sees a
  // statically-resolvable command; `head`'s own remaining elements still come through dynamically.
  const head = presetRun.slice(1, -1)

  return {
    ...securitySecretsPreset,
    run: [
      "secretlint",
      ...head,
      "--secretlintignore",
      bundledConfig("secretlintignore"),
      ...(rc.isBundled ? ["--secretlintrc", rc.path] : []),
      ...(positional ? [positional] : []),
    ],
  }
}
