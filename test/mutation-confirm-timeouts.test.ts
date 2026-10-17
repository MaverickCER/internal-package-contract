import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  confirmEvidence,
  confirmTimeouts,
  MAXIMUM_CONFIRMED,
  REASON,
  same,
  strykerRerun,
  timedOut,
} from "../scripts/mutation/confirm-timeouts.mjs"
import type { Mutant, Report } from "../scripts/mutation/confirm-timeouts.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "confirm-timeouts-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const mutant = (status: string, line = 10, over: Partial<Mutant> = {}): Mutant => ({
  status,
  mutatorName: "StringLiteral",
  replacement: '""',
  location: { start: { line, column: 5 }, end: { line: line + 1 } },
  ...over,
})
const reportOf = (...mutants: Mutant[]): Report => ({ files: { "a.ts": { mutants } } })

describe("timedOut and same", () => {
  it("lists only the mutants that timed out, with the file of each", () => {
    const report: Report = {
      files: {
        "a.ts": { mutants: [mutant("Killed"), mutant("Timeout")] },
        "b.ts": { mutants: [mutant("Timeout", 3)] },
      },
    }
    expect(timedOut(report).map(({ file, mutant: m }) => [file, m.location.start.line])).toEqual([
      ["a.ts", 10],
      ["b.ts", 3],
    ])
    expect(timedOut({ files: {} })).toEqual([])
  })

  it("calls two mutants the same only when the mutator, replacement, line and column all agree", () => {
    expect(same(mutant("Timeout"), mutant("Killed"))).toBe(true)
    expect(same(mutant("Timeout"), mutant("Timeout", 11))).toBe(false)
    expect(same(mutant("Timeout"), mutant("Timeout", 10, { mutatorName: "Regex" }))).toBe(false)
    expect(same(mutant("Timeout"), mutant("Timeout", 10, { replacement: "x" }))).toBe(false)
    const moved = mutant("Timeout")
    moved.location.start.column = 6
    expect(same(mutant("Timeout"), moved)).toBe(false)
  })
})

describe("confirmTimeouts", () => {
  it("changes a timeout that is caught when run alone, saying why, and runs only the lines it needs", () => {
    const report = reportOf(mutant("Killed", 1), mutant("Timeout", 10))
    const asked: unknown[] = []
    const result = confirmTimeouts(report, (file, from, to) => {
      asked.push([file, from, to])
      return reportOf(mutant("Killed", 10))
    })
    expect(asked).toEqual([["a.ts", 10, 11]])
    expect(result).toEqual({ confirmed: 1, caught: 1 })
    expect(report.files["a.ts"]?.mutants[1]).toMatchObject({
      status: "Killed",
      statusReason: REASON,
    })
    expect(report.files["a.ts"]?.mutants[0]?.statusReason).toBeUndefined()
  })

  it("keeps a timeout that times out again, or that the re-run does not report, or that it cannot run", () => {
    for (const again of [
      reportOf(mutant("Timeout", 10)),
      reportOf(mutant("Killed", 99)),
      reportOf(),
      { files: {} },
      undefined,
    ]) {
      const report = reportOf(mutant("Timeout", 10))
      expect(confirmTimeouts(report, () => again)).toEqual({ confirmed: 1, caught: 0 })
      expect(report.files["a.ts"]?.mutants[0]).toMatchObject({ status: "Timeout" })
    }
    const noStatus = reportOf(mutant("Timeout", 10))
    const unknown = mutant("Timeout", 10)
    delete unknown.status
    expect(confirmTimeouts(noStatus, () => reportOf(unknown))).toEqual({ confirmed: 1, caught: 0 })
  })

  it("re-runs each timeout on its own, and none when there are none or too many", () => {
    const calls: number[] = []
    const rerun = (_file: string, from: number): Report => {
      calls.push(from)
      return reportOf(mutant("Killed", from))
    }
    expect(confirmTimeouts(reportOf(mutant("Killed")), rerun)).toEqual({ confirmed: 0, caught: 0 })
    const two = reportOf(mutant("Timeout", 1), mutant("Timeout", 5))
    expect(confirmTimeouts(two, rerun)).toEqual({ confirmed: 2, caught: 2 })
    expect(calls).toEqual([1, 5])
    const limit = reportOf(
      ...Array.from({ length: MAXIMUM_CONFIRMED }, (_, i) => mutant("Timeout", i + 1)),
    )
    expect(confirmTimeouts(limit, rerun).confirmed).toBe(MAXIMUM_CONFIRMED)
    const tooMany = reportOf(
      ...Array.from({ length: MAXIMUM_CONFIRMED + 1 }, (_, i) => mutant("Timeout", i + 1)),
    )
    calls.length = 0
    expect(confirmTimeouts(tooMany, rerun)).toEqual({ confirmed: 0, caught: 0 })
    expect(calls).toEqual([])
    expect(MAXIMUM_CONFIRMED).toBe(5)
  })
})

