import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  BENCHMARK_COMPLEXITY_SCHEMA,
  benchmarkComplexityCheck,
} from "../checks/benchmark-complexity.js"
import { scanComplexity, undeterminedGroups } from "../scripts/benchmark/complexity-scan.mjs"
import { REQUIRED_FIELDS } from "../scripts/benchmark/complexity-gain.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

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

let dir: string
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: dir,
    stdio: "ignore",
  })
const put = (file: string, value: unknown) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), JSON.stringify(value))
}
const commit = (message: string) => {
  git("add", "-A")
  git("commit", "-q", "-m", message)
}
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-bench-complexity-"))
  git("init", "-q")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("scanComplexity", () => {
  it("has nothing to scan without suites", () => {
    expect(scanComplexity(dir)).toEqual({
      state: "none",
      tag: null,
      suites: [],
      gains: [],
      undetermined: [],
    })
  })
  it("has no baseline without a release tag", () => {
    put("benchmarks/perf/results.json", results(1))
    commit("first")
    expect(scanComplexity(dir)).toEqual({
      state: "no-baseline",
      tag: null,
      suites: ["perf"],
      gains: [],
      undetermined: [],
    })
  })
  it("lists the groups whose big-O could not be determined, in every suite", () => {
    const withAnalysis = (complexity: object) => ({ ...results(1), analysis: { complexity } })
    put(
      "benchmarks/b/results.json",
      withAnalysis({
        g: { class: null, reason: "no-size-variation", size: 10, variable: "file" },
      }),
    )
    put(
      "benchmarks/a/results.json",
      withAnalysis({ ok: { class: "linear" }, h: { class: null }, none: null }),
    )
    put("benchmarks/c/results.json", results(1))
    put("benchmarks/n/results.json", null)
    expect(undeterminedGroups(dir, ["a", "b", "c", "n"])).toStrictEqual([
      {
        suite: "a",
        group: "h",
        reason:
          "the results record no reason (they were written before reasons were recorded); run the benchmark again to get one",
      },
      {
        suite: "b",
        group: "g",
        variable: "file",
        reason:
          "every usable measurement is at the same file size (10), so there is no growth to measure",
      },
    ])
    commit("first")
    expect(scanComplexity(dir).undetermined).toHaveLength(2)
    git("tag", "v0.1.0")
    expect(scanComplexity(dir).undetermined).toHaveLength(2)
  })
  it("reports a group that got worse since the last release tag", () => {
    put("benchmarks/perf/results.json", results(1))
    commit("release")
    git("tag", "v0.1.0")
    put("benchmarks/perf/results.json", results(2))
    commit("regress")
    const scan = scanComplexity(dir)
    expect(scan.state).toBe("compared")
    expect(scan.tag).toBe("v0.1.0")
    expect(
      scan.gains.map(({ suite, group, previousClass, currentClass }) => ({
        suite,
        group,
        previousClass,
        currentClass,
      })),
    ).toEqual([
      { suite: "perf", group: "parse", previousClass: "linear", currentClass: "quadratic" },
    ])
  })
  it("compares with the nearest release tag, not an older one", () => {
    put("benchmarks/perf/results.json", results(1))
    commit("one")
    git("tag", "v0.1.0")
    put("benchmarks/perf/results.json", results(2))
    commit("two")
    git("tag", "v0.2.0")
    expect(scanComplexity(dir).gains).toEqual([])
  })
  it("ignores tags that are not versions", () => {
    put("benchmarks/perf/results.json", results(1))
    commit("one")
    git("tag", "nightly")
    expect(scanComplexity(dir).state).toBe("no-baseline")
  })
  it("skips a suite that did not exist or was unreadable at the release", () => {
    put("benchmarks/old/results.json", results(1))
    commit("release")
    git("tag", "v0.1.0")
    put("benchmarks/new/results.json", results(3))
    commit("add suite")
    expect(scanComplexity(dir)).toMatchObject({ state: "compared", gains: [] })
  })
  it("fails loudly when a suite's released results are not JSON, rather than hiding it", () => {
    mkdirSync(path.join(dir, "benchmarks", "perf"), { recursive: true })
    writeFileSync(path.join(dir, "benchmarks", "perf", "results.json"), "not json")
    commit("release")
    git("tag", "v0.1.0")
    put("benchmarks/perf/results.json", results(3))
    commit("fix file")
    expect(() => scanComplexity(dir)).toThrow(SyntaxError)
  })
})

