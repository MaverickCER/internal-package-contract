import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { readApi } from "../scripts/benchmark/coverage/scan.mjs"

// The first target's extraction throws. The real `removeCurrentApi` stays, so the check's own cleanup is what runs.
vi.mock("../scripts/api-contract/extractor-adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scripts/api-contract/extractor-adapter.js")>()),
  runApiExtractorForTarget: () => {
    throw new Error("extraction failed")
  },
}))

const { runApiContractCheck } = await import("../scripts/api-contract/check.js")

const root = mkdtempSync(path.join(tmpdir(), "ipc-check-stale-current-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("runApiContractCheck() when an earlier target's extraction throws", () => {
  it("has already removed every target's current.* first, so a later target is read from its baseline", async () => {
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", version: "1.0.0" }))
    writeFileSync(
      path.join(root, "typedoc.json"),
      JSON.stringify({ entryPoints: ["src/index.ts", "src/adapters/express/index.ts"] }),
    )
    const baseline = { kind: "Package", members: [{ kind: "EntryPoint", members: [] }] }
    const folders = ["index", "adapters/express"].map((name) =>
      path.join(root, ".repo-contract", "api-contract", name),
    )
    for (const folder of folders) {
      mkdirSync(folder, { recursive: true })
      writeFileSync(path.join(folder, "baseline.api.json"), JSON.stringify(baseline))
      for (const file of ["current.api.json", "current.d.ts"])
        writeFileSync(path.join(folder, file), "stale")
    }
    await expect(runApiContractCheck(root, "public")).rejects.toThrow("extraction failed")
    for (const folder of folders)
      for (const file of ["current.api.json", "current.d.ts"])
        expect(existsSync(path.join(folder, file)), `${folder}/${file}`).toBe(false)
    expect(readApi(root).targets).toEqual([{ model: baseline }, { model: baseline }])
  })
})