describe("strykerRerun", () => {
  const evidence = () => path.join(dir, "mutation.json")

  it("runs stryker on those lines alone, cold, and reads the report it wrote where the full run's was", () => {
    const seen: { command: string; args: string[]; options: unknown }[] = []
    writeFileSync(evidence(), "the full run's report")
    const rerun = strykerRerun(dir, ["run", "--x"], evidence(), (command, args, options) => {
      seen.push({ command, args, options })
      expect(existsSync(evidence())).toBe(false)
      writeFileSync(evidence(), JSON.stringify(reportOf(mutant("Killed"))))
    })
    expect(rerun("src/a.ts", 7, 9)?.files["a.ts"]?.mutants[0]?.status).toBe("Killed")
    expect(seen).toHaveLength(1)
    expect(seen[0]?.command).toBe("stryker")
    expect(seen[0]?.args.slice(0, 2)).toEqual(["run", "--x"])
    expect(seen[0]?.args.slice(2, 4)).toEqual(["--reporters", "json"])
    expect(seen[0]?.args).toContain("--force")
    expect(seen[0]?.args[seen[0].args.indexOf("--concurrency") + 1]).toBe("1")
    expect(seen[0]?.args[seen[0].args.indexOf("--mutate") + 1]).toBe("src/a.ts:7-9")
    expect(seen[0]?.options).toEqual({ cwd: dir, stdio: "ignore" })
  })

  it("runs when the full run left no report to clear", () => {
    let ran = false
    const rerun = strykerRerun(dir, [], evidence(), () => {
      ran = true
      writeFileSync(evidence(), JSON.stringify(reportOf(mutant("Killed"))))
    })
    expect(rerun("a.ts", 1, 2)?.files["a.ts"]?.mutants).toHaveLength(1)
    expect(ran).toBe(true)
  })

  it("is nothing when the run wrote no report, or one that is not JSON", () => {
    expect(strykerRerun(dir, [], evidence(), () => undefined)("a.ts", 1, 2)).toBeUndefined()
    const bad = strykerRerun(dir, [], evidence(), () => {
      writeFileSync(evidence(), "not json")
    })
    expect(bad("a.ts", 1, 2)).toBeUndefined()
  })
})

describe("confirmEvidence", () => {
  it("puts the full run's report back after the re-runs overwrote it, with what they found", () => {
    const file = path.join(dir, "mutation.json")
    writeFileSync(file, JSON.stringify(reportOf(mutant("Timeout", 10), mutant("Survived", 20))))
    const again = (status: string) => () => {
      writeFileSync(file, "a re-run's own report")
      return reportOf(mutant(status, 10))
    }
    expect(confirmEvidence(file, again("Timeout"))).toEqual({ confirmed: 1, caught: 0 })
    const unchanged = JSON.parse(readFileSync(file).toString()) as Report
    expect(unchanged.files["a.ts"]?.mutants.map((m) => m.status)).toEqual(["Timeout", "Survived"])
    expect(confirmEvidence(file, again("Killed"))).toEqual({ confirmed: 1, caught: 1 })
    const after = JSON.parse(readFileSync(file).toString()) as Report
    expect(after.files["a.ts"]?.mutants[0]).toMatchObject({
      status: "Killed",
      statusReason: REASON,
    })
    expect(after.files["a.ts"]?.mutants[1]?.status).toBe("Survived")
  })

  it("leaves the file alone when there was no timeout to confirm", () => {
    const file = path.join(dir, "mutation.json")
    const original = JSON.stringify(reportOf(mutant("Killed")), null, 2)
    writeFileSync(file, original)
    expect(confirmEvidence(file, () => undefined)).toEqual({ confirmed: 0, caught: 0 })
    expect(readFileSync(file).toString()).toBe(original)
  })

  it("does nothing when there is no evidence or it is not a report", () => {
    expect(confirmEvidence(path.join(dir, "missing.json"), () => undefined)).toEqual({
      confirmed: 0,
      caught: 0,
    })
    const file = path.join(dir, "bad.json")
    writeFileSync(file, "not json")
    expect(confirmEvidence(file, () => undefined)).toEqual({ confirmed: 0, caught: 0 })
    expect(readFileSync(file).toString()).toBe("not json")
  })
})
