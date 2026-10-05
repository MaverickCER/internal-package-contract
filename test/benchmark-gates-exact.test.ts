import { describe, expect, it } from "vitest"
import {
  DEFAULT_GATES,
  complexityFindings,
  environmentNotes,
  evaluateGates,
  overheadFindings,
  resolveGates,
} from "../scripts/benchmark/gates.mjs"

const run = (overheadPercent: number | null, baselineMs: number, extra: object = {}) => ({
  analysis: { cost: { typical: { n: 640, baselineMs, overheadPercent } }, ...extra },
})
const gates = resolveGates(undefined)
const over = (now: object | undefined, then: object | null | undefined) =>
  overheadFindings(now, [{ name: "ref", results: then }], gates)

describe("gates -- complexity", () => {
  it("fails once per function whose class differs, naming both notations and the fit", () => {
    const findings = complexityFindings({
      analysis: {
        complexity: {
          "fn:a": {
            agreement: "differs",
            expectedNotation: "O(n)",
            notation: "O(n²)",
            exponent: 2.004,
            rSquared: 0.9876,
          },
          "fn:b": { agreement: "differs", expected: "constant", class: "linear" },
          "fn:c": { agreement: "matches" },
          "fn:d": null,
        },
      },
    })
    expect(findings).toEqual([
      {
        level: "fail",
        kind: "complexity",
        message:
          "`fn:a`: documented O(n), measured O(n²) (exponent 2.00, R² 0.99). Either the code regressed or the documented big-O is wrong -- decide which and fix it.",
      },
      {
        level: "fail",
        kind: "complexity",
        message:
          "`fn:b`: documented constant, measured linear (exponent n/a, R² n/a). Either the code regressed or the documented big-O is wrong -- decide which and fix it.",
      },
    ])
  })

  it("finds nothing without an analysis", () => {
    expect(complexityFindings(undefined)).toEqual([])
    expect(complexityFindings({})).toEqual([])
  })
})

describe("gates -- normalized overhead", () => {
  it("reads the typical row only when it has a numeric baseline", () => {
    expect(over(run(500, 10), run(100, 10))).toHaveLength(1)
    expect(over({ analysis: { cost: {} } }, run(100, 10))).toEqual([])
    expect(over({ analysis: {} }, run(100, 10))).toEqual([])
    expect(over({}, run(100, 10))).toEqual([])
    expect(over(undefined, run(100, 10))).toEqual([])
    expect(
      over({ analysis: { cost: { typical: { overheadPercent: 500 } } } }, run(100, 10)),
    ).toEqual([])
    expect(
      over(run(500, 10), { analysis: { cost: { typical: { overheadPercent: 100 } } } }),
    ).toEqual([])
    expect(over(run(500, 10), { analysis: { cost: {} } })).toEqual([])
    expect(over(run(500, 10), { analysis: {} })).toEqual([])
  })

  it("skips a missing, empty or zero reference, and a missing or negative or null current overhead", () => {
    expect(over(run(500, 10), null)).toEqual([])
    expect(over(run(500, 10), undefined)).toEqual([])
    expect(over(run(500, 10), run(0, 10))).toEqual([])
    expect(over(run(500, 10), run(null, 10))).toEqual([])
    expect(over(run(null, 10), run(100, 10))).toEqual([])
    expect(over(run(-5, 10), run(100, 10))).toEqual([])
  })

  it("judges a baseline exactly at the noise floor, and skips one below it", () => {
    expect(over(run(500, 0.005), run(100, 10))).toHaveLength(1)
    expect(over(run(500, 0.004), run(100, 10))).toEqual([])
    expect(over(run(500, 10), run(100, 0.005))).toHaveLength(1)
    expect(over(run(500, 10), run(100, 0.004))).toEqual([])
  })

  it("allows 50% growth for millisecond-scale work and 70% below a millisecond, exclusive of the limit", () => {
    expect(over(run(150, 1), run(100, 1))).toEqual([])
    expect(over(run(151, 1), run(100, 1))).toHaveLength(1)
    expect(over(run(170, 0.999), run(100, 0.999))).toEqual([])
    expect(over(run(171, 0.999), run(100, 0.999))).toHaveLength(1)
    expect(over(run(160, 0.999), run(100, 0.999))).toEqual([])
    expect(over(run(160, 1), run(100, 1))).toHaveLength(1)
  })

  it("explains a failure with both figures, the growth and the allowance", () => {
    expect(over(run(300, 10), run(100, 10))).toEqual([
      {
        level: "fail",
        kind: "normalized-overhead",
        message:
          "Overhead relative to the baseline grew from 100.0% (ref) to 300.0% -- up 200%, over the 50% allowed for work this fast. Both figures are same-run ratios, so this is not a slower machine.",
      },
    ])
  })

  it("honours overridden limits and floors", () => {
    const loose = resolveGates({
      normalizedOverheadMaxIncreasePercent: { millisecondScale: 500 },
      noiseFloorBaselineMs: 50,
    })
    expect(overheadFindings(run(300, 10), [{ name: "r", results: run(100, 10) }], loose)).toEqual(
      [],
    )
    expect(overheadFindings(run(900, 40), [{ name: "r", results: run(100, 40) }], loose)).toEqual(
      [],
    )
    expect(resolveGates({ complexity: false }).complexity).toBe(false)
    expect(resolveGates(undefined)).toEqual(DEFAULT_GATES)
  })
})

