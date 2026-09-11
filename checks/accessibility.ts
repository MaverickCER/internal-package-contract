/**
 * WCAG2AA accessibility scan of a consumer's own built docs site, via pa11y --
 * a generic recreation of repo-contract's own `accessibility` check, run
 * through the bundled `scripts/check-accessibility.mjs` (see its own doc
 * comment for exactly which pages are scanned, and why).
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, packageRoot } from "./shared.js"

const accessibilityScript = path.join(packageRoot, "scripts", "check-accessibility.mjs")

/**
 * One pa11y finding, `--reporter json` shape (not published as a TypeScript type by the tool),
 * plus the `page` check-accessibility.mjs attaches so a finding names which scanned page it is on.
 */
interface Pa11yFinding {
  readonly code: string
  readonly type: "error" | "warning" | "notice"
  readonly message: string
  readonly context: string | null
  readonly selector: string
  readonly page: string
}

type ToolResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** @returns A single-line `page -- selector [code]: message` summary. */
function formatFinding(finding: Pa11yFinding): string {
  return `${finding.page} -- ${finding.selector} [${finding.code}]: ${finding.message}`
}

// "error"-type findings fail; "warning" surfaces as warn (never blocks);
// "notice" is too noisy relative to its actionability to gate on and is
// dropped from the rationale entirely -- matches repo-contract's own
// accessibility check exactly.
export const accessibility: CheckDefinitionConfig = {
  run: ["node", accessibilityScript],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    const terminated = abnormalTermination(result, "pa11y")
    if (terminated) return { outcome: "fail", rationale: terminated }

    const value: unknown = result.output?.success ? result.output.value : undefined
    if (!value || typeof value !== "object" || !("ok" in value)) {
      const printed = combinedOutput(result)
      return {
        outcome: "fail",
        rationale: `Accessibility: pa11y output could not be parsed as JSON.${printed ? `\n${printed}` : ""}`,
      }
    }

    const evidence = value as ToolResult<readonly Pa11yFinding[]>
    if (!evidence.ok) {
      return {
        outcome: "fail",
        rationale: `Accessibility: pa11y could not be evaluated: ${evidence.error}`,
      }
    }

    const errors = evidence.value.filter((finding) => finding.type === "error")
    const warnings = evidence.value.filter((finding) => finding.type === "warning")

    if (errors.length > 0) {
      return {
        outcome: "fail",
        rationale: [
          `Accessibility: pa11y reported ${String(errors.length)} WCAG2AA error(s) across the scanned pages:`,
          ...errors.map((finding) => `- ${formatFinding(finding)}`),
        ].join("\n"),
      }
    }

    if (warnings.length > 0) {
      return {
        outcome: "warn",
        rationale: [
          `Accessibility: pa11y reported 0 errors, but ${String(warnings.length)} warning(s):`,
          ...warnings.map((finding) => `- ${formatFinding(finding)}`),
        ].join("\n"),
      }
    }

    return {
      outcome: "pass",
      rationale: `Accessibility: pa11y reported 0 WCAG2AA issues across the scanned pages (${String(evidence.value.length)} finding(s) total, all informational).`,
    }
  },
}
