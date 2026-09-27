import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runCoderabbitReview } from "../../../scripts/coderabbitai/review.js"

/**
 * Runs `runCoderabbitReview()` for real -- no mocking of `cross-spawn` or the `coderabbit`/`git`
 * binaries. A real, uncontrolled `coderabbit review --agent` invocation would start an actual,
 * billable AI review against whatever this environment's real CodeRabbit credentials allow -- never
 * appropriate to trigger from a test suite. These tests instead exercise the one real, fast, free,
 * fully deterministic path every environment (CI included) actually takes on every run: the
 * `env.CI` short-circuit, asserted by setting it explicitly rather than depending on whatever the
 * ambient test-runner environment happens to already have. Registry loading is real file I/O
 * against a throwaway temp directory.
 */
describe("runCoderabbitReview -- real short-circuit path", () => {
  const originalCi = process.env["CI"]
  let root: string

  beforeEach(() => {
    process.env["CI"] = "1"
    root = mkdtempSync(path.join(tmpdir(), "ipc-coderabbitai-test-"))
  })

  afterEach(() => {
    if (originalCi === undefined) delete process.env["CI"]
    else process.env["CI"] = originalCi
    rmSync(root, { recursive: true, force: true })
  })

  function writeRegistry(exceptions: readonly unknown[]): void {
    const registryPath = path.join(root, ".repo-contract/exceptions/coderabbit.json")
    mkdirSync(path.dirname(registryPath), { recursive: true })
    writeFileSync(registryPath, JSON.stringify({ exceptions }), "utf8")
  }

  it("returns 'not-applicable: ci' without spawning any review process when CI is set", async () => {
    const evidence = await runCoderabbitReview(root)
    expect(evidence).toMatchObject({
      status: "not-applicable",
      reason: "ci",
      expectedProvider: "coderabbit-github-app",
      registryPath: ".repo-contract/exceptions/coderabbit.json",
      existingRecordCount: 0,
    })
  })

  it("counts, but never reconciles or rewrites, an existing registry on a CI short-circuit", async () => {
    const registryPath = path.join(root, ".repo-contract/exceptions/coderabbit.json")
    const record = {
      id: "coderabbit:src/a.ts:minor:043a718774c5",
      version: 1,
      justification: "Reviewed and deliberately not acted on.",
      alternatives: "",
      remediation: "Tracked.",
      method: "independent-human-review",
      exceptionType: "accepted-risk",
      file: "src/a.ts",
      severity: "minor",
      summary: "s",
    }
    writeRegistry([record])
    const before = readFileSync(registryPath, "utf8")

    const evidence = await runCoderabbitReview(root)
    expect(evidence.status).toBe("not-applicable")
    // The id above is the real `deriveCoderabbitExceptionId` output for this
    // file/severity/summary; a count of 1 proves the record validated rather than being skipped.
    expect(evidence).toMatchObject({ existingRecordCount: 1 })
    expect(evidence.registryError).toBeUndefined()
    expect(readFileSync(registryPath, "utf8")).toBe(before)
  })

  it("reports a malformed registry as registryError, leaving the file untouched", async () => {
    const registryPath = path.join(root, ".repo-contract/exceptions/coderabbit.json")
    writeRegistry([{ id: "coderabbit:src/a.ts:minor:deadbeefcafe", version: 2 }])
    const before = readFileSync(registryPath, "utf8")

    const evidence = await runCoderabbitReview(root)
    expect(evidence.status).toBe("not-applicable")
    expect(evidence.registryError?.join("\n")).toContain("version must be the number 1")
    expect(evidence).toMatchObject({ existingRecordCount: 0 })
    expect(readFileSync(registryPath, "utf8")).toBe(before)
  })
})
