import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { complexityGainFindings, evaluateGates } from "../scripts/benchmark/gates.mjs"
import { parseArgs, summarize } from "../scripts/benchmark/render-summary.mjs"
import { REQUIRED_FIELDS } from "../scripts/benchmark/complexity-gain.mjs"

const SIZES = [10, 100, 1000, 10000]
const results = (exponent: number) => ({
  results: {
    parse: {
      tiers: Object.fromEntries(
        SIZES.map((size, index) => [
          `t${String(index)}`,
          {
            status: "completed",
            inputs: { n: size },
            durationMs: { medianMs: size ** exponent / 10 },
          },
        ]),
      ),
    },
  },
})
const NOW = new Date("2026-10-11T12:00:00Z")
const filled = Object.fromEntries(REQUIRED_FIELDS.map((key) => [key, `${key} written`]))
const record = (extra: Record<string, unknown> = {}) => ({
  id: "benchmark-complexity:perf:parse:quadratic",
  suite: "perf",
  group: "parse",
  to: "quadratic",
  ...filled,
  expires: "",
  ...extra,
})

describe("complexityGainFindings", () => {
  it("fails a group that got worse than at the last release with no record, naming the id to add", () => {
    const findings = complexityGainFindings({
      suite: "perf",
      release: results(1),
      current: results(2),
      records: [],
      now: NOW,
    })
    expect(findings).toEqual([
      {
        level: "fail",
        kind: "complexity-gain",
        message:
          "perf / parse: linear -> quadratic (exponent 1.00 -> 2.00). It got worse at big-O than at the last release and no human has accepted it. Fix the regression, or review it and record the decision as benchmark-complexity:perf:parse:quadratic in .repo-contract/exceptions/benchmark-complexity.json (no record accepts it).",
      },
    ])
  })
  it("notes, rather than fails, a group a complete record accepts", () => {
    expect(
      complexityGainFindings({
        suite: "perf",
        release: results(1),
        current: results(2),
        records: [record()],
        now: NOW,
      }),
    ).toEqual([
      {
        level: "note",
        kind: "complexity-gain",
        message:
          "perf / parse: linear -> quadratic (exponent 1.00 -> 2.00). Accepted by benchmark-complexity:perf:parse:quadratic.",
      },
    ])
  })
  it("has nothing to say about an improvement, no change or no release", () => {
    const base = { suite: "perf", records: [], now: NOW }
    expect(complexityGainFindings({ ...base, release: results(2), current: results(1) })).toEqual(
      [],
    )
    expect(complexityGainFindings({ ...base, release: results(1), current: results(1) })).toEqual(
      [],
    )
    expect(complexityGainFindings({ ...base, release: {}, current: results(3) })).toEqual([])
    expect(complexityGainFindings({ ...base, release: null, current: results(3) })).toEqual([])
  })
})

describe("evaluateGates -- complexity gain", () => {
  it("adds the gain findings only when exceptions are supplied", () => {
    const withIt = evaluateGates({
      release: results(1),
      current: results(2),
      exceptions: { suite: "perf", records: [], now: NOW },
    })
    expect(withIt.filter((finding) => finding.kind === "complexity-gain")).toHaveLength(1)
    expect(
      evaluateGates({ release: results(1), current: results(2) }).filter(
        (finding) => finding.kind === "complexity-gain",
      ),
    ).toEqual([])
  })
})

describe("parseArgs --exceptions", () => {
  it("takes the registry path", () => {
    expect(parseArgs(["--exceptions", "r.json"]).exceptionsPath).toBe("r.json")
    expect(parseArgs([]).exceptionsPath).toBeUndefined()
  })
})

describe("summarize -- complexity gain", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-gain-gate-"))
    mkdirSync(path.join(dir, "perf"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), JSON.stringify(value))
    return path.join(dir, file)
  }
  const example = () =>
    `Perf|${put("prev.json", results(1))}|${put("perf/results.json", results(2))}||${put("rel.json", results(1))}`

  it("fails the run for a gain with no record, judging the suite named by the results directory", async () => {
    const { failures, markdown } = await summarize({
      examples: [example()],
      marker: "<!-- m -->",
      now: NOW,
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ kind: "complexity-gain", label: "Perf" })
    expect(markdown).toContain("perf / parse: linear -> quadratic")
    expect(markdown).toContain("Three things can fail a benchmark run")
  })
  it("passes the run, with a note, when the registry accepts it", async () => {
    const exceptionsPath = put("registry.json", { exceptions: [record()] })
    const { failures, markdown } = await summarize({
      examples: [example()],
      marker: "<!-- m -->",
      exceptionsPath,
      now: NOW,
    })
    expect(failures).toEqual([])
    expect(markdown).toContain("Accepted by benchmark-complexity:perf:parse:quadratic.")
  })
  it("treats a missing registry as no exceptions", async () => {
    const { failures } = await summarize({
      examples: [example()],
      marker: "<!-- m -->",
      exceptionsPath: path.join(dir, "absent.json"),
      now: NOW,
    })
    expect(failures).toHaveLength(1)
  })
})
