import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { adoptionModeCheck } from "../checks/adoption-mode.js"
import {
  ADOPTION_FILE,
  DEFAULT_DAYS,
  advisoryFailures,
  newAdoption,
  promote,
  readAdoption,
  writeAdoption,
} from "../scripts/adoption/mode.mjs"
import { runContract } from "../scripts/contract-run.mjs"
import { diagnose } from "../scripts/doctor/run.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-adoption-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (text: string): void => {
  mkdirSync(path.dirname(path.join(dir, ADOPTION_FILE)), { recursive: true })
  writeFileSync(path.join(dir, ADOPTION_FILE), text)
}
const NOW = new Date("2026-10-12T12:00:00Z")
const valid = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    startedAt: "2026-10-01",
    expiresAt: "2026-12-31",
    enforce: ["Lint"],
    ...over,
  })
const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

describe("readAdoption", () => {
  it("is absent when there is no file", () => {
    expect(readAdoption(dir, NOW)).toEqual({ state: "absent" })
  })
  it("is active before the end date, with the days left and what is enforced", () => {
    write(valid())
    expect(readAdoption(dir, NOW)).toEqual({
      state: "active",
      startedAt: "2026-10-01",
      expiresAt: "2026-12-31",
      enforce: ["Lint"],
      daysLeft: 81,
    })
  })
  it("is still active during the whole of the end date, and expired the day after", () => {
    write(valid({ expiresAt: "2026-10-12" }))
    expect(readAdoption(dir, NOW).state).toBe("active")
    expect(readAdoption(dir, new Date("2026-10-12T23:59:59Z")).state).toBe("active")
    expect(readAdoption(dir, new Date("2026-10-12T23:59:59.999Z")).state).toBe("active")
    expect(readAdoption(dir, new Date("2026-10-13T00:00:01Z")).state).toBe("expired")
  })
  it("is invalid when the file is not JSON or is the wrong shape, saying which", () => {
    write("{ nope")
    expect(readAdoption(dir, NOW)).toEqual({
      state: "invalid",
      problem: `${ADOPTION_FILE} is not valid JSON.`,
    })
    for (const [text, problem] of [
      ["null", "needs version 1."],
      ['{"version":2}', "needs version 1."],
      [valid({ startedAt: "yesterday" }), 'needs "startedAt" and "expiresAt" dates (YYYY-MM-DD).'],
      [valid({ expiresAt: undefined }), 'needs "startedAt" and "expiresAt" dates (YYYY-MM-DD).'],
      [valid({ enforce: "Lint" }), '"enforce" must be a list of check ids.'],
      [valid({ enforce: [1] }), '"enforce" must be a list of check ids.'],
    ] as const) {
      write(text)
      expect(readAdoption(dir, NOW)).toEqual({
        state: "invalid",
        problem: `${ADOPTION_FILE} ${problem}`,
      })
    }
  })
})

describe("newAdoption / writeAdoption", () => {
  it("starts today, ends after the default period, and enforces nothing", () => {
    expect(DEFAULT_DAYS).toBe(90)
    expect(newAdoption(NOW)).toEqual({
      version: 1,
      startedAt: "2026-10-12",
      expiresAt: "2027-01-10",
      enforce: [],
    })
    expect(newAdoption(NOW, 7).expiresAt).toBe("2026-10-19")
  })
  it("writes a file readAdoption reads back, creating the folder", () => {
    writeAdoption(dir, newAdoption(NOW))
    expect(readAdoption(dir, NOW).state).toBe("active")
    expect(readFileSync(path.join(dir, ADOPTION_FILE), "utf8").endsWith("}\n")).toBe(true)
  })
})

