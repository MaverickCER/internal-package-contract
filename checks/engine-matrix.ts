/**
 * A package's `engines.node` is a promise, so CI has to run on the version it names. This fails when a
 * published package declares no minimum Node.js, declares one that cannot be read, or declares one that no
 * workflow tests (see scripts/engines/validate.mjs). A private package makes no promise and is exempt.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-engines.mjs")

interface EngineReport {
  readonly ok: boolean
  readonly state: "exempt" | "ok" | "no-engines" | "unreadable" | "untested"
  readonly minimum?: number
  readonly tested?: readonly number[]
}

/** @returns the `EngineMatrix` check. */
export function engineMatrixCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<EngineReport>(result, "check-engines", "EngineMatrix:")
      if (!envelope.ok) return envelope.result
      const { state, minimum, tested = [] } = envelope.value
      switch (state) {
        case "exempt":
          return {
            outcome: "pass",
            rationale: "EngineMatrix: this package is private, so it promises no Node.js version.",
          }
        case "ok":
          return {
            outcome: "pass",
            rationale: `EngineMatrix: a workflow tests the declared minimum, Node.js ${String(minimum)} (tested: ${tested.join(", ")}).`,
          }
        case "no-engines":
          return {
            outcome: "fail",
            rationale:
              'EngineMatrix: package.json declares no `engines.node`, so there is no supported minimum to test. Add one, for example "node": ">=22".',
          }
        case "unreadable":
          return {
            outcome: "fail",
            rationale:
              "EngineMatrix: `engines.node` is not a range this check can read a minimum from. Use a form such as `>=22`, `^22` or `22.x`.",
          }
        default:
          return {
            outcome: "fail",
            rationale: `EngineMatrix: package.json promises Node.js ${String(minimum)} and up, but no workflow runs on Node.js ${String(minimum)} (workflows test: ${tested.length === 0 ? "none" : tested.join(", ")}). Add it to a test job's \`node-version\`.`,
          }
      }
    },
  }
}
