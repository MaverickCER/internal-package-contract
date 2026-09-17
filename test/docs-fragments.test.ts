import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { docsFragments } from "../checks/docs-fragments.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-docs-fragments-test-"))
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe("docsFragments (policy)", () => {
  it("passes when the scan found nothing broken", async () => {
    const result = await docsFragments.policy(makeContext(makeJsonResult({ ok: true, broken: [] })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Docs (fragments): every local heading link resolves.",
    })
  })

  it("fails when the scan itself terminated abnormally, naming check-docs-fragments (not a blank tool name) in the rationale", async () => {
    const result = await docsFragments.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "check-docs-fragments did not run to completion (status: timed_out).",
    })
  })

  it("fails, appending printed output, when the scan's output could not be parsed as JSON", async () => {
    const result = await docsFragments.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw output",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Docs (fragments): output could not be parsed as JSON.\nraw output",
    })
  })

  it("fails when the scan itself reported ok: false", async () => {
    const result = await docsFragments.policy(
      makeContext(makeJsonResult({ ok: false, error: "glob failed" })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Docs (fragments): scan failed: glob failed.",
    })
  })

  it("falls back to 'unknown error' when the scan reports ok: false with no error field at all", async () => {
    const result = await docsFragments.policy(makeContext(makeJsonResult({ ok: false })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Docs (fragments): scan failed: unknown error.",
    })
  })

  it("treats a missing broken field as no broken links (not just an empty array)", async () => {
    const result = await docsFragments.policy(makeContext(makeJsonResult({ ok: true })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Docs (fragments): every local heading link resolves.",
    })
  })

  it("fails, listing each broken fragment with its available headings", async () => {
    const result = await docsFragments.policy(
      makeContext(
        makeJsonResult({
          ok: true,
          broken: [
            {
              file: "CONTRIBUTING.md",
              line: 26,
              target: "examples/README.md",
              fragment: "expected--golden-regression-fixtures",
              availableFragments: ["golden-regression-testing", "looking-for-something-specific"],
            },
          ],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Docs (fragments): 1 broken heading link(s):",
        "- CONTRIBUTING.md:26 -- #expected--golden-regression-fixtures does not match any heading in examples/README.md. Available: golden-regression-testing, looking-for-something-specific",
      ].join("\n"),
    })
  })

  it("reports '(no headings)' when the target file has none", async () => {
    const result = await docsFragments.policy(
      makeContext(
        makeJsonResult({
          ok: true,
          broken: [
            {
              file: "README.md",
              line: 3,
              target: "NOTES.md",
              fragment: "x",
              availableFragments: [],
            },
          ],
        }),
      ),
    )
    expect(result.rationale).toContain("(no headings)")
  })
})

describe("check-docs-fragments.mjs (scan script)", () => {
  function write(relPath: string, content: string): void {
    const fullPath = path.join(cwd, relPath)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, "utf8")
  }

  async function runScan(): Promise<{ ok: boolean; broken?: unknown[]; error?: string }> {
    const { execFileSync } = await import("node:child_process")
    const scriptPath = path.resolve(import.meta.dirname, "../scripts/check-docs-fragments.mjs")
    const stdout = execFileSync("node", [scriptPath], { cwd, encoding: "utf8" })
    return JSON.parse(stdout)
  }

  it("passes a bare same-file fragment that matches a real heading", async () => {
    write("README.md", "# Title\n\n## Quick Start\n\n[go](#quick-start)\n")
    const report = await runScan()
    expect(report.ok).toBe(true)
    expect(report.broken).toEqual([])
  })

  it("catches a broken bare same-file fragment", async () => {
    write("README.md", "# Title\n\n## Quick Start\n\n[go](#installation)\n")
    const report = await runScan()
    expect(report.broken).toHaveLength(1)
    expect(report.broken?.[0]).toMatchObject({
      file: "README.md",
      target: "README.md",
      fragment: "installation",
      availableFragments: ["quick-start", "title"],
    })
  })

  it("catches a broken self-referencing filename#fragment link -- the exact bug this check exists for", async () => {
    write("README.md", "# Title\n\n## Quick Start\n\n[go](README.md#installation)\n")
    const report = await runScan()
    expect(report.broken).toHaveLength(1)
    expect(report.broken?.[0]).toMatchObject({ fragment: "installation" })
  })

  it("validates a cross-file fragment against the TARGET file's own headings", async () => {
    write("README.md", "[link](GUIDE.md#setup)\n")
    write("GUIDE.md", "# Guide\n\n## Setup\n")
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("catches a broken cross-file fragment", async () => {
    write("README.md", "[link](GUIDE.md#setup)\n")
    write("GUIDE.md", "# Guide\n\n## Installation\n")
    const report = await runScan()
    expect(report.broken).toHaveLength(1)
    expect(report.broken?.[0]).toMatchObject({
      file: "README.md",
      target: "GUIDE.md",
      fragment: "setup",
      availableFragments: ["guide", "installation"],
    })
  })

  it("skips a fragment link whose target file does not exist on disk (DocsLinks' job)", async () => {
    write("README.md", "[link](MISSING.md#setup)\n")
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("ignores an external http(s) link with a fragment", async () => {
    write("README.md", "[link](https://example.com/page#section)\n")
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("ignores a mailto: link", async () => {
    write("README.md", "[email](mailto:a@example.com#x)\n")
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("never treats content inside a fenced code block as a real heading or a real link", async () => {
    write(
      "README.md",
      ["# Title", "", "```md", "## Fake Heading", "[bad](#fake-heading)", "```", ""].join("\n"),
    )
    const report = await runScan()
    // The fenced `[bad](#fake-heading)` is stripped before link-scanning, so it never surfaces
    // as broken even though "fake-heading" matches no real heading.
    expect(report.broken).toEqual([])
  })

  it("strips inline formatting (code span, bold, link) from heading text before slugging", async () => {
    write(
      "README.md",
      [
        "# Title",
        "",
        "## `createEnv()` reference",
        "",
        "## **Bold** section",
        "",
        "[a](#createenv-reference)",
        "[b](#bold-section)",
      ].join("\n"),
    )
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("applies GitHub's own duplicate-heading suffixing (-1, -2, ...)", async () => {
    write(
      "README.md",
      ["# Title", "", "## Usage", "", "## Usage", "", "[a](#usage)", "[b](#usage-1)"].join("\n"),
    )
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("resolves a cross-file link relative to the SOURCE file's own directory, not the repo root", async () => {
    write("docs/guide.md", "[link](../README.md#top)\n")
    write("README.md", "# Top\n")
    const report = await runScan()
    expect(report.broken).toEqual([])
  })

  it("excludes docs/api-report/** from both source scanning and heading targets outside it", async () => {
    write("docs/api-report/generated.md", "[bad](#nonexistent)\n")
    const report = await runScan()
    // docs/api-report/generated.md is excluded from the set of files scanned for outgoing
    // links, so its own broken fragment is never reported.
    expect(report.broken).toEqual([])
  })
})