const NOW = new Date("2026-10-11T12:00:00Z")
const GAIN = {
  suite: "perf",
  group: "parse",
  previousClass: "linear",
  currentClass: "quadratic",
  previousExponent: 1,
  currentExponent: 2,
}
const judge = (value: unknown) =>
  benchmarkComplexityCheck({ cwd: dir, now: NOW }).policy(makeContext(makeJsonResult(value)))
const filled = Object.fromEntries(
  REQUIRED_FIELDS.filter((key) => key !== "justification").map((key) => [key, `${key} written`]),
)
const registry = (records: unknown[]) =>
  put(".repo-contract/exceptions/benchmark-complexity.json", { exceptions: records })
const complete = (extra: Record<string, unknown> = {}) => ({
  id: "benchmark-complexity:perf:parse:quadratic",
  version: 2,
  justification: "Reviewed: the pairwise check is needed for ordering.",
  suite: "perf",
  group: "parse",
  to: "quadratic",
  ...filled,
  expires: "",
  ...extra,
})

describe("benchmarkComplexityCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = benchmarkComplexityCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-benchmark-complexity\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes, saying why, with no benchmarks or no release", async () => {
    expect(await judge({ ok: true, state: "none" })).toEqual({
      outcome: "pass",
      rationale: "BenchmarkComplexity: this package has no committed benchmark results to compare.",
    })
    expect(await judge({ ok: true, state: "no-baseline" })).toEqual({
      outcome: "pass",
      rationale:
        "BenchmarkComplexity: no release tag exists yet, so there is no released complexity to compare with.",
    })
  })
  it("passes when nothing got worse", async () => {
    expect(
      await judge({ ok: true, state: "compared", tag: "v0.1.0", suites: ["a", "b"], gains: [] }),
    ).toEqual({
      outcome: "pass",
      rationale:
        "BenchmarkComplexity: no benchmark group got worse at big-O across 2 suite(s) since v0.1.0.",
    })
  })
  it("fails a gain with no record, naming the id to add and the file", async () => {
    const result = await judge({
      ok: true,
      state: "compared",
      tag: "v0.1.0",
      suites: ["perf"],
      gains: [GAIN],
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe(
      [
        "BenchmarkComplexity: 1 benchmark group(s) got worse at big-O since v0.1.0 and no human has accepted it. Fix the regression, or review it and record the decision in .repo-contract/exceptions/benchmark-complexity.json:",
        "- perf / parse: linear -> quadratic (exponent 1.00 -> 2.00); add or complete benchmark-complexity:perf:parse:quadratic (no record accepts it)",
      ].join("\n"),
    )
  })
  it("fails a gain whose record is incomplete or expired", async () => {
    registry([complete({ constraint: "" })])
    const incomplete = await judge({
      ok: true,
      state: "compared",
      tag: "v1",
      suites: ["perf"],
      gains: [GAIN],
    })
    expect(incomplete.outcome).toBe("fail")
    expect(incomplete.rationale).toContain(
      "(benchmark-complexity:perf:parse:quadratic is not complete (missing: constraint))",
    )
    registry([complete({ expires: "2026-01-01" })])
    const expired = await judge({
      ok: true,
      state: "compared",
      tag: "v1",
      suites: ["perf"],
      gains: [GAIN],
    })
    expect(expired.outcome).toBe("fail")
    expect(expired.rationale).toContain("expires (2026-01-01 has passed)")
  })
  it("passes a gain a complete record accepts, listing it", async () => {
    registry([complete()])
    expect(
      await judge({ ok: true, state: "compared", tag: "v0.1.0", suites: ["perf"], gains: [GAIN] }),
    ).toEqual({
      outcome: "pass",
      rationale: [
        "BenchmarkComplexity: 1 complexity increase(s) since v0.1.0, each accepted by a reviewed record:",
        "- perf / parse: linear -> quadratic (exponent 1.00 -> 2.00) (benchmark-complexity:perf:parse:quadratic)",
      ].join("\n"),
    })
  })
  it("fails when the registry itself is malformed", async () => {
    registry([complete({ to: "exponential", id: "benchmark-complexity:perf:parse:exponential" })])
    const result = await judge({
      ok: true,
      state: "compared",
      tag: "v1",
      suites: ["perf"],
      gains: [GAIN],
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "BenchmarkComplexity: .repo-contract/exceptions/benchmark-complexity.json failed to load, so a complexity increase cannot be judged:",
    )
    expect(result.rationale).toContain('exceptions[0].to "exponential" is not a complexity class.')
  })
  it("fails closed on output that is not the envelope", async () => {
    const result = await benchmarkComplexityCheck().policy(
      makeContext(makeResult({ stdout: "oops" })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe("BenchmarkComplexity: output could not be parsed as JSON.\noops")
  })
})

describe("benchmarkComplexityCheck (policy) -- undetermined big-O", () => {
  const UNKNOWN = [
    { suite: "perf", group: "fn:a", variable: "file", reason: "only 1 file size was usable" },
    { suite: "perf", group: "fn:b", reason: "every size is the same" },
  ]
  const LIST =
    "2 benchmark group(s) have a big-O that could not be determined, so they are not checked against their documentation:\n- perf / fn:a (varying file): only 1 file size was usable\n- perf / fn:b: every size is the same"
  it("warns instead of passing when nothing got worse but some big-O is unknown", async () => {
    expect(
      await judge({
        ok: true,
        state: "no-baseline",
        tag: null,
        suites: ["perf"],
        gains: [],
        undetermined: UNKNOWN,
      }),
    ).toEqual({
      outcome: "warn",
      rationale: `BenchmarkComplexity: no release tag exists yet, so there is no released complexity to compare with.\n${LIST}`,
    })
    expect(
      await judge({
        ok: true,
        state: "compared",
        tag: "v1",
        suites: ["perf"],
        gains: [],
        undetermined: UNKNOWN,
      }),
    ).toEqual({
      outcome: "warn",
      rationale: `BenchmarkComplexity: no benchmark group got worse at big-O across 1 suite(s) since v1.\n${LIST}`,
    })
  })
  it("warns when every increase is accepted but some big-O is unknown", async () => {
    registry([complete()])
    const result = await judge({
      ok: true,
      state: "compared",
      tag: "v1",
      suites: ["perf"],
      gains: [GAIN],
      undetermined: UNKNOWN,
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("each accepted by a reviewed record")
    expect(result.rationale.endsWith(LIST)).toBe(true)
  })
  it("still fails for a real increase, and lists the unknown ones after it", async () => {
    const result = await judge({
      ok: true,
      state: "compared",
      tag: "v1",
      suites: ["perf"],
      gains: [GAIN],
      undetermined: UNKNOWN,
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale.endsWith(LIST)).toBe(true)
  })
  it("passes when none is unknown, and tolerates an envelope without the list", async () => {
    expect(
      (
        await judge({
          ok: true,
          state: "compared",
          tag: "v1",
          suites: ["perf"],
          gains: [],
          undetermined: [],
        })
      ).outcome,
    ).toBe("pass")
    expect(
      (await judge({ ok: true, state: "compared", tag: "v1", suites: ["perf"], gains: [] }))
        .outcome,
    ).toBe("pass")
  })
})

describe("benchmarkComplexityCheck (policy) -- edges", () => {
  it("names the tool when it did not run to completion or could not be spawned", async () => {
    const check = benchmarkComplexityCheck()
    expect(await check.policy(makeContext(makeResult({ status: "timed_out" })))).toEqual({
      outcome: "fail",
      rationale: "check-benchmark-complexity did not run to completion (status: timed_out).",
    })
  })
  it("judges against the supplied clock, not the real one", async () => {
    registry([complete({ expires: "2099-10-12" })])
    const later = new Date("2100-10-13T12:00:00Z")
    const result = await benchmarkComplexityCheck({ cwd: dir, now: later }).policy(
      makeContext(
        makeJsonResult({ ok: true, state: "compared", tag: "v1", suites: ["perf"], gains: [GAIN] }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("expires (2099-10-12 has passed)")
  })
  it("lists every problem when the registry is malformed in more than one way", async () => {
    registry([
      complete({ to: "slow", id: "benchmark-complexity:perf:parse:slow" }),
      complete({ suite: "", id: "benchmark-complexity::parse:quadratic" }),
    ])
    const result = await judge({
      ok: true,
      state: "compared",
      tag: "v1",
      suites: ["perf"],
      gains: [GAIN],
    })
    expect(result.rationale).toBe(
      [
        "BenchmarkComplexity: .repo-contract/exceptions/benchmark-complexity.json failed to load, so a complexity increase cannot be judged:",
        '- exceptions[0].to "slow" is not a complexity class.',
        "- exceptions[1].suite must be a non-empty string.",
      ].join("\n"),
    )
  })
})

describe("BENCHMARK_COMPLEXITY_SCHEMA", () => {
  const core = {
    id: "benchmark-complexity:perf:parse:quadratic",
    version: 2 as const,
    justification: "j",
  }
  const validate = (raw: Record<string, unknown>) => {
    const errors: string[] = []
    const record = BENCHMARK_COMPLEXITY_SCHEMA.validateRecord(core, raw, 3, errors)
    return { record, errors }
  }
  it("declares its namespace and metadata keys", () => {
    expect(BENCHMARK_COMPLEXITY_SCHEMA.namespace).toBe("benchmark-complexity:")
    expect(BENCHMARK_COMPLEXITY_SCHEMA.metadataKeys).toEqual(["suite", "group", "to"])
  })
  it("rebuilds a valid record", () => {
    expect(validate({ suite: "perf", group: "parse", to: "quadratic" })).toEqual({
      record: {
        id: core.id,
        version: 1,
        justification: "j",
        suite: "perf",
        group: "parse",
        to: "quadratic",
      },
      errors: [],
    })
  })
  it("reports each missing field with its position", () => {
    expect(validate({}).errors).toEqual([
      "exceptions[3].suite must be a non-empty string.",
      "exceptions[3].group must be a non-empty string.",
      "exceptions[3].to must be a non-empty string.",
    ])
  })
  it("reports exactly the one invalid field, and accepts the cheapest class", () => {
    expect(validate({ group: "parse", to: "quadratic" }).errors).toEqual([
      "exceptions[3].suite must be a non-empty string.",
    ])
    expect(validate({ suite: "perf", to: "quadratic" }).errors).toEqual([
      "exceptions[3].group must be a non-empty string.",
    ])
    expect(validate({ suite: "perf", group: "parse" }).errors).toEqual([
      "exceptions[3].to must be a non-empty string.",
    ])
    const constant = BENCHMARK_COMPLEXITY_SCHEMA.validateRecord(
      { ...core, id: "benchmark-complexity:perf:parse:constant" },
      { suite: "perf", group: "parse", to: "constant" },
      0,
      [],
    )
    expect(constant?.to).toBe("constant")
  })
  it("rejects an unknown class and an id that does not match its own fields", () => {
    expect(validate({ suite: "perf", group: "parse", to: "slow" }).errors).toEqual([
      'exceptions[3].to "slow" is not a complexity class.',
    ])
    expect(validate({ suite: "perf", group: "emit", to: "quadratic" }).errors).toEqual([
      'exceptions[3].id "benchmark-complexity:perf:parse:quadratic" does not match the id derived from its own suite, group and class ("benchmark-complexity:perf:emit:quadratic").',
    ])
  })
})

describe("check-benchmark-complexity (script)", () => {
  it("prints the scan of the working directory as one JSON envelope", () => {
    put("benchmarks/perf/results.json", results(1))
    commit("release")
    git("tag", "v0.1.0")
    put("benchmarks/perf/results.json", results(2))
    commit("regress")
    const script = path.resolve(import.meta.dirname, "../scripts/check-benchmark-complexity.mjs")
    const out = JSON.parse(
      spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout,
    )
    expect(out).toMatchObject({ ok: true, state: "compared", tag: "v0.1.0", suites: ["perf"] })
    expect(out.gains).toHaveLength(1)
  })
})
