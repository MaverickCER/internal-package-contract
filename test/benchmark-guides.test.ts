import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { benchmarkGuides } from "../checks/benchmark-guides.js"
import { CANONICAL_DIR, GUIDES, compareGuides, syncGuides } from "../scripts/benchmark-guides.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-guides-"))
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

const canonical = (guide: string) => readFileSync(path.join(CANONICAL_DIR, guide), "utf8")
const put = (guide: string, text: string) => {
  mkdirSync(path.join(cwd, "benchmarks"), { recursive: true })
  writeFileSync(path.join(cwd, "benchmarks", guide), text)
}

describe("compareGuides() / syncGuides()", () => {
  it("is not applicable without a benchmarks directory, and writes nothing", () => {
    expect(compareGuides(cwd)).toEqual({ applicable: false, missing: [], differing: [] })
    expect(syncGuides(cwd)).toEqual([])
  })

  it("names the guides that are missing and the ones that differ", () => {
    put(GUIDES[0]!, canonical(GUIDES[0]!))
    put("other.md", "x")
    expect(compareGuides(cwd)).toEqual({ applicable: true, missing: [GUIDES[1]], differing: [] })
    put(GUIDES[0]!, "stale")
    expect(compareGuides(cwd).differing).toEqual([GUIDES[0]])
  })

  it("syncs both, and then reports nothing to do", () => {
    put(GUIDES[0]!, "stale")
    expect(syncGuides(cwd).sort()).toEqual([...GUIDES].sort())
    expect(compareGuides(cwd)).toEqual({ applicable: true, missing: [], differing: [] })
    expect(syncGuides(cwd)).toEqual([])
  })
})

describe("benchmarkGuides() policy", () => {
  const policy = (value: object) =>
    benchmarkGuides().policy(makeContext(makeJsonResult(value))) as {
      outcome: string
      rationale: string
    }

  it("passes when there is nothing to compare, or both copies are canonical", () => {
    expect(policy({ ok: true, applicable: false, missing: [], differing: [] }).outcome).toBe("pass")
    expect(policy({ ok: true, applicable: true, missing: [], differing: [] }).rationale).toContain(
      "identical",
    )
  })

  it("fails, naming each guide and the command that fixes it", () => {
    const result = policy({ ok: true, applicable: true, missing: ["A.md"], differing: ["B.md"] })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("- A.md is missing")
    expect(result.rationale).toContain("- B.md differs")
    expect(result.rationale).toContain("sync-benchmark-guides")
  })

  it("fails on abnormal termination and unparseable output", () => {
    expect(
      (
        benchmarkGuides().policy(makeContext(makeResult({ status: "timed_out" }))) as {
          outcome: string
        }
      ).outcome,
    ).toBe("fail")
  })
})
