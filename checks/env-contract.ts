/**
 * `EnvContract`: the environment variables and secrets the package depends on are documented and
 * current.
 *
 * Reads: `ci/env.schema.ts` and the files `internal-package-contract env` generates from it,
 * through `scripts/check-env-contract.mjs` and `scripts/env/run.mjs`. The schema is read, never
 * executed.
 *
 * Never fails. Warns on a missing owner or expiry, and on a credential that is expiring or expired.
 * Warns on a generated file that is stale, and on a schema that cannot be read. Passes with no
 * `ci/env.schema.ts`: none is required.
 *
 * Exceptions: none needed; nothing here fails the run.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-env-contract.mjs")

interface EnvEnvelope {
  readonly ok: boolean
  readonly message?: string
  readonly state?: "absent" | "present"
  readonly contracts?: number
  readonly findings?: readonly { readonly message: string }[]
  readonly stale?: readonly string[]
}

/** @returns the `EnvContract` check. */
export function envContractCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<EnvEnvelope>(result, "check-env-contract", "EnvContract:")
      if (!envelope.ok) return { outcome: "warn", rationale: envelope.result.rationale }
      const report = envelope.value
      if (!report.ok) {
        return {
          outcome: "warn",
          rationale: `EnvContract: the environment contract could not be read, so it was not checked: ${String(report.message)}`,
        }
      }
      if (report.state === "absent") {
        return {
          outcome: "pass",
          rationale: "EnvContract: there is no ci/env.schema.ts, and none is required.",
        }
      }
      const problems = [
        ...(report.findings ?? []).map((finding) => finding.message),
        ...(report.stale ?? []).map(
          (file) => `${file} is out of date; run \`internal-package-contract env\` and commit it.`,
        ),
      ]
      if (problems.length === 0) {
        return {
          outcome: "pass",
          rationale: `EnvContract: ${String(report.contracts)} contract(s) documented, and the generated files are current.`,
        }
      }
      return {
        outcome: "warn",
        rationale: [
          `EnvContract: ${String(problems.length)} thing(s) to look at in the environment contract:`,
          ...problems.map((problem) => `- ${problem}`),
        ].join("\n"),
      }
    },
  }
}
