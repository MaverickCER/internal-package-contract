/**
 * The package's copies of `WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md` must be identical to
 * the canonical ones this package ships (`template/benchmarks/`). The guides explain how benchmarks
 * are written and read and are the same for every package; four hand-kept copies drifted from the kit
 * they describe. `npx internal-package-contract sync-benchmark-guides` rewrites them.
 *
 * A package with no `benchmarks/` directory has nothing to compare and passes.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "benchmark-guides.mjs")

type ToolResult = {
  readonly ok: true
  readonly applicable: boolean
  readonly missing: readonly string[]
  readonly differing: readonly string[]
}

/** @returns the `BenchmarkGuides` check. */
export function benchmarkGuides(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath, "--check"],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<ToolResult>(result, "node", "Benchmark guides:")
      if (!envelope.ok) return envelope.result
      const { applicable, missing, differing } = envelope.value
      if (!applicable) {
        return { outcome: "pass", rationale: "Benchmark guides: no benchmarks/ directory." }
      }
      if (missing.length === 0 && differing.length === 0) {
        return {
          outcome: "pass",
          rationale: "Benchmark guides: both copies are identical to the canonical ones.",
        }
      }
      return {
        outcome: "fail",
        rationale: [
          "Benchmark guides: the copies in benchmarks/ differ from the canonical ones this package ships.",
          ...missing.map((guide) => `- ${guide} is missing`),
          ...differing.map((guide) => `- ${guide} differs`),
          "Run `npx internal-package-contract sync-benchmark-guides` and commit the result.",
        ].join("\n"),
      }
    },
  }
}
