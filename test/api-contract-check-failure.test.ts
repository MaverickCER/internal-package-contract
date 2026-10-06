import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

vi.mock("../scripts/api-contract/extractor-adapter.js", () => ({
  runApiExtractorForTarget: () => ({
    succeeded: false,
    errorCount: 3,
    warningCount: 0,
    apiJsonFilePath: "unused",
    dtsRollupFilePath: "unused",
    apiReportFilePath: "unused",
  }),
}))

const { runApiContractCheck } = await import("../scripts/api-contract/check.js")

const root = mkdtempSync(path.join(tmpdir(), "ipc-check-failure-"))
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", version: "1.0.0" }))
writeFileSync(path.join(root, "typedoc.json"), JSON.stringify({ entryPoints: ["src/index.ts"] }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("runApiContractCheck() when API Extractor fails", () => {
  it("names the target and the error count instead of comparing anything", async () => {
    await expect(runApiContractCheck(root, "public")).rejects.toThrow(
      'API Extractor reported 3 error(s) for target "index" -- see stderr above for details.',
    )
  })
})
