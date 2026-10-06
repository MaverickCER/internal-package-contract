import { describe, expect, it } from "vitest"
import {
  DEFAULT_GATES,
  complexityFindings,
  environmentNotes,
  evaluateGates,
  overheadFindings,
  resolveGates,
} from "../scripts/benchmark/gates.mjs"

const run = (
  over: { baselineMs?: number; overheadPercent?: number | null; node?: string; cpu?: string } = {},
) => ({
  metadata: {
    environment: { nodeVersion: over.node ?? "v24.1.0", cpuModel: over.cpu ?? "EPYC 7763" },
  },
  analysis: {
    cost: {
      typical: {
        n: 640,
        baselineMs: over.baselineMs ?? 2,
        overheadPercent: over.overheadPercent === undefined ? 100 : over.overheadPercent,
      },
    },
    complexity: {},
  },
})

describe("resolveGates()", () => {
  it("returns the defaults, and merges a package's overrides one level deep", () => {
    expect(resolveGates(undefined)).toEqual(DEFAULT_GATES)
    const merged = resolveGates({
      complexity: false,
      normalizedOverheadMaxIncreasePercent: { millisecondScale: 30 },
    })
    expect(merged.complexity).toBe(false)
    expect(merged.normalizedOverheadMaxIncreasePercent).toEqual({
      millisecondScale: 30,
      microsecondScale: 70,
      microscaleBelowMs: 1,
    })
  })
})

