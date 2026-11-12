/**
 * `BenchmarkGuides`: the package's `benchmarks/WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md`
 * are identical to the canonical copies in this package's `template/benchmarks/`.
 *
 * Reads: those two files under `benchmarks/`, through `scripts/benchmark-guides.mjs --check`.
 *
 * Fails when either guide is missing or differs. Never warns. Passes when there is no `benchmarks/`
 * directory.
 *
 * Exceptions: none. `npx internal-package-contract sync-benchmark-guides` rewrites both; commit the
 * result.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out.
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
