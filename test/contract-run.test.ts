import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { REPORT_DIR, cleanUp, isCi, isStrict, runContract } from "../scripts/contract-run.mjs"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-run-"))
  process.exitCode = undefined
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  process.exitCode = undefined
})

describe("isCi() / isStrict()", () => {
  it("recognises CI from CI or GITHUB_ACTIONS, ignoring false-looking values", () => {
    expect(isCi({ CI: "true" })).toBe(true)
    expect(isCi({ GITHUB_ACTIONS: "true" })).toBe(true)
    for (const value of ["false", "0", ""]) expect(isCi({ CI: value })).toBe(false)
    expect(isCi({})).toBe(false)
  })

  it("is strict under --strict or in CI, unless --no-strict", () => {
    expect(isStrict([], {})).toBe(false)
    expect(isStrict(["--strict"], {})).toBe(true)
    expect(isStrict([], { CI: "true" })).toBe(true)
    expect(isStrict(["--no-strict"], { CI: "true" })).toBe(false)
    expect(isStrict(["--strict", "--no-strict"], {})).toBe(false)
  })
})

describe("cleanUp()", () => {
  const make = (...dirs: string[]) => {
    for (const dir of dirs) {
      mkdirSync(path.join(cwd, dir), { recursive: true })
      writeFileSync(path.join(cwd, dir, "x.json"), "{}")
    }
  }

  it("always removes the Stryker sandbox", () => {
    make(".stryker-tmp")
    cleanUp(cwd, { coverage: false, reports: false })
    expect(existsSync(path.join(cwd, ".stryker-tmp"))).toBe(false)
  })

  it("removes coverage and tool reports only when the run created them, keeping reports/contract", () => {
    make("coverage", "reports/vitest", "reports/contract")
    cleanUp(cwd, { coverage: true, reports: true })
    expect(existsSync(path.join(cwd, "coverage"))).toBe(false)
    expect(existsSync(path.join(cwd, "reports", "vitest"))).toBe(false)
    expect(existsSync(path.join(cwd, "reports", "contract", "x.json"))).toBe(true)
  })

  it("leaves a pre-existing coverage/ and reports/ alone", () => {
    make("coverage", "reports/vitest")
    cleanUp(cwd, { coverage: false, reports: false })
    expect(existsSync(path.join(cwd, "coverage"))).toBe(true)
    expect(existsSync(path.join(cwd, "reports", "vitest"))).toBe(true)
  })

  it("tolerates a run that never created reports/", () => {
    expect(() => cleanUp(cwd, { coverage: true, reports: true })).not.toThrow()
  })
})

const evidence = (ids: string[]) => ({
  version: 1,
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1000,
  checks: Object.fromEntries(ids.map((id) => [id, { durationMs: 100 }])),
})

function fakeRun(outcomes: Record<string, "pass" | "warn" | "fail">, rationale = "r") {
  return vi.fn((_config: unknown, options?: { checks: readonly string[] }) => {
    const ids = options?.checks ?? Object.keys(outcomes)
    const checks = Object.fromEntries(ids.map((id) => [id, { outcome: outcomes[id], rationale }]))
    return Promise.resolve({
      evidence: evidence([...ids]),
      verdict: { passed: !ids.some((id) => outcomes[id] === "fail"), checks },
    })
  })
}

function capture() {
  let text = ""
  return { out: { write: (chunk: string) => (text += chunk) }, text: () => text }
}