describe("complexityFindings()", () => {
  const withComplexity = (complexity: object) => ({ analysis: { complexity } })

  it("fails a function whose measured class differs from the documented one, and only that", () => {
    const findings = complexityFindings(
      withComplexity({
        "fn:a": {
          agreement: "differs",
          expectedNotation: "O(n)",
          notation: "O(1)",
          exponent: 0.07,
          rSquared: 0.91,
        },
        "fn:b": { agreement: "close" },
        "fn:c": { agreement: "matches" },
        "fn:d": { agreement: "unknown" },
        "end-to-end:with-package": {},
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ level: "fail", kind: "complexity" })
    expect(findings[0]?.message).toContain(
      "`fn:a`: documented O(n), measured O(1) (exponent 0.07, R² 0.91)",
    )
  })

  it("copes with a differing entry that has no notation, exponent or fit", () => {
    const [finding] = complexityFindings(
      withComplexity({ "fn:a": { agreement: "differs", expected: "linear", class: "constant" } }),
    )
    expect(finding?.message).toContain(
      "documented linear, measured constant (exponent n/a, R² n/a)",
    )
  })

  it("has nothing to say about a run with no analysis", () => {
    expect(complexityFindings(undefined)).toEqual([])
    expect(complexityFindings({})).toEqual([])
  })
})

describe("overheadFindings()", () => {
  const gates = resolveGates(undefined)
  const against = (results: object | null, name = "last run on main") => [{ name, results }]

  it("passes when the same-run ratio is unchanged or improved, however much slower the machine is", () => {
    // a machine twice as slow moves baseline and overhead together: the ratio holds
    expect(
      overheadFindings(
        run({ baselineMs: 4, overheadPercent: 100 }),
        against(run({ baselineMs: 2, overheadPercent: 100 })),
        gates,
      ),
    ).toEqual([])
    expect(
      overheadFindings(run({ overheadPercent: 60 }), against(run({ overheadPercent: 100 })), gates),
    ).toEqual([])
  })

  it("fails a millisecond-scale regression over 50%, and not one under it", () => {
    expect(
      overheadFindings(
        run({ overheadPercent: 140 }),
        against(run({ overheadPercent: 100 })),
        gates,
      ),
    ).toEqual([])
    const [finding] = overheadFindings(
      run({ overheadPercent: 160 }),
      against(run({ overheadPercent: 100 })),
      gates,
    )
    expect(finding).toMatchObject({ level: "fail", kind: "normalized-overhead" })
    expect(finding?.message).toContain(
      "grew from 100.0% (last run on main) to 160.0% -- up 60%, over the 50% allowed",
    )
    expect(finding?.message).toContain("not a slower machine")
  })

  it("allows microsecond-scale work 70%, because it swings 30-40% with no change at all", () => {
    const micro = (percent: number) => run({ baselineMs: 0.05, overheadPercent: percent })
    expect(overheadFindings(micro(165), against(micro(100)), gates)).toEqual([])
    expect(overheadFindings(micro(175), against(micro(100)), gates)).toHaveLength(1)
  })

  it("compares with every reference, so a creep past the last release is caught even when the last run is close", () => {
    const findings = overheadFindings(
      run({ overheadPercent: 160 }),
      [
        { name: "last run on main", results: run({ overheadPercent: 150 }) },
        { name: "last release", results: run({ overheadPercent: 100 }) },
      ],
      gates,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain("(last release)")
  })

  it("is silent without a usable reference, or when either side is within timer noise or has no ratio", () => {
    expect(overheadFindings(run({ overheadPercent: 999 }), against(null), gates)).toEqual([])
    expect(overheadFindings(run({ overheadPercent: 999 }), against({}), gates)).toEqual([])
    expect(
      overheadFindings(run({ overheadPercent: 999 }), against(run({ overheadPercent: 0 })), gates),
    ).toEqual([])
    expect(
      overheadFindings(
        run({ overheadPercent: 999 }),
        against(run({ overheadPercent: null })),
        gates,
      ),
    ).toEqual([])
    expect(
      overheadFindings(run({ baselineMs: 0.001, overheadPercent: 999 }), against(run()), gates),
    ).toEqual([])
    expect(
      overheadFindings(run({ overheadPercent: 999 }), against(run({ baselineMs: 0.001 })), gates),
    ).toEqual([])
    expect(overheadFindings(run({ overheadPercent: null }), against(run()), gates)).toEqual([])
    expect(overheadFindings(undefined, against(run()), gates)).toEqual([])
  })
})

describe("environmentNotes()", () => {
  it("notes a different Node major and a different CPU, as information", () => {
    const notes = environmentNotes(
      run({ node: "v22.5.0", cpu: "EPYC 9V45" }),
      run({ node: "v24.1.0", cpu: "EPYC 7763" }),
    )
    expect(notes.map((n) => n.level)).toEqual(["note", "note"])
    expect(notes[0]?.message).toContain("Node v22.5.0 and this one Node v24.1.0")
    expect(notes[1]?.message).toContain("EPYC 9V45 and this one on EPYC 7763")
  })

  it("says nothing for the same environment, the same major, or a run with no recorded environment", () => {
    expect(environmentNotes(run(), run())).toEqual([])
    expect(environmentNotes(run({ node: "v24.1.0" }), run({ node: "24.9.9" }))).toEqual([])
    expect(environmentNotes(null, run())).toEqual([])
    expect(environmentNotes({ metadata: { environment: {} } }, run())).toEqual([])
  })
})

describe("evaluateGates()", () => {
  it("combines the complexity, overhead and environment findings, honouring a package's overrides", () => {
    const current = {
      ...run({ overheadPercent: 300, node: "v24.0.0" }),
      analysis: {
        ...run({ overheadPercent: 300 }).analysis,
        complexity: { "fn:a": { agreement: "differs", expected: "linear", class: "constant" } },
      },
    }
    const findings = evaluateGates({
      previous: run({ overheadPercent: 100, node: "v22.0.0" }),
      release: run({ overheadPercent: 100 }),
      current,
    })
    expect(findings.map((f) => f.kind)).toEqual([
      "complexity",
      "normalized-overhead",
      "normalized-overhead",
      "environment",
    ])
    const relaxed = evaluateGates({
      previous: run({ overheadPercent: 100 }),
      current,
      gates: { complexity: false, normalizedOverheadMaxIncreasePercent: { millisecondScale: 500 } },
    })
    expect(relaxed).toEqual([])
  })
})
