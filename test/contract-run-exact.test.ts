import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { selectChecks } from "../scripts/contract-args.mjs"
import { cleanUp, isCi, isStrict, runContract } from "../scripts/contract-run.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const repo = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-contract-run-"))
  roots.push(root)
  return root
}
let exitCode: typeof process.exitCode
beforeEach(() => {
  exitCode = process.exitCode
})
afterEach(() => {
  process.exitCode = exitCode
})

describe("isCi()", () => {
  it("is true for a truthy CI value other than false or 0, or under GitHub Actions", () => {
    for (const env of [
      { CI: "true" },
      { CI: "1" },
      { CI: "yes" },
      { GITHUB_ACTIONS: "true" },
      { CI: "false", GITHUB_ACTIONS: "true" },
    ])
      expect(isCi(env), JSON.stringify(env)).toBe(true)
    for (const env of [
      {},
      { CI: "" },
      { CI: "false" },
      { CI: "0" },
      { GITHUB_ACTIONS: "false" },
      { GITHUB_ACTIONS: "" },
      { GITHUB_ACTIONS: "1" },
    ])
      expect(isCi(env), JSON.stringify(env)).toBe(false)
  })
})

describe("isStrict()", () => {
  it("is on for --strict or CI, and --no-strict always wins", () => {
    expect(isStrict(["--strict"], {})).toBe(true)
    expect(isStrict([], { CI: "true" })).toBe(true)
    expect(isStrict([], {})).toBe(false)
    expect(isStrict(["--no-strict"], { CI: "true" })).toBe(false)
    expect(isStrict(["--no-strict", "--strict"], {})).toBe(false)
    expect(isStrict(["--strict", "--no-strict"], {})).toBe(false)
  })
})

describe("cleanUp()", () => {
  const populate = (root: string) => {
    for (const rel of [
      ".stryker-tmp/x",
      "coverage/lcov.info",
      "reports/vitest/a.json",
      "reports/contract/report.json",
      "reports/other.json",
    ]) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), "x")
    }
  }
  const has = (root: string, rel: string) => existsSync(path.join(root, rel))

  it("always removes the Stryker sandbox, and removes coverage and tool reports only if the run created them", () => {
    const root = repo()
    populate(root)
    cleanUp(root, { coverage: true, reports: true })
    expect(has(root, ".stryker-tmp")).toBe(false)
    expect(has(root, "coverage")).toBe(false)
    expect(has(root, "reports/vitest")).toBe(false)
    expect(has(root, "reports/other.json")).toBe(false)
    expect(has(root, "reports/contract/report.json")).toBe(true)
  })

  it("leaves what was there before the run", () => {
    const root = repo()
    populate(root)
    cleanUp(root, { coverage: false, reports: false })
    expect(has(root, ".stryker-tmp")).toBe(false)
    expect(has(root, "coverage/lcov.info")).toBe(true)
    expect(has(root, "reports/vitest/a.json")).toBe(true)
    expect(has(root, "reports/other.json")).toBe(true)
  })

  it("treats the two independently, and copes with nothing to remove", () => {
    const root = repo()
    populate(root)
    cleanUp(root, { coverage: true, reports: false })
    expect(has(root, "coverage")).toBe(false)
    expect(has(root, "reports/vitest/a.json")).toBe(true)
    const second = repo()
    populate(second)
    cleanUp(second, { coverage: false, reports: true })
    expect(has(second, "coverage/lcov.info")).toBe(true)
    expect(has(second, "reports/vitest")).toBe(false)
    expect(() => cleanUp(repo(), { coverage: true, reports: true })).not.toThrow()
  })
})

