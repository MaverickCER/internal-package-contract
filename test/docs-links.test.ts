import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { docsLinks } from "../checks/docs-links.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-docs-links-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

/** The scan script's own combined-crawl envelope (see scripts/check-docs-links.mjs) -- `docsLinks.policy` reads `{ ok: true, value: { links } }`, never a bare `{ links }`. */
function makeLinksResult(links: readonly Record<string, unknown>[]) {
  return makeJsonResult({ ok: true, value: { links } })
}

describe("docsLinks", () => {
  it("passes when there is no README.md and no docs/index.html", async () => {
    const result = await docsLinks.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Docs (links): no README.md or docs/index.html.",
    })
  })

  it("fails when linkinator terminated abnormally", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
  })

  it("fails, appending printed output, when the scan script's own output could not be parsed as JSON", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw linkinator output",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Docs (links): linkinator output could not be parsed as JSON.\nraw linkinator output",
    })
  })

  it("fails when the scan script itself reported ok: false", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(makeJsonResult({ ok: false, error: "linkinator is not installed" })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Docs (links): linkinator could not be evaluated: linkinator is not installed",
    })
  })

  it("passes with 0 broken links, with the exact stock rationale and no external note", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(makeLinksResult([{ url: "./a.md", state: "OK" }])),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Docs (links): 0 broken local link(s) across 1 checked.",
    })
  })

  it("treats a link whose stripped path is empty (a bare #fragment) as not existing locally -- never resolves to cwd itself", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([{ url: "#section", state: "BROKEN", status: 404, parent: "README.md" }]),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("#section")
  })

  it("classifies a bare `http://` link (no s) as external, not local -- the scheme's 's' is optional", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([{ url: "http://example.com/gone", state: "BROKEN", status: 404 }]),
      ),
    )
    expect(result.outcome).toBe("warn")
  })

  it("does not classify a URL that merely CONTAINS 'https://' mid-string as external -- the scheme must anchor the start", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([
          {
            url: "./redirect?to=https://example.com",
            state: "BROKEN",
            status: 404,
            parent: "README.md",
          },
        ]),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("broken local link(s)")
  })

  it("strips a multi-character #fragment/?query entirely, not just its first character, before checking existence", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    writeFileSync(path.join(cwd, "guide.md"), "# guide")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([{ url: "./guide.md#a-long-section-name", state: "BROKEN", status: 404 }]),
      ),
    )
    expect(result.outcome).toBe("pass")
  })

  it("separates local and external broken links correctly when a report mixes both", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([
          { url: "./missing.md", state: "BROKEN", status: 404, parent: "README.md" },
          { url: "https://example.com/gone", state: "BROKEN", status: 404 },
        ]),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Docs (links): 1 broken local link(s):",
        "- ./missing.md (from README.md) -- HTTP 404",
      ].join("\n"),
    })
  })

  it("treats a broken local link that resolves to a real file/dir on disk as fine (linkinator's own directory-link 404 quirk)", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    mkdirSync(path.join(cwd, "specs"), { recursive: true })
    const result = await docsLinks.policy(
      makeContext(makeLinksResult([{ url: "./specs", state: "BROKEN", status: 404 }])),
    )
    expect(result.outcome).toBe("pass")
  })

  it("warns (not fails) on a broken EXTERNAL link that doesn't exist locally", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([{ url: "https://example.com/gone", state: "BROKEN", status: 404 }]),
      ),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale:
        "Docs (links): 0 broken local link(s) across 1 checked (1 external link(s) also unreachable -- not blocking).",
    })
  })

  it("fails, naming the parent, on a broken LOCAL link", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(
      makeContext(
        makeLinksResult([
          { url: "./missing.md", state: "BROKEN", status: 404, parent: "README.md" },
        ]),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("./missing.md (from README.md) -- HTTP 404")
  })

  it("fails when the scan script reported ok: true with no links array", async () => {
    writeFileSync(path.join(cwd, "README.md"), "# hi")
    const result = await docsLinks.policy(makeContext(makeJsonResult({ ok: true, value: {} })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Docs (links): linkinator produced invalid JSON.",
    })
  })
})
