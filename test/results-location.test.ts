import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { scanComplexity } from "../scripts/benchmark/complexity-scan.mjs"
import {
  currentResults,
  defaultOutput,
  isCi,
  LOCAL_DIRECTORY,
  suiteDirectories,
} from "../scripts/benchmark/results-location.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-results-location-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (file: string, value: unknown) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), JSON.stringify(value))
}

describe("isCi", () => {
  it("is true for the values CI services set, and nothing else", () => {
    expect(isCi({ CI: "true" })).toBe(true)
    expect(isCi({ CI: "1" })).toBe(true)
    expect(isCi({ CI: "false" })).toBe(false)
    expect(isCi({ CI: "" })).toBe(false)
    expect(isCi({})).toBe(false)
  })
})

describe("defaultOutput", () => {
  const suite = path.join("repo", "benchmarks", "performance-runtime")
  it("writes into the suite's own folder in CI, whose figures are the committed ones", () => {
    expect(defaultOutput(suite, { CI: "true" })).toBe(suite)
  })
  it("writes under the never-committed local folder anywhere else, one folder per suite", () => {
    expect(path.normalize(defaultOutput(suite, {}))).toBe(
      path.join("repo", LOCAL_DIRECTORY, "performance-runtime"),
    )
  })
})

describe("currentResults", () => {
  it("is nothing without results, the committed ones alone, and this machine's run in preference", () => {
    expect(currentResults(dir, "a")).toBeUndefined()
    put("benchmarks/a/results.json", {})
    expect(currentResults(dir, "a")).toBe(path.join(dir, "benchmarks", "a", "results.json"))
    put(`${LOCAL_DIRECTORY}/a/results.json`, {})
    expect(currentResults(dir, "a")).toBe(path.join(dir, LOCAL_DIRECTORY, "a", "results.json"))
  })
})

describe("suiteDirectories", () => {
  it("lists suites that have results, local or committed, sorted, and nothing else", () => {
    expect(suiteDirectories(dir)).toEqual([])
    put("benchmarks/b/results.json", {})
    put("benchmarks/a/results.json", {})
    put("benchmarks/empty/other.json", {})
    put(`${LOCAL_DIRECTORY}/c/results.json`, {})
    writeFileSync(path.join(dir, "benchmarks", "README.md"), "x")
    expect(suiteDirectories(dir)).toEqual(["a", "b"])
    put("benchmarks/c/BENCHMARKS.md", "x")
    expect(suiteDirectories(dir)).toEqual(["a", "b", "c"])
  })
})

describe("the checks read this machine's run", () => {
  const withGroup = (cls: string | null) => ({
    analysis: {
      complexity: { "fn:x": { class: cls, reason: "insufficient-data", notation: null } },
    },
  })
  it("reports what a local run could not determine, not what the committed results say", () => {
    put("benchmarks/s/results.json", withGroup("linear"))
    expect(scanComplexity(dir).suites).toEqual(["s"])
    put(`${LOCAL_DIRECTORY}/s/results.json`, withGroup(null))
    expect(scanComplexity(dir).undetermined.map((u) => u.group)).toEqual(["fn:x"])
  })
})
