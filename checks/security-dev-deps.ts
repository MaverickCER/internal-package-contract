/**
 * Vulnerabilities in the DEVELOPMENT and CI tooling, via `npm audit`.
 *
 * `SecurityDeps` audits what users install (`npm audit --omit=dev`). The published packages in this
 * ecosystem have no runtime dependencies, so for them that audit is vacuous -- and the tooling that
 * builds, tests and publishes them (it runs in CI with repository credentials, and some of it in the
 * job that publishes) goes unaudited by the contract, left to Dependabot alone. This check closes that
 * gap: it finds every advisory that is reachable only through development dependencies
 * (`scripts/audit-dev-deps.mjs` audits the whole tree and the production tree and subtracts one from the
 * other).
 *
 * It is deliberately **not** a waivable finding with a registry record the way a runtime advisory is,
 * and not silent either:
 *
 * - a `critical` development-only advisory **fails**: tooling that runs in CI with write access is a
 *   supply-chain foothold, and a fix or a pinned override is nearly always available;
 * - anything lower is a `warn` that lists the packages (a `high` advisory with no patched release
 *   yet is common in a required chain), so it is visible in every report and step summary until
 *   Dependabot or an override resolves it.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "audit-dev-deps.mjs")

interface AuditReport {
  readonly vulnerabilities?: Record<string, { readonly severity?: string; readonly range?: string }>
}
type ToolResult =
  | { readonly ok: true; readonly all: AuditReport; readonly production: AuditReport }
  | { readonly ok: false; readonly error: string }

const BLOCKING = new Set(["critical"])
const MAX_LISTED = 15

/**
 * The advisories reachable only through development dependencies.
 * @param all - `npm audit --json` for the whole tree.
 * @param production - `npm audit --omit=dev --json`.
 * @returns One entry per package present in `all` and absent from `production`, most severe first.
 * @internal Exported for direct unit coverage.
 */
export function devOnlyFindings(
  all: AuditReport,
  production: AuditReport,
): readonly { readonly name: string; readonly severity: string; readonly range: string }[] {
  const shipped = new Set(Object.keys(production.vulnerabilities ?? {}))
  const rank = (severity: string): number =>
    ["critical", "high", "moderate", "low", "info"].indexOf(severity)
  return Object.entries(all.vulnerabilities ?? {})
    .filter(([name]) => !shipped.has(name))
    .map(([name, vulnerability]) => ({
      name,
      severity: typeof vulnerability.severity === "string" ? vulnerability.severity : "unknown",
      range: typeof vulnerability.range === "string" ? vulnerability.range : "unknown",
    }))
    .sort((a, b) => {
      const byRank =
        (rank(a.severity) === -1 ? 99 : rank(a.severity)) -
        (rank(b.severity) === -1 ? 99 : rank(b.severity))
      return byRank !== 0 ? byRank : a.name.localeCompare(b.name)
    })
}

/** @returns the `SecurityDevDeps` check. */
export function securityDevDeps(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const terminated = abnormalTermination(result, "npm audit")
      if (terminated) return { outcome: "fail", rationale: terminated }
      const envelope = parseToolEnvelope<ToolResult>(result, "npm audit", "Dev dependency audit:")
      if (!envelope.ok) return envelope.result
      const report = envelope.value
      if (!report.ok) {
        return { outcome: "fail", rationale: `Dev dependency audit: ${report.error}` }
      }

      const findings = devOnlyFindings(report.all, report.production)
      if (findings.length === 0) {
        return {
          outcome: "pass",
          rationale:
            "Dev dependency audit: no advisory is reachable only through development dependencies.",
        }
      }
      const blocking = findings.filter((finding) => BLOCKING.has(finding.severity))
      const lines = findings
        .slice(0, MAX_LISTED)
        .map((finding) => `- ${finding.name} [${finding.severity}] ${finding.range}`)
      const more =
        findings.length > MAX_LISTED ? [`...and ${String(findings.length - MAX_LISTED)} more.`] : []
      if (blocking.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `Dev dependency audit: ${String(blocking.length)} critical advisory(ies) in development tooling that runs in CI -- update the dependency or pin a fixed version with an \`overrides\` entry:`,
            ...blocking.map(
              (finding) => `- ${finding.name} [${finding.severity}] ${finding.range}`,
            ),
            ...(findings.length > blocking.length
              ? [`Plus ${String(findings.length - blocking.length)} lower-severity advisory(ies).`]
              : []),
          ].join("\n"),
        }
      }
      return {
        outcome: "warn",
        rationale: [
          `Dev dependency audit: ${String(findings.length)} advisory(ies) reachable only through development dependencies (none critical):`,
          ...lines,
          ...more,
        ].join("\n"),
      }
    },
  }
}
