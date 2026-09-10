/**
 * Module-boundary / dependency-graph governance via dependency-cruiser. A generic
 * recreation of repo-contract's own `architecture` check.
 *
 * Uses the consumer's own `.dependency-cruiser.{js,cjs,mjs,json}` if present,
 * otherwise the bundled baseline (`config/dependency-cruiser.cjs`) -- so the
 * check enforces real rules out of the box, and a consumer only writes a config
 * to add package-specific boundaries.
 *
 * error-severity violations block; warn/info are reported but do not block --
 * matching repo-contract's own architecture policy and dependency-cruiser's own
 * severity model.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, resolveConfig } from "./shared.js"

interface DepcruiseViolation {
  readonly from: string
  readonly to: string
  readonly rule?: { readonly name?: string; readonly severity?: string }
}

interface DepcruiseReport {
  readonly summary?: {
    readonly violations?: readonly DepcruiseViolation[]
    readonly totalCruised?: number
  }
}

export const ARCHITECTURE_CONFIG_CANDIDATES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.json",
  ".dependency-cruiser.jsonc",
]

function render(v: DepcruiseViolation): string {
  return `${v.from} -> ${v.to} [${v.rule?.name ?? "unknown-rule"}]`
}

/**
 * @returns the `Architecture` check, wired to the consumer's dependency-cruiser config or the bundled default.
 */
export function architecture(): CheckDefinitionConfig {
  const config = resolveConfig(ARCHITECTURE_CONFIG_CANDIDATES, "dependency-cruiser.cjs")

  return {
    run: ["depcruise", "src", "--config", config.path, "--output-type", "json", "--no-progress"],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const terminated = abnormalTermination(result, "dependency-cruiser")
      if (terminated) return { outcome: "fail", rationale: terminated }

      if (!result.output?.success) {
        const printed = combinedOutput(result)
        return {
          outcome: "fail",
          rationale: `Architecture: dependency-cruiser output could not be parsed as JSON (does \`src/\` exist?).${printed ? `\n${printed}` : ""}`,
        }
      }

      const value: unknown = result.output.value
      if (typeof value !== "object" || value === null) {
        return {
          outcome: "fail",
          rationale: "Architecture: dependency-cruiser produced invalid JSON.",
        }
      }

      const violations = (value as DepcruiseReport).summary?.violations
      if (!Array.isArray(violations)) {
        return {
          outcome: "fail",
          rationale: "Architecture: dependency-cruiser produced invalid JSON.",
        }
      }

      const errors = violations.filter((v) => v.rule?.severity === "error")
      const nonErrors = violations.filter((v) => v.rule?.severity !== "error")
      const cruised = (value as DepcruiseReport).summary?.totalCruised ?? 0
      const via = config.isBundled ? " (bundled baseline config)" : ""

      if (errors.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `Architecture: ${String(errors.length)} error-severity violation(s) across ${String(cruised)} module(s)${via}:`,
            ...errors.map((v) => `- ${render(v)}`),
            ...(nonErrors.length > 0
              ? [`Plus ${String(nonErrors.length)} warn/info finding(s).`]
              : []),
          ].join("\n"),
        }
      }

      if (nonErrors.length > 0) {
        return {
          outcome: "warn",
          rationale: [
            `Architecture: ${String(nonErrors.length)} warn/info finding(s), 0 blocking, across ${String(cruised)} module(s)${via}:`,
            ...nonErrors.map((v) => `- ${render(v)}`),
          ].join("\n"),
        }
      }

      return {
        outcome: "pass",
        rationale: `Architecture: 0 violations across ${String(cruised)} module(s)${via}.`,
      }
    },
  }
}
