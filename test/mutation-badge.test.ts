import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mutationBadge, mutationScore, run } from "../scripts/badges/mutation-badge.mjs"

const report = (...statuses: string[]) => ({
  files: {
    "a.ts": { mutants: statuses.slice(0, 2).map((status) => ({ status })) },
    "b.ts": { mutants: statuses.slice(2).map((status) => ({ status })) },
  },
})

describe("mutationScore", () => {
  it("counts Killed, RuntimeError and CompileError as detected", () => {
    expect(mutationScore(report("Killed", "RuntimeError", "CompileError"))).toBe(100)
  })
  it("keeps Survived, NoCoverage and Timeout in the denominator", () => {
    expect(mutationScore(report("Killed", "Survived", "NoCoverage", "Timeout"))).toBe(25)
  })
  it("drops Ignored mutants from the denominator", () => {
    expect(mutationScore(report("Killed", "Ignored", "Ignored", "Survived"))).toBe(50)
  })
  it("has no score when nothing was applicable", () => {
    expect(mutationScore(report("Ignored"))).toBeUndefined()
    expect(mutationScore({})).toBeUndefined()
    expect(mutationScore({ files: { "a.ts": {} } })).toBeUndefined()
  })
})

describe("mutationBadge", () => {
  it("is a shields endpoint with one decimal", () => {
    expect(mutationBadge(100)).toEqual({
      schemaVersion: 1,
      label: "mutation",
      message: "100.0%",
      color: "brightgreen",
    })
    expect(mutationBadge(87.456).message).toBe("87.5%")
  })
  it("turns yellow below 95 and red below 80, exactly at the boundaries", () => {
    expect(mutationBadge(95).color).toBe("brightgreen")
    expect(mutationBadge(94.9).color).toBe("yellow")
    expect(mutationBadge(80).color).toBe("yellow")
    expect(mutationBadge(79.9).color).toBe("red")
  })
})

describe("run", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-mutbadge-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const io = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
  }
  const put = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), typeof value === "string" ? value : JSON.stringify(value))
  }

  it("writes the badge to the default paths and says what it scored", () => {
    put("reports/mutation/mutation.json", report("Killed", "Killed", "Killed", "Survived"))
    const { io: sinks, out, err } = io()
    expect(run([], dir, sinks)).toBe(0)
    expect(out).toEqual(["[mutation-badge] wrote docs/mutation-badge.json (75.0%)\n"])
    expect(err).toEqual([])
    expect(JSON.parse(readFileSync(path.join(dir, "docs/mutation-badge.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      label: "mutation",
      message: "75.0%",
      color: "red",
    })
    expect(readFileSync(path.join(dir, "docs/mutation-badge.json"), "utf8").endsWith("}\n")).toBe(
      true,
    )
  })
  it("honours --report and --out", () => {
    put("r.json", report("Killed"))
    const { io: sinks, out } = io()
    expect(run(["--report", "r.json", "--out", "x/b.json"], dir, sinks)).toBe(0)
    expect(out[0]).toBe("[mutation-badge] wrote x/b.json (100.0%)\n")
    expect(JSON.parse(readFileSync(path.join(dir, "x/b.json"), "utf8")).message).toBe("100.0%")
  })
  it("refuses to write from a missing or unparseable report", () => {
    for (const setup of [() => {}, () => put("reports/mutation/mutation.json", "not json")]) {
      setup()
      const { io: sinks, err } = io()
      expect(run([], dir, sinks)).toBe(1)
      expect(err).toEqual([
        "[mutation-badge] reports/mutation/mutation.json is missing or not JSON. Run the mutation suite first, so the badge is never written from nothing.\n",
      ])
    }
  })
  it("refuses to score a report with nothing applicable", () => {
    put("reports/mutation/mutation.json", report("Ignored"))
    const { io: sinks, err } = io()
    expect(run([], dir, sinks)).toBe(1)
    expect(err).toEqual([
      "[mutation-badge] reports/mutation/mutation.json has no applicable mutants, so there is nothing to score.\n",
    ])
  })
  it("rejects an unknown argument with the usage line", () => {
    const { io: sinks, err } = io()
    expect(run(["--nope"], dir, sinks)).toBe(2)
    expect(err).toEqual([
      "[mutation-badge] unknown argument: --nope\nUsage: run-mutation-badge [--report reports/mutation/mutation.json] [--out docs/mutation-badge.json]\n",
    ])
  })
})

describe("run-mutation-badge (entry)", () => {
  it("exits non-zero and explains itself when there is no report", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ipc-mutbadge-entry-"))
    try {
      const script = path.resolve(import.meta.dirname, "../scripts/run-mutation-badge.mjs")
      const result = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("is missing or not JSON")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