describe("advisoryFailures", () => {
  const results = {
    Lint: { outcome: "fail" },
    Docs: { outcome: "fail" },
    Tests: { outcome: "pass" },
    Socket: { outcome: "warn" },
    AdoptionMode: { outcome: "fail" },
  }
  it("names the failing checks the package has not promoted, in the order they ran", () => {
    expect(advisoryFailures(results, { state: "active", enforce: ["Lint"] })).toEqual(["Docs"])
    expect(advisoryFailures(results, { state: "active", enforce: [] })).toEqual(["Lint", "Docs"])
  })
  it("never counts a pass, a warning, a promoted check, or the AdoptionMode check itself", () => {
    const names = advisoryFailures(results, { state: "active", enforce: [] })
    for (const id of ["Tests", "Socket", "AdoptionMode"]) expect(names).not.toContain(id)
  })
  it("names nothing when the package is not adopting, or its time is up", () => {
    for (const state of ["absent", "expired", "invalid"] as const) {
      expect(advisoryFailures(results, { state, enforce: [] })).toEqual([])
    }
  })
})

describe("promote", () => {
  const checks = ["Lint", "Docs", "Tests"]
  it("refuses outside adoption mode, and on an invalid file", () => {
    let h = io()
    expect(promote(["Lint"], dir, checks, h.io, NOW)).toBe(1)
    expect(h.err.join("")).toBe(
      "[promote] this package is not in adoption mode: every check already enforces.\n",
    )
    write("{ nope")
    h = io()
    expect(promote(["Lint"], dir, checks, h.io, NOW)).toBe(1)
    expect(h.err.join("")).toContain("is not valid JSON.")
  })
  it("asks which checks, rejects --all mixed with names, and names a check that does not exist", () => {
    write(valid({ enforce: [] }))
    let h = io()
    expect(promote([], dir, checks, h.io, NOW)).toBe(2)
    const usage = "Usage: internal-package-contract promote <Check> [<Check>...] | --all\n"
    expect(h.err.join("")).toBe(`[promote] name the checks to enforce, or --all.\n${usage}`)
    h = io()
    expect(promote(["--all", "Lint"], dir, checks, h.io, NOW)).toBe(2)
    expect(h.err.join("")).toBe(`[promote] --all stands alone.\n${usage}`)
    h = io()
    expect(promote(["Lnt", "Docs"], dir, checks, h.io, NOW)).toBe(2)
    expect(h.err.join("")).toBe("[promote] not a check: Lnt. Checks: Lint, Docs, Tests.\n")
    h = io()
    expect(promote(["Lnt", "Dcs", "Lint"], dir, checks, h.io, NOW)).toBe(2)
    expect(h.err.join("")).toBe("[promote] not a check: Lnt, Dcs. Checks: Lint, Docs, Tests.\n")
    expect(JSON.parse(readFileSync(path.join(dir, ADOPTION_FILE), "utf8")).enforce).toEqual([])
  })
  it("adds the checks to what is enforced, sorted and without repeats, keeping the dates", () => {
    write(valid({ enforce: ["Tests"] }))
    const h = io()
    expect(promote(["Lint", "Tests"], dir, checks, h.io, NOW)).toBe(0)
    expect(JSON.parse(readFileSync(path.join(dir, ADOPTION_FILE), "utf8"))).toEqual({
      version: 1,
      startedAt: "2026-10-01",
      expiresAt: "2026-12-31",
      enforce: ["Lint", "Tests"],
    })
    expect(h.out.join("")).toBe(
      "[promote] now enforcing: Lint, Tests. 1 check(s) still report failures without failing the run.\n",
    )
  })
  it("ends adoption mode with --all by removing the file", () => {
    write(valid())
    const h = io()
    expect(promote(["--all"], dir, checks, h.io, NOW)).toBe(0)
    expect(existsSync(path.join(dir, ADOPTION_FILE))).toBe(false)
    expect(h.out.join("")).toBe(
      "[promote] adoption mode is over: every check enforces from now on.\n",
    )
  })
})

