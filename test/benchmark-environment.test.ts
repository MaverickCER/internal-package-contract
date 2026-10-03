import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { collectEnvironment, collectGit } from "../scripts/benchmark/kit/environment.mjs"
import { orderOfMagnitudeUsd } from "../scripts/benchmark/kit/report.mjs"
import { generatedBy } from "../scripts/benchmark/kit/run.mjs"
import { parseAppendArgs } from "../scripts/benchmark/append-history.mjs"

describe("generatedBy()", () => {
  it("says which workflow and run produced a number in CI, so it can be traced", () => {
    expect(generatedBy({ CI: "true", GITHUB_WORKFLOW: "CI", GITHUB_RUN_ID: "123" })).toBe(
      "ci: CI (run 123)",
    )
    expect(generatedBy({ CI: "true" })).toBe("ci")
    expect(generatedBy({ CI: "true", GITHUB_WORKFLOW: "CI" })).toBe("ci")
    expect(generatedBy({})).toBe("npm run benchmark")
  })
})

describe("collectGit()", () => {
  let dir: string
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" })
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-bench-git-"))
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    writeFileSync(path.join(dir, "src.ts"), "export {}\n")
    git("add", "-A")
    git("commit", "-q", "-m", "init")
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("reports a clean tree even after a suite wrote its own outputs, because those are not code", () => {
    mkdirSync(path.join(dir, "benchmarks/history"), { recursive: true })
    writeFileSync(path.join(dir, "benchmarks/results.json"), "{}")
    writeFileSync(path.join(dir, "benchmarks/BENCHMARKS.md"), "# r")
    writeFileSync(path.join(dir, "benchmarks/history/runtime.json"), "{}")
    mkdirSync(path.join(dir, "reports"))
    writeFileSync(path.join(dir, "reports/x.json"), "{}")
    const state = collectGit(dir)
    expect(state.gitDirty).toBe(false)
    expect(state.gitBranch).toBe("main")
    expect(state.gitCommit).toMatch(/^[0-9a-f]{40}$/)
  })

  it("reports a dirty tree when the code under test has uncommitted changes", () => {
    writeFileSync(path.join(dir, "src.ts"), "export const x = 1\n")
    expect(collectGit(dir).gitDirty).toBe(true)
  })

  it("is null everywhere outside a repository, never a thrown error", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "ipc-bench-nogit-"))
    try {
      expect(collectGit(outside)).toEqual({ gitCommit: null, gitBranch: null, gitDirty: null })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe("collectEnvironment()", () => {
  it("records the Node version the numbers were measured on", () => {
    expect(collectEnvironment().nodeVersion).toBe(process.version)
  })
})

describe("orderOfMagnitudeUsd()", () => {
  it("rounds both ends of the bracket to a power of ten, and collapses an agreeing bracket", () => {
    expect(orderOfMagnitudeUsd(0.0004, 0.0006)).toBe("~$0.0001".slice(0, 0) + "~$0.001")
    expect(orderOfMagnitudeUsd(0.12, 0.3)).toBe("~$0.1")
    expect(orderOfMagnitudeUsd(0.3, 0.12)).toBe("~$0.1")
    expect(orderOfMagnitudeUsd(0.02, 0.4)).toBe("~$0.01 – $1")
    expect(orderOfMagnitudeUsd(0, 0)).toBe("~$0")
    expect(orderOfMagnitudeUsd(0, 5)).toBe("~$0 – $10")
  })
})

describe("parseAppendArgs()", () => {
  it("separates the two paths from the commit and pull request the entry belongs to", () => {
    expect(parseAppendArgs(["a.json", "h.json", "--commit", "abc", "--pr", "42"])).toEqual({
      positional: ["a.json", "h.json"],
      commit: "abc",
      pullRequest: 42,
    })
    expect(parseAppendArgs(["--pr", "7", "a.json", "h.json"])).toEqual({
      positional: ["a.json", "h.json"],
      pullRequest: 7,
    })
  })

  it("ignores a pull request number that is not a positive integer", () => {
    for (const bad of ["abc", "0", "-3", "1.5", ""]) {
      expect(parseAppendArgs(["a", "h", "--pr", bad]).pullRequest, bad).toBeUndefined()
    }
  })
})
