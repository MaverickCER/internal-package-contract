import { describe, expect, it } from "vitest"
import { accessibility } from "../checks/accessibility.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

function makeFindingsResult(findings: readonly Record<string, unknown>[], pagesScanned = 1) {
  return makeJsonResult({ ok: true, value: findings, pagesScanned })
}

describe("accessibility", () => {
  it("fails when pa11y terminated abnormally, naming pa11y (not a blank tool name) in the rationale", async () => {
    const result = await accessibility.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "pa11y did not run to completion (status: timed_out).",
    })
  })

  it("fails, appending printed output, when the scan script's own output could not be parsed as JSON", async () => {
    const result = accessibility.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw pa11y output",
        }),
      ),
    )
    expect(await result).toEqual({
      outcome: "fail",
      rationale: "Accessibility: pa11y output could not be parsed as JSON.\nraw pa11y output",
    })
  })

  it("fails when the scan script itself reported an unrecognized ok: false error", async () => {
    const result = accessibility.policy(
      makeContext(
        makeJsonResult({ ok: false, error: "docs/api/ exists but its landing page does not" }),
      ),
    )
    expect(await result).toEqual({
      outcome: "fail",
      rationale:
        "Accessibility: pa11y could not be evaluated: docs/api/ exists but its landing page does not",
    })
  })

  it("warns (not fails) when no system Chrome/Chromium executable was found", async () => {
    const result = accessibility.policy(
      makeContext(
        makeJsonResult({
          ok: false,
          error:
            "no system Chrome/Chromium executable found. Install one, or set PUPPETEER_EXECUTABLE_PATH.",
        }),
      ),
    )
    expect(await result).toEqual({
      outcome: "warn",
      rationale:
        "Accessibility: no system Chrome/Chromium executable found. Install one, or set PUPPETEER_EXECUTABLE_PATH.",
    })
  })

  it("passes with 0 findings across a real scan of N pages", async () => {
    const result = accessibility.policy(makeContext(makeFindingsResult([], 2)))
    expect(await result).toEqual({
      outcome: "pass",
      rationale:
        "Accessibility: pa11y reported 0 WCAG2AA issues across the scanned pages (0 finding(s) total, all informational).",
    })
  })

  it("warns (not vacuously passes) when no built docs site existed to scan", async () => {
    const result = accessibility.policy(makeContext(makeFindingsResult([], 0)))
    expect(await result).toEqual({
      outcome: "warn",
      rationale:
        "Accessibility: no built docs site found to scan (looked for docs/index.html, docs/api/index.html).",
    })
  })

  it("passes, noting the total, when every finding is informational (notice)", async () => {
    const result = accessibility.policy(
      makeContext(
        makeFindingsResult([
          { code: "c1", type: "notice", message: "m", context: null, selector: "s", page: "p" },
        ]),
      ),
    )
    expect(await result).toEqual({
      outcome: "pass",
      rationale:
        "Accessibility: pa11y reported 0 WCAG2AA issues across the scanned pages (1 finding(s) total, all informational).",
    })
  })

  it("warns (not fails) on a warning-type finding, dropping notices from the rationale", async () => {
    const result = accessibility.policy(
      makeContext(
        makeFindingsResult([
          {
            code: "c1",
            type: "warning",
            message: "contrast too low",
            context: null,
            selector: "h1",
            page: "docs/index.html",
          },
          {
            code: "c2",
            type: "notice",
            message: "ignored",
            context: null,
            selector: "p",
            page: "docs/index.html",
          },
        ]),
      ),
    )
    expect(await result).toEqual({
      outcome: "warn",
      rationale: [
        "Accessibility: pa11y reported 0 errors, but 1 warning(s):",
        "- docs/index.html -- h1 [c1]: contrast too low",
      ].join("\n"),
    })
  })

  it("fails, formatting each error and never surfacing a coexisting warning line", async () => {
    const result = accessibility.policy(
      makeContext(
        makeFindingsResult([
          {
            code: "c1",
            type: "error",
            message: "missing alt text",
            context: null,
            selector: "img",
            page: "docs/index.html",
          },
          {
            code: "c2",
            type: "warning",
            message: "ignored",
            context: null,
            selector: "p",
            page: "docs/index.html",
          },
        ]),
      ),
    )
    expect(await result).toEqual({
      outcome: "fail",
      rationale: [
        "Accessibility: pa11y reported 1 WCAG2AA error(s) across the scanned pages:",
        "- docs/index.html -- img [c1]: missing alt text",
      ].join("\n"),
    })
  })
})