describe("adoptionModeCheck (policy)", () => {
  const judge = (value: unknown) => adoptionModeCheck().policy(makeContext(makeJsonResult(value)))
  it("runs the bundled script and asks for JSON", () => {
    const check = adoptionModeCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-adoption-mode\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes when the package is not adopting", async () => {
    expect(await judge({ ok: true, state: "absent" })).toEqual({
      outcome: "pass",
      rationale: "AdoptionMode: not adopting; every check can fail the run.",
    })
  })
  it("warns while adopting, with the date, the days left and what is enforced", async () => {
    const result = await judge({
      ok: true,
      state: "active",
      expiresAt: "2026-12-31",
      daysLeft: 81,
      enforce: ["Lint", "Docs"],
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain(
      "does not fail the run until 2026-12-31 (81 day(s) left). Enforcing: Lint, Docs.",
    )
    expect(result.rationale).toContain("`internal-package-contract promote <Check>`")
    expect(
      (await judge({ ok: true, state: "active", expiresAt: "x", daysLeft: 1 })).rationale,
    ).toContain("Enforcing: nothing yet.")
  })
  it("fails once the period has ended, and on an invalid file", async () => {
    expect(await judge({ ok: true, state: "expired", expiresAt: "2026-01-01" })).toEqual({
      outcome: "fail",
      rationale:
        "AdoptionMode: the adoption period ended on 2026-01-01. Run `internal-package-contract promote --all` so every check enforces, or promote the rest and delete .repo-contract/adoption.json.",
    })
    expect(await judge({ ok: true, state: "invalid", problem: "bad file" })).toEqual({
      outcome: "fail",
      rationale: "AdoptionMode: bad file",
    })
    expect((await judge({ ok: true, state: "invalid" })).rationale).toBe(
      "AdoptionMode: the adoption file is invalid.",
    )
  })
  it("fails closed, naming the tool, on output that is not the envelope or a run that did not finish", async () => {
    const bad = await adoptionModeCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("AdoptionMode: output could not be parsed as JSON.\noops")
    const stopped = await adoptionModeCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stopped.rationale).toBe(
      "check-adoption-mode did not run to completion (status: timed_out).",
    )
  })
})

describe("check-adoption-mode (script)", () => {
  const script = path.resolve(import.meta.dirname, "../scripts/check-adoption-mode.mjs")
  it("prints the adoption state as the envelope", () => {
    const run = () =>
      JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
    expect(run()).toEqual({ ok: true, state: "absent" })
    write(valid({ expiresAt: "2999-01-01" }))
    expect(run()).toMatchObject({ ok: true, state: "active", enforce: ["Lint"] })
  })
})

describe("runContract in adoption mode", () => {
  const evidence = (ids: string[]) => ({
    version: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    checks: Object.fromEntries(ids.map((id) => [id, { durationMs: 1 }])),
  })
  const run =
    (outcomes: Record<string, "pass" | "fail">) =>
    (_c: unknown, options?: { checks: readonly string[] }) => {
      const ids = options?.checks ?? Object.keys(outcomes)
      return Promise.resolve({
        evidence: evidence([...ids]),
        verdict: {
          passed: !ids.some((id) => outcomes[id] === "fail"),
          checks: Object.fromEntries(
            ids.map((id) => [id, { outcome: outcomes[id], rationale: `${id} said so` }]),
          ),
        },
      })
    }
  const go = async (outcomes: Record<string, "pass" | "fail">) => {
    let text = ""
    const result = await runContract({
      runRepoContract: run(outcomes) as never,
      config: { checks: Object.fromEntries(Object.keys(outcomes).map((id) => [id, {}])) },
      cwd: dir,
      title: "T",
      argv: [],
      env: {},
      out: { write: (chunk: string) => (text += chunk) },
      prepare: () => undefined,
    })
    return { ...result, text }
  }
  it("passes, showing every failure in full as an error, and says how to promote", async () => {
    write(valid({ enforce: [] }))
    const result = await go({ Lint: "fail", Docs: "pass" })
    expect(result.passed).toBe(true)
    expect(result.text).toContain("[FAIL (advisory)] Lint: Lint said so")
    expect(result.text).toContain("1 fail")
    expect(result.text).toContain(
      "Adoption mode: 1 failing check(s) are advisory and do not fail the run (Lint).",
    )
    expect(process.exitCode).toBe(0)
  })
  it("lists every advisory failure, separated by commas", async () => {
    write(valid({ enforce: [] }))
    const result = await go({ Lint: "fail", Docs: "fail" })
    expect(result.text).toContain("are advisory and do not fail the run (Lint, Docs). Fix one,")
  })
  it("does not hold the package to the strict gate while it is adopting, and does once it is not", async () => {
    const unexcepted = {
      outcome: "warn",
      rationale: "Not evaluated (no exception recorded; add x): y",
    }
    const strict = async () => {
      let text = ""
      const result = await runContract({
        runRepoContract: (() =>
          Promise.resolve({
            evidence: evidence(["Chrome"]),
            verdict: { passed: true, checks: { Chrome: unexcepted } },
          })) as never,
        config: { checks: { Chrome: {} } },
        cwd: dir,
        title: "T",
        argv: ["--strict"],
        env: {},
        out: { write: (chunk: string) => (text += chunk) },
        prepare: () => undefined,
      })
      return { ...result, text }
    }
    write(valid({ enforce: [] }))
    expect((await strict()).passed).toBe(true)
    rmSync(path.join(dir, ADOPTION_FILE))
    expect((await strict()).passed).toBe(false)
    process.exitCode = 0
  })
  it("still fails on a check that has been promoted", async () => {
    write(valid({ enforce: ["Lint"] }))
    const result = await go({ Lint: "fail", Docs: "fail" })
    expect(result.passed).toBe(false)
    expect(result.text).toContain("[FAIL] Lint: Lint said so")
    expect(result.text).toContain("[FAIL (advisory)] Docs: Docs said so")
    process.exitCode = 0
  })
  it("fails as before once the period has ended, and when the package is not adopting", async () => {
    write(valid({ expiresAt: "2020-01-01" }))
    expect((await go({ Lint: "fail" })).passed).toBe(false)
    rmSync(path.join(dir, ADOPTION_FILE))
    const plain = await go({ Lint: "fail" })
    expect(plain.passed).toBe(false)
    expect(plain.text).not.toContain("Adoption mode")
    process.exitCode = 0
  })
})

describe("diagnose: adoption", () => {
  const find = async () =>
    (
      await diagnose({
        cwd: dir,
        packageRoot: path.resolve(import.meta.dirname, ".."),
        git: () => undefined,
      })
    ).find((item) => item.id === "adoption")
  beforeEach(() => writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "w" })))
  it("is fine when not adopting", async () => {
    expect((await find())?.state).toBe("ok")
  })
  it("asks for promotions while adoption mode is on", async () => {
    write(valid({ expiresAt: "2999-01-01", enforce: ["Lint", "Docs"] }))
    const item = await find()
    expect(item?.state).toBe("todo")
    expect(item?.what).toContain("until 2999-01-01")
    expect(item?.what).toContain("Lint, Docs enforce")
    write(valid({ expiresAt: "2999-01-01", enforce: [] }))
    expect((await find())?.what).toContain("nothing enforces yet")
  })
  it("asks to end adoption mode when its time is up or its file is broken", async () => {
    write(valid({ expiresAt: "2020-01-01" }))
    expect((await find())?.what).toBe("The adoption period ended on 2020-01-01.")
    write("{ nope")
    expect((await find())?.what).toBe(`${ADOPTION_FILE} is not valid JSON.`)
    expect((await find())?.fix).toBe(
      "Run `internal-package-contract promote --all` so every check enforces.",
    )
  })
})
