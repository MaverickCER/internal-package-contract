/**
 * Dead-code / unused-dependency detection via knip (the `deadCode` preset),
 * pointed at the consumer's own `knip.{json,jsonc,ts,js}` if present, otherwise
 * the bundled baseline (`config/knip.json` -- `src/index.ts` + common entry
 * patterns, `src/**` project, `examples/`/`dist/` ignored).
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

  // `knip` hoisted out as a literal first element (rather than spreading `preset.run` at
  // position 0) so the preset-commands scan (checks/preset-commands.ts) sees a
  // statically-resolvable command; `preset.run`'s own remaining elements still come through
  // dynamically via `.slice(1)`.
  return {
    ...preset,
    run: [
      "knip",
      ...(preset.run as string[]).slice(1),
      ...(config.isBundled ? ["--config", config.path] : []),
    ],
  }
}