describe("runContract()", () => {
  const evidence = (checks: Record<string, unknown>) => ({
    version: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:10.000Z",
    durationMs: 10_000,
    checks,
  })
  type Phase = { passed: boolean; checks: Record<string, { outcome: string; rationale: string }> }
  const fake = (phases: Phase[], calls: unknown[] = []) => {
    let index = 0
    const run = (_config: unknown, options?: { checks: readonly string[] }) => {
      calls.push(options)
      const phase = phases[index++]
      if (!phase) throw new Error("unexpected phase")
      return Promise.resolve({
        evidence: evidence(
          Object.fromEntries(Object.keys(phase.checks).map((id) => [id, { durationMs: 1000 }])),
        ),
        verdict: phase,
      })
    }
    return run
  }
  const capture = () => {
    const chunks: string[] = []
    return {
      chunks,
      out: { write: (text: string) => chunks.push(text) } as unknown as NodeJS.WritableStream,
      text: () => chunks.join(""),
    }
  }
  const pass = (rationale = "fine") => ({ outcome: "pass", rationale })
  const config = (...ids: string[]) => ({ checks: Object.fromEntries(ids.map((id) => [id, {}])) })

  it("runs every check in one go when none is deferred, writing the verdict, the report and the exit code", async () => {
    const root = repo()
    const calls: unknown[] = []
    const output = capture()
    const result = await runContract({
      runRepoContract: fake(
        [
          {
            passed: true,
            checks: {
              Lint: pass("lint ok"),
              Docs: { outcome: "warn", rationale: "docs warning\nsecond line" },
            },
          },
        ],
        calls,
      ),
      config: config("Lint", "Docs"),
      cwd: root,
      title: "My contract",
      argv: [],
      env: {},
      out: output.out,
    })
    expect(result).toEqual({ passed: true })
    expect(process.exitCode).toBe(0)
    expect(calls).toEqual([undefined])
    expect(output.text()).toBe(
      [
        "",
        "My contract",
        "",
        "[PASS] Lint: lint ok",
        "[WARN] Docs: docs warning\nsecond line",
        "",
        "1 pass, 1 warn, 0 not evaluated (accepted), 0 not evaluated (no exception recorded), 0 fail, 0 skipped.",
        `Report: ${path.join("reports", "contract", "report.json")}`,
        "",
        "PASS",
        "",
      ].join("\n"),
    )
    for (const file of ["evidence.json", "report.json", "summary.md"])
      expect(existsSync(path.join(root, "reports/contract", file)), file).toBe(true)
    const report = JSON.parse(
      readFileSync(path.join(root, "reports/contract/report.json"), "utf8"),
    ) as { passed: boolean; exceptions: { total: number }; checks: unknown[] }
    expect(report.passed).toBe(true)
    expect(report.exceptions.total).toBe(0)
    expect(report.checks).toHaveLength(2)
    expect(readFileSync(path.join(root, "reports/contract/summary.md"), "utf8")).toContain(
      "## My contract: passed",
    )
    const written = JSON.parse(
      readFileSync(path.join(root, "reports/contract/evidence.json"), "utf8"),
    ) as Record<string, unknown>
    expect(written).toMatchObject({
      version: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:10.000Z",
      durationMs: 10_000,
    })
    expect(Object.keys(written["checks"] as object).sort()).toEqual(["Docs", "Lint"])
  })

  it("names the selected checks in the heading, and runs only them", async () => {
    const calls: unknown[] = []
    const output = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }], calls),
      config: config("Lint", "Docs", "Tests"),
      cwd: repo(),
      title: "T",
      argv: ["--checks", "Lint,Docs"],
      env: {},
      out: output.out,
    })
    expect(calls).toEqual([{ checks: ["Lint", "Docs"] }])
    expect(output.text().split("\n")[1]).toBe("T (Lint, Docs)")
    expect(selectChecks(["--checks", "Lint,Docs"], ["Lint", "Docs", "Tests"])).toEqual([
      "Lint",
      "Docs",
    ])
  })

  it("runs the Socket scan second, only when the first phase passed", async () => {
    const calls: unknown[] = []
    const output = capture()
    const result = await runContract({
      runRepoContract: fake(
        [
          { passed: true, checks: { Lint: pass() } },
          { passed: true, checks: { SecuritySocket: pass("scanned") } },
        ],
        calls,
      ),
      config: config("Lint", "SecuritySocket"),
      cwd: repo(),
      title: "T",
      argv: [],
      env: {},
      out: output.out,
    })
    expect(calls).toEqual([{ checks: ["Lint"] }, { checks: ["SecuritySocket"] }])
    expect(result.passed).toBe(true)
    expect(output.text()).toContain("[PASS] SecuritySocket: scanned")
    expect(output.text()).toContain("2 pass, 0 warn")
  })

  it("does not run the Socket scan after a failure, and reports it as skipped", async () => {
    const calls: unknown[] = []
    const output = capture()
    const result = await runContract({
      runRepoContract: fake(
        [{ passed: false, checks: { Lint: { outcome: "fail", rationale: "broken" } } }],
        calls,
      ),
      config: config("Lint", "SecuritySocket"),
      cwd: repo(),
      title: "T",
      argv: [],
      env: {},
      out: output.out,
    })
    expect(calls).toHaveLength(1)
    expect(result.passed).toBe(false)
    expect(process.exitCode).toBe(1)
    expect(output.text()).toContain("[FAIL] Lint: broken")
    expect(output.text()).toContain(
      "[SKIPPED] SecuritySocket: Not run: it spends scarce quota, so it runs only after every other check passed.",
    )
    expect(output.text()).toContain(
      "0 pass, 0 warn, 0 not evaluated (accepted), 0 not evaluated (no exception recorded), 1 fail, 1 skipped.",
    )
    expect(output.text().endsWith("\nFAIL\n")).toBe(true)
  })

  it("does not list a skipped Socket scan when it is not part of the run", async () => {
    const output = capture()
    await runContract({
      runRepoContract: fake([
        { passed: false, checks: { Lint: { outcome: "fail", rationale: "broken" } } },
      ]),
      config: config("Lint", "SecuritySocket"),
      cwd: repo(),
      title: "T",
      argv: ["--checks", "Lint"],
      env: {},
      out: output.out,
    })
    expect(output.text()).not.toContain("SKIPPED")
  })

  it("tells a non-strict run that an unexcepted result will fail the gate, and a strict one it already did", async () => {
    const unexcepted = {
      outcome: "warn",
      rationale: "Not evaluated (no exception recorded; add x): y",
    }
    const note =
      "Results with no recorded exception fail the CI gate (--strict); record each in .repo-contract/exceptions/environment.json."
    const loose = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Chrome: unexcepted } }]),
      config: config("Chrome"),
      cwd: repo(),
      title: "T",
      argv: [],
      env: {},
      out: loose.out,
    })
    expect(loose.text()).toContain(note)
    expect(loose.text()).toContain("[NOT-EVALUATED] Chrome:")
    expect(process.exitCode).toBe(0)
    const strict = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Chrome: unexcepted } }]),
      config: config("Chrome"),
      cwd: repo(),
      title: "T",
      argv: ["--strict"],
      env: {},
      out: strict.out,
    })
    expect(strict.text()).not.toContain(note)
    expect(process.exitCode).toBe(1)
    const none = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }]),
      config: config("Lint"),
      cwd: repo(),
      title: "T",
      argv: [],
      env: {},
      out: none.out,
    })
    expect(none.text()).not.toContain(note)
    const nonStrictNone = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }]),
      config: config("Lint"),
      cwd: repo(),
      title: "T",
      argv: ["--no-strict"],
      env: { CI: "true" },
      out: nonStrictNone.out,
    })
    expect(nonStrictNone.text()).not.toContain(note)
  })

  it("prints the exceptions in force when there are any", async () => {
    const root = repo()
    mkdirSync(path.join(root, ".repo-contract/exceptions"), { recursive: true })
    writeFileSync(
      path.join(root, ".repo-contract/exceptions/socket.json"),
      JSON.stringify({
        exceptions: [{ version: 1, justification: "j", exceptionType: "accepted-risk" }],
      }),
    )
    const output = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }]),
      config: config("Lint"),
      cwd: root,
      title: "T",
      argv: [],
      env: {},
      out: output.out,
    })
    expect(output.text()).toContain(
      "\n1 exception(s) across 1 registry (1 legacy version 1, 0 expired, 0 incomplete).\n",
    )
    expect(output.text()).toContain("- socket: 1 (accepted-risk 1); 1 legacy\n")
    const bare = capture()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }]),
      config: config("Lint"),
      cwd: repo(),
      title: "T",
      argv: [],
      env: {},
      out: bare.out,
    })
    expect(bare.text()).not.toContain("exception(s)")
  })

  it("appends the summary to the GitHub step summary when there is one", async () => {
    const root = repo()
    const summary = path.join(root, "step-summary.md")
    writeFileSync(summary, "earlier\n")
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }]),
      config: config("Lint"),
      cwd: root,
      title: "Gate",
      argv: [],
      env: { GITHUB_STEP_SUMMARY: summary },
      out: capture().out,
    })
    const written = readFileSync(summary, "utf8")
    expect(written.startsWith("earlier\n## Gate: passed")).toBe(true)
    expect(written.endsWith("\n")).toBe(true)
    const absent = repo()
    await runContract({
      runRepoContract: fake([{ passed: true, checks: { Lint: pass() } }]),
      config: config("Lint"),
      cwd: absent,
      title: "Gate",
      argv: [],
      env: { GITHUB_STEP_SUMMARY: "" },
      out: capture().out,
    })
    expect(existsSync(path.join(absent, "reports/contract/summary.md"))).toBe(true)
  })

  it("cleans up what it created, even when a phase throws, and keeps the contract's own report", async () => {
    const root = repo()
    mkdirSync(path.join(root, "coverage"), { recursive: true })
    mkdirSync(path.join(root, ".stryker-tmp"), { recursive: true })
    const throwing = () => Promise.reject(new Error("boom"))
    await expect(
      runContract({
        runRepoContract: throwing as never,
        config: config("Lint"),
        cwd: root,
        title: "T",
        argv: [],
        env: {},
        out: capture().out,
      }),
    ).rejects.toThrow("boom")
    expect(existsSync(path.join(root, ".stryker-tmp"))).toBe(false)
    expect(existsSync(path.join(root, "coverage"))).toBe(true)

    const fresh = repo()
    await runContract({
      runRepoContract: (async () => {
        mkdirSync(path.join(fresh, "coverage"), { recursive: true })
        mkdirSync(path.join(fresh, "reports/vitest"), { recursive: true })
        return { evidence: evidence({}), verdict: { passed: true, checks: {} } }
      }) as never,
      config: config("Lint"),
      cwd: fresh,
      title: "T",
      argv: [],
      env: {},
      out: capture().out,
    })
    expect(existsSync(path.join(fresh, "coverage"))).toBe(false)
    expect(existsSync(path.join(fresh, "reports/vitest"))).toBe(false)
    expect(existsSync(path.join(fresh, "reports/contract/report.json"))).toBe(true)
  })
})

describe("selectChecks() unknown ids", () => {
  it("names the unknown check and every declared one", () => {
    expect(() => selectChecks(["--checks", "Nope"], ["A", "B"])).toThrow(
      'Unknown check "Nope". Declared checks: A, B.',
    )
    expect(() => selectChecks(["--skip", "Nope"], ["A", "B"])).toThrow(
      'Unknown check "Nope". Declared checks: A, B.',
    )
  })
})