describe("gates -- environment notes", () => {
  const env = (nodeVersion?: string, cpuModel?: string) => ({
    metadata: { environment: { nodeVersion, cpuModel } },
  })

  it("notes a different Node major, ignoring a leading v", () => {
    expect(environmentNotes(env("v20.1.0"), env("v22.0.0"))).toEqual([
      {
        level: "note",
        kind: "environment",
        message:
          "The previous run used Node v20.1.0 and this one Node v22.0.0: raw time deltas are not comparable (the engine differs), only the same-run gates are meaningful.",
      },
    ])
    expect(environmentNotes(env("v22.1.0"), env("22.9.0"))).toEqual([])
    expect(environmentNotes(env("22.1.0"), env("v22.9.0"))).toEqual([])
    expect(environmentNotes(env("20.0.0"), env("22.0.0"))).toHaveLength(1)
  })

  it("notes a different CPU model", () => {
    expect(environmentNotes(env(undefined, "A"), env(undefined, "B"))).toEqual([
      {
        level: "note",
        kind: "environment",
        message:
          "The previous run was on A and this one on B: raw time deltas compare two different machines.",
      },
    ])
    expect(environmentNotes(env(undefined, "A"), env(undefined, "A"))).toEqual([])
    expect(environmentNotes(env(undefined, undefined), env(undefined, "B"))).toEqual([])
    expect(environmentNotes(env(undefined, "A"), env(undefined, undefined))).toEqual([])
    expect(environmentNotes(env("v20.0.0"), env(undefined))).toEqual([])
    expect(environmentNotes(env(undefined), env("v20.0.0"))).toEqual([])
  })

  it("gives both notes when both differ, and none when either run lacks an environment", () => {
    expect(environmentNotes(env("20.0.0", "A"), env("22.0.0", "B"))).toHaveLength(2)
    expect(environmentNotes(null, env("22.0.0"))).toEqual([])
    expect(environmentNotes(env("22.0.0"), undefined)).toEqual([])
    expect(environmentNotes(env("22.0.0"), {})).toEqual([])
    expect(environmentNotes({}, env("22.0.0"))).toEqual([])
    expect(environmentNotes({ metadata: {} }, env("22.0.0"))).toEqual([])
    expect(environmentNotes(env("22.0.0"), { metadata: {} })).toEqual([])
  })
})

describe("gates -- evaluateGates", () => {
  it("combines complexity, overhead against the previous run and the release, and environment notes", () => {
    const current = {
      ...run(400, 10, { complexity: { "fn:a": { agreement: "differs" } } }),
      metadata: { environment: { nodeVersion: "v22.0.0" } },
    }
    const previous = { ...run(100, 10), metadata: { environment: { nodeVersion: "v20.0.0" } } }
    const release = run(100, 10)
    const findings = evaluateGates({ previous, release, current })
    expect(findings.map((f) => f.kind)).toEqual([
      "complexity",
      "normalized-overhead",
      "normalized-overhead",
      "environment",
    ])
    expect(findings[1]?.message).toContain("(last run on main)")
    expect(findings[2]?.message).toContain("(last release)")
  })

  it("leaves complexity out when the gate is switched off", () => {
    const current = run(100, 10, { complexity: { "fn:a": { agreement: "differs" } } })
    expect(evaluateGates({ current, gates: { complexity: false } })).toEqual([])
    expect(evaluateGates({ current, gates: { complexity: true } })).toHaveLength(1)
  })

  it("finds nothing for no current results", () => {
    expect(evaluateGates({ previous: run(100, 10), release: run(100, 10) })).toEqual([])
  })
})
