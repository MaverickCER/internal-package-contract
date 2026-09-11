import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deadCode } from "../checks/dead-code.js"
import { makeContext, makeJsonResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-dead-code-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("deadCode", () => {
  it("appends --config pointing at the bundled knip.json when the consumer has none", () => {
    const check = deadCode()
    const run = check.run as string[]
    expect(run[0]).toBe("knip")
    expect(run.slice(-2)[0]).toBe("--config")
    expect(run.slice(-1)[0]).toContain("knip.json")
  })

  it("does not append --config when the consumer has its own knip.json", () => {
    writeFileSync(path.join(cwd, "knip.json"), "{}")
    const check = deadCode()
    const run = check.run as string[]
    expect(run).not.toContain("--config")
  })

  it("passes exemptUnusedDevDependencies through to the underlying knip preset's --reporter-options", () => {
    const check = deadCode({ exemptUnusedDevDependencies: ["tsx"] })
    const run = check.run as string[]
    const optionsIndex = run.indexOf("--reporter-options")
    expect(JSON.parse(run[optionsIndex + 1] ?? "{}")).toEqual({
      exemptUnusedDevDependencies: ["tsx"],
    })
  })

  it("delegates policy evaluation to the underlying knip preset", async () => {
    const check = deadCode()
    const result = await check.policy(makeContext(makeJsonResult({ issues: [] })))
    expect(result.outcome).toBe("pass")
  })
})
