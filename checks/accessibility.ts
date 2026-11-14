/**
 * `Accessibility`: the package's committed docs site has no WCAG 2 AA error.
 *
 * Reads: the HTML pages `scripts/accessibility-pages.mjs` resolves under `docs/`. pa11y scans each
 * in a headless Chrome, through `scripts/check-accessibility.mjs`. Chrome comes from
 * `PUPPETEER_EXECUTABLE_PATH` or `CHROME_PATH` when set, else the platform's usual install
 * locations. Nothing is downloaded: an install script is a supply-chain finding of its own.
 *
 * Fails on any pa11y finding of type `error`. Warns on `warning` findings when there is no error.
 * Drops `notice` findings. Fails when the scan script reports an error other than a missing
 * browser.
 *
 * Exceptions: none for a finding. Two degradations exist: no Chrome (`Accessibility:no-chrome`) and
 * no built site (`Accessibility:no-site`). Each warns locally. Under `--strict`, the CI default,
 * each fails unless `.repo-contract/exceptions/environment.json` holds a complete record. The
 * record id is `environment:Accessibility:<code>`.
 *
 * Runs in the consumer `contract` job and in both git hooks. It reads `docs/api/` after the writers
 * regenerated it. IPC's own self-contract leaves it out: this package is private and publishes no
 * site.
 *
 * Limit: some results are counted but never failed on. Those are results axe marks for manual
 * review, TypeDoc's nested-interactive navigation result, and HTML_CodeSniffer's duplicate-id
 * result on prototype-named ids.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { degraded } from "./environment-exceptions.js"
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
  | {
      readonly ok: true
      readonly value: T
      readonly pagesScanned: number
      readonly needsReview?: number
      readonly typedocNavNestedInteractive?: number
      readonly htmlcsPrototypeIdFalsePositives?: number
    }
  | { readonly ok: false; readonly error: string }

/** @returns A single-line `page at selector [code]: message` summary. */
function formatFinding(finding: Pa11yFinding): string {
  return `${finding.page} at ${finding.selector} [${finding.code}]: ${finding.message}`
}

// "error"-type findings fail; "warning" surfaces as warn (never blocks);
// "notice" is too noisy relative to its actionability to gate on and is
// dropped from the rationale entirely: matches repo-contract's own
// accessibility check exactly.
export const accessibility: CheckDefinitionConfig = {
  run: ["node", accessibilityScript],
  output: { format: "json" },
  policy: async ({ result }): Promise<PolicyResult> => {
    const envelope = parseToolEnvelope<ToolResult<readonly Pa11yFinding[]>>(
      result,
      "pa11y",
      "Accessibility: pa11y",
    )
    if (!envelope.ok) return envelope.result

    const evidence = envelope.value
    if (!evidence.ok) {
      if (evidence.error.startsWith("no system Chrome/Chromium executable found")) {
        return degraded({
          check: "Accessibility",
          code: "no-chrome",
          rationale: `Accessibility: ${evidence.error}`,
        })
      }
      return {
        outcome: "fail",
        rationale: `Accessibility: pa11y could not be evaluated: ${evidence.error}`,
      }
    }

    // A genuinely absent built docs site (neither docs/index.html nor docs/api/index.html
    // exists) is not the same thing as a clean scan: pa11y never ran against anything, so
    // "0 issues" here would be false confidence, not a real pass. Distinct from the 0-pages
    // case, a real scan that finds 0 issues across N pages still reports `pass` below.
    if (evidence.pagesScanned === 0) {
      return degraded({
        check: "Accessibility",
        code: "no-site",
        rationale:
          "Accessibility: no built docs site found to scan (looked for docs/index.html, docs/api/index.html).",
      })
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

    const setAside = evidence.needsReview ?? 0
    const nav = evidence.typedocNavNestedInteractive ?? 0
    const navNote =
      nav > 0
        ? ` ${String(nav)} nested-interactive result(s) in TypeDoc's generated navigation tree were set aside (an upstream TypeDoc defect: the module link is the entry's label).`
        : ""
    const htmlcs = evidence.htmlcsPrototypeIdFalsePositives ?? 0
    const htmlcsNote =
      htmlcs > 0
        ? ` ${String(htmlcs)} HTML_CodeSniffer duplicate-id result(s) for ids named like Object.prototype members (e.g. TypeDoc's #constructor) were set aside: the rule tracks ids in a plain object and reports them as duplicates of themselves.`
        : ""
    const note =
      (setAside > 0
        ? ` ${String(setAside)} axe result(s) that axe itself marks as needing manual review (it could not read the background behind the text, e.g. inside an SVG or under a sticky element) were set aside; the benchmark chart colour pairs are asserted numerically by internal-package-contract's own tests.`
        : "") +
      navNote +
      htmlcsNote
    return {
      outcome: "pass",
      rationale: `Accessibility: pa11y reported 0 WCAG2AA issues across the scanned pages (${String(evidence.value.length)} finding(s) total, all informational).${note}`,
    }
  },
}
