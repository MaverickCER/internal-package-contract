import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/api-contract/extractor-adapter.js", () => ({
  getApiExtractorVersion: () => "0.0.0",
  runApiExtractorForTarget: () => ({
    succeeded: false,
    errorCount: 3,
    warningCount: 0,
    apiJsonFilePath: "unused",
    dtsRollupFilePath: "unused",
    apiReportFilePath: "unused",
  }),
}))

const { main, runUpdateBaseline } = await import("../scripts/api-contract/update-baseline.js")

const root = mkdtempSync(path.join(tmpdir(), "ipc-update-failure-"))
execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" })
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", version: "1.0.0" }))
writeFileSync(path.join(root, "typedoc.json"), JSON.stringify({ entryPoints: ["src/index.ts"] }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("runUpdateBaseline() when API Extractor fails", () => {
  it("reports the target as failed, with the error count", async () => {
    expect(await runUpdateBaseline(root)).toEqual([
      {
        target: "index",
        status: "failed",
        message: "API Extractor reported 3 error(s) -- see stderr above for details.",
      },
    ])
  })

  it("sends the failure to stderr and exits 1", async () => {
    const out: string[] = []
    const err: string[] = []
    const code = await main(root, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) })
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([
      "[index] API Extractor reported 3 error(s) -- see stderr above for details.\n",
    ])
  })
})
