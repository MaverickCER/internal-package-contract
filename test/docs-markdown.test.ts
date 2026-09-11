import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { docsMarkdown } from "../checks/docs-markdown.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-docs-md-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("docsMarkdown", () => {
  it("uses the bundled config and reports it in the pass rationale when the consumer has none", async () => {
    const check = docsMarkdown()
    const result = await check.policy(makeContext(makeResult({ exitCode: 0 })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Docs (markdown): 0 issues (bundled baseline rules).",
    })
  })

  it("wires run with an explicit --config and safe globs when falling back to the bundled config", () => {
    const check = docsMarkdown()
    expect(check.run).toEqual([
      "markdownlint-cli2",
      "--config",
      (check.run as string[])[2],
      "*.md",
      "docs/**/*.md",
    ])
    expect((check.run as string[])[2]).toContain("markdownlint.jsonc")
  })

  it("omits the bundled-baseline note when the consumer has its own config", async () => {
    writeFileSync(path.join(cwd, ".markdownlint.json"), "{}")
    const check = docsMarkdown()
    const result = await check.policy(makeContext(makeResult({ exitCode: 0 })))
    expect(result).toEqual({ outcome: "pass", rationale: "Docs (markdown): 0 issues." })
  })

  it("wires run with no --config flag and the same safe globs when the consumer has their own config", () => {
    writeFileSync(path.join(cwd, ".markdownlint.json"), "{}")
    const check = docsMarkdown()
    expect(check.run).toEqual(["markdownlint-cli2", "*.md", "docs/**/*.md"])
  })

  it("fails, naming the tool, when markdownlint-cli2 terminated abnormally", async () => {
    const check = docsMarkdown()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("markdownlint-cli2")
  })

  it("passes when a glob matched no files", async () => {
    const check = docsMarkdown()
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 2, stderr: "Linting: 0 file(s)" })),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Docs (markdown): no markdown files to lint.",
    })
  })

  it("fails, printing the tail of output, on a real lint issue", async () => {
    const check = docsMarkdown()
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 1, stderr: "README.md:3 MD013/line-length" })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Docs (markdown): markdownlint-cli2 reported issue(s) (bundled baseline rules):\nREADME.md:3 MD013/line-length",
    })
  })

  it("truncates a long lint-issue tail to exactly the last 4000 characters", async () => {
    const check = docsMarkdown()
    const longOutput = "a".repeat(4500) + "END"
    const result = await check.policy(makeContext(makeResult({ exitCode: 1, stderr: longOutput })))
    const tail = result.rationale.split("\n").at(-1) ?? ""
    expect(tail.length).toBe(4000)
    expect(tail.endsWith("END")).toBe(true)
  })
})
