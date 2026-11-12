/**
 * `DeadCode`: no unused file, export or dependency, as knip sees them.
 *
 * Reads: the package through repo-contract's `deadCode` preset (knip). The config is the package's
 * own `knip.{json,jsonc,ts,js}`, `knip.config.{ts,js}` or `.kniprc.json` when one exists. Else it
 * is the bundled `config/knip.json`: `src/index.ts` and common entry patterns, with `examples/` and
 * `dist/` ignored.
 *
 * Fails and warns exactly as the preset does; this file only chooses the config.
 *
 * Exceptions: none in a registry. A devDependency knip cannot see in use is passed as
 * `exemptUnusedDevDependencies`, or listed in the package's own knip config.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import type { CheckDefinitionConfig } from "repo-contract"
import { deadCode as deadCodePreset } from "repo-contract/presets"
import { resolveConfig } from "./shared.js"

const CONFIG_CANDIDATES = [
  "knip.json",
  "knip.jsonc",
  "knip.ts",
  "knip.js",
  "knip.config.ts",
  "knip.config.js",
  ".kniprc.json",
]

/**
 * @param options.exemptUnusedDevDependencies - devDependency names knip cannot see are used (passed through to the preset).
 * @returns the `DeadCode` check.
 */
export function deadCode(
  options: { readonly exemptUnusedDevDependencies?: readonly string[] } = {},
): CheckDefinitionConfig {
  const preset = deadCodePreset(options)
  const config = resolveConfig(CONFIG_CANDIDATES, "knip.json")

  return config.isBundled
    ? { ...preset, run: [...(preset.run as string[]), "--config", config.path] }
    : preset
}