describe("runContract()", () => {
  const config = { checks: { Lint: {}, Tests: {}, SecuritySocket: {} } }

  it("runs everything, defers SecuritySocket until the rest passed, and writes the report", async () => {
    const run = fakeRun({ Lint: "pass", Tests: "pass", SecuritySocket: "pass" })
    const cap = capture()
    const result = await runContract({
      runRepoContract: run as never,
      config,
      cwd,
      title: "T",
      argv: [],
      env: {},
      out: cap.out,
    })
    expect(result.passed).toBe(true)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]?.[1]).toEqual({ checks: ["Lint", "Tests"] })
    expect(run.mock.calls[1]?.[1]).toEqual({ checks: ["SecuritySocket"] })
    expect(process.exitCode).toBe(0)
    const report = JSON.parse(readFileSync(path.join(cwd, REPORT_DIR, "report.json"), "utf8"))
    expect(report.passed).toBe(true)
    expect(report.checks.map((c: { id: string }) => c.id)).toEqual([
      "Lint",
      "Tests",
      "SecuritySocket",
    ])
    const merged = JSON.parse(readFileSync(path.join(cwd, REPORT_DIR, "evidence.json"), "utf8"))
    expect(Object.keys(merged.checks)).toEqual(["Lint", "Tests", "SecuritySocket"])
    expect(cap.text()).toContain("\nT\n")
    expect(cap.text()).toContain("[PASS] Lint: r")
    expect(cap.text()).toContain("3 pass, 0 warn")
    expect(cap.text()).toContain("PASS\n")
  })

  it("skips the Socket scan, and says so, when an earlier check failed", async () => {
    const run = fakeRun({ Lint: "fail", Tests: "pass", SecuritySocket: "pass" })
    const cap = capture()
    await runContract({
      runRepoContract: run as never,
      config,
      cwd,
      title: "T",
      argv: [],
      env: {},
      out: cap.out,
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
    const report = JSON.parse(readFileSync(path.join(cwd, REPORT_DIR, "report.json"), "utf8"))
    expect(report.counts.skipped).toBe(1)
    expect(cap.text()).toContain("[SKIPPED] SecuritySocket")
    expect(cap.text()).toContain("FAIL\n")
  })

  it("honours --checks and --skip, and runs a lone selection in one phase", async () => {
    const run = fakeRun({ Lint: "pass", Tests: "pass", SecuritySocket: "pass" })
    const cap = capture()
    await runContract({
      runRepoContract: run as never,
      config,
      cwd,
      title: "T",
      argv: ["--skip", "Tests,SecuritySocket"],
      env: {},
      out: cap.out,
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[1]).toEqual({ checks: ["Lint"] })
    expect(cap.text()).toContain("T (Lint)")
  })

  it("passes no options when the whole contract runs and nothing is deferred", async () => {
    const run = fakeRun({ Lint: "pass" })
    await runContract({
      runRepoContract: run as never,
      config: { checks: { Lint: {} } },
      cwd,
      title: "T",
      argv: [],
      env: {},
      out: capture().out,
    })
    expect(run.mock.calls[0]?.[1]).toBeUndefined()
  })

  it("fails a strict run on an unexcepted degradation, and explains it on a non-strict one", async () => {
    const rationale = "Not evaluated (no exception recorded; add x): y"
    const strictCap = capture()
    await runContract({
      runRepoContract: fakeRun({ Lint: "warn" }, rationale) as never,
      config: { checks: { Lint: {} } },
      cwd,
      title: "T",
      argv: ["--strict"],
      env: {},
      out: strictCap.out,
    })
    expect(process.exitCode).toBe(1)
    expect(strictCap.text()).toContain("[NOT-EVALUATED] Lint")

    process.exitCode = undefined
    const laxCap = capture()
    await runContract({
      runRepoContract: fakeRun({ Lint: "warn" }, rationale) as never,
      config: { checks: { Lint: {} } },
      cwd,
      title: "T",
      argv: [],
      env: {},
      out: laxCap.out,
    })
    expect(process.exitCode).toBe(0)
    expect(laxCap.text()).toContain("fail the CI gate (--strict)")
  })

  it("appends the Markdown summary to $GITHUB_STEP_SUMMARY, and cleans up even when the run throws", async () => {
    const summary = path.join(cwd, "step-summary.md")
    await runContract({
      runRepoContract: fakeRun({ Lint: "pass" }) as never,
      config: { checks: { Lint: {} } },
      cwd,
      title: "Contract",
      argv: [],
      env: { GITHUB_STEP_SUMMARY: summary },
      out: capture().out,
    })
    expect(readFileSync(summary, "utf8")).toContain("## Contract: passed")

    mkdirSync(path.join(cwd, ".stryker-tmp"))
    await expect(
      runContract({
        runRepoContract: (() => Promise.reject(new Error("boom"))) as never,
        config: { checks: { Lint: {} } },
        cwd,
        title: "T",
        argv: [],
        env: {},
        out: capture().out,
      }),
    ).rejects.toThrow("boom")
    expect(existsSync(path.join(cwd, ".stryker-tmp"))).toBe(false)
  })
})
