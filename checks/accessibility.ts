/**
 * WCAG2AA accessibility scan of a consumer's own built docs site, via pa11y --
 * a generic recreation of repo-contract's own `accessibility` check, run
 * through the bundled `scripts/check-accessibility.mjs` (see its own doc
 * comment for exactly which pages are scanned, and why).
 *
 * `pa11y` is a real, hard dependency (package.json) -- never something a consumer (env-cap,
 * data-cap, ...) has to separately install -- but its own `puppeteer` dependency is aliased to
 * `puppeteer-core` via package.json's `overrides`, so no Chromium-download postinstall script
 * ever runs (a Socket.dev "Install scripts" finding directly hurts a public package's own
 * supply-chain score). `puppeteer-core` bundles no browser, so the scan script auto-detects a
 * system Chrome/Chromium instead; not finding one is a `warn`, exactly like `SecuritySocket`'s
 * own `@socketsecurity/cli`-not-authenticated case -- this check cannot distinguish "genuinely
 * clean" from "never ran," so it never fails closed on absence alone.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

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
  | { readonly ok: true; readonly value: T; readonly pagesScanned: number }
  | { readonly ok: false; readonly error: string }

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
    const envelope = parseToolEnvelope<ToolResult<readonly Pa11yFinding[]>>(
      result,
      "pa11y",
      "Accessibility: pa11y",
    )
    if (!envelope.ok) return envelope.result

    const evidence = envelope.value
    if (!evidence.ok) {
      if (evidence.error.startsWith("no system Chrome/Chromium executable found")) {
        return { outcome: "warn", rationale: `Accessibility: ${evidence.error}` }
      }
      return {
        outcome: "fail",
        rationale: `Accessibility: pa11y could not be evaluated: ${evidence.error}`,
      }
    }

    // A genuinely absent built docs site (neither docs/index.html nor docs/api/index.html
    // exists) is not the same thing as a clean scan -- pa11y never ran against anything, so
    // "0 issues" here would be false confidence, not a real pass. Distinct from the 0-pages
    // case, a real scan that finds 0 issues across N pages still reports `pass` below.
    if (evidence.pagesScanned === 0) {
      return {
        outcome: "warn",
        rationale:
          "Accessibility: no built docs site found to scan (looked for docs/index.html, docs/api/index.html).",
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
