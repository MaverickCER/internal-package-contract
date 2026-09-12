/**
 * Runtime dependency vulnerability scanning via `npm audit` (the `securityDeps` preset),
 * filtered against a reviewed set of well-known, no-fix-available transitive vulnerabilities in
 * this package's own dev-tooling stack -- a generic recreation of the exact filtering technique
 * repo-contract's own self-hosting `repo-contract.config.ts` uses for its `SecurityDeps` check
 * ("filter, then delegate to the real interpretation," the same technique `contract.ts`'s own
 * `TypeResolution` override uses for attw's `node10` problems).
 *
 * Every package in {@link DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS} is a transitive dependency
 * of this package's own tooling (npm's own arborist/pacote/sigstore chain via `licensee`, Vitest's
 * coverage internals, markdownlint-cli2's TOML parser, adm-zip via `github-actionlint`) -- never
 * reachable through a consumer's own runtime code -- where the only available fix requires either
 * an unverified breaking major bump or has no fix at all. A genuinely NEW, unreviewed
 * vulnerability (in a package not already named here, or a consumer's own real dependency) still
 * fails the check.
 */
import type { CheckDefinitionConfig, PolicyContext, PolicyResult } from "repo-contract"
import { securityDeps as securityDepsPreset } from "repo-contract/presets"

/**
 * Reviewed 2026-09-12. Revisit whenever any of these ships a patched release in its current major
 * line:
 * - `licensee`'s own dependency-resolution internals (npm's arborist/pacote/sigstore stack,
 *   needed for registry package-fetch/verify operations) -- this check's actual use of licensee
 *   only reads local `node_modules` license metadata already on disk; that code path never runs.
 * - `vitest`/`@vitest/coverage-v8`/`@vitest/mocker` -- fix requires a major bump this package's
 *   own `vitest.config.ts` integration is not yet verified against.
 * - `markdownlint-cli2`'s own transitive TOML parser (`smol-toml`) -- fix requires downgrading
 *   below this package's currently-required version.
 * - `adm-zip` (via `github-actionlint`) and `github-actionlint` itself have no fix available at
 *   any version.
 */
export const DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS: ReadonlySet<string> = new Set([
  "@npmcli/arborist",
  "@npmcli/metavuln-calculator",
  "@sigstore/core",
  "@sigstore/sign",
  "@sigstore/verify",
  "licensee",
  "pacote",
  "sigstore",
  "@vitest/coverage-v8",
  "@vitest/mocker",
  "vitest",
  "markdownlint-cli2",
  "smol-toml",
  "adm-zip",
  "github-actionlint",
])

interface NpmAuditVulnerability {
  readonly severity?: string
}
interface NpmAuditReport {
  readonly vulnerabilities?: Record<string, NpmAuditVulnerability>
  readonly metadata?: { readonly vulnerabilities?: Record<string, number> }
}

/** Drops every `accepted` entry from an `npm audit --json` report and recomputes `metadata.vulnerabilities`'s per-severity counts from what remains. */
function withoutAcceptedVulnerabilities(value: unknown, accepted: ReadonlySet<string>): unknown {
  if (typeof value !== "object" || value === null) return value
  const report = value as NpmAuditReport
  if (!report.vulnerabilities || typeof report.vulnerabilities !== "object") return value

  const kept: Record<string, NpmAuditVulnerability> = {}
  const counts: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (accepted.has(name)) continue
    kept[name] = vulnerability
    const severity = vulnerability.severity
    if (typeof severity === "string" && severity in counts) {
      counts[severity] = (counts[severity] ?? 0) + 1
    }
  }

  return {
    ...report,
    vulnerabilities: kept,
    metadata: {
      ...report.metadata,
      vulnerabilities: { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) },
    },
  }
}

/**
 * @param options.acceptedExceptions - additional package names, beyond
 * {@link DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS}, to also exclude -- a consumer's own reviewed
 * exceptions for findings specific to its own dependency tree.
 * @returns the `SecurityDeps` check.
 */
export function securityDeps(
  options: { readonly acceptedExceptions?: readonly string[] } = {},
): CheckDefinitionConfig {
  const accepted = new Set([
    ...DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS,
    ...(options.acceptedExceptions ?? []),
  ])

  return {
    ...securityDepsPreset,
    policy: async (ctx: PolicyContext): Promise<PolicyResult> => {
      if (!ctx.result.output?.success) return securityDepsPreset.policy(ctx)
      return securityDepsPreset.policy({
        ...ctx,
        result: {
          ...ctx.result,
          output: {
            format: "json",
            success: true,
            value: withoutAcceptedVulnerabilities(ctx.result.output.value, accepted),
          },
        },
      })
    },
  }
}
