import { describe, expect, it } from "vitest"
import { RESULTS_SCHEMA_VERSION, validateResults } from "../scripts/benchmark/kit/index.mjs"

const stats = (extra: Record<string, unknown> = {}) => ({
  minMs: 1,
  medianMs: 2,
  p95Ms: 3,
  maxMs: 4,
  stdDevMs: 0.5,
  iterations: 5,
  warmupIterations: 2,
  ...extra,
})
const completed = (extra: Record<string, unknown> = {}) => ({
  id: "fn:sum",
  status: "completed",
  inputs: { items: 20 },
  durationMs: stats(),
  cpuMs: stats(),
  heapDeltaBytes: 10,
  ...extra,
})
type Loose = Record<string, unknown>

/** A valid results object, as plain data; each test breaks one piece. */
function results(overrides: { metadata?: Loose; groups?: Loose; analysis?: Loose } = {}): Loose {
  return {
    metadata: {
      schemaVersion: RESULTS_SCHEMA_VERSION,
      package: { name: "demo" },
      workload: { unit: "item" },
      tiers: [20],
      environment: {},
      git: {},
      bundleSizes: {},
      costRates: {},
      timing: {},
      ...overrides.metadata,
    },
    results: overrides.groups ?? { "fn:sum": { area: "function", tiers: { n20: completed() } } },
    analysis: { complexity: {}, endToEnd: [], contribution: [], cost: {}, ...overrides.analysis },
  }
}
const group = (tiers: Loose, area: unknown = "function") => ({ "fn:sum": { area, tiers } })
const at = 'results["fn:sum"].tiers.n20'

describe("validateResults() on the whole file", () => {
  it("accepts a valid file, and nothing that is not an object", () => {
    expect(validateResults(results())).toEqual([])
    for (const value of [null, undefined, 3, "x", [], [results()]]) {
      expect(validateResults(value), String(value)).toEqual(["results must be an object."])
    }
  })

  it("reports each missing top-level section", () => {
    expect(validateResults({})).toEqual([
      "metadata must be an object.",
      "results must map each group to its tiers.",
      "analysis must be an object.",
    ])
    for (const value of [null, [], "x", 1]) {
      expect(validateResults({ metadata: value, results: value, analysis: value })).toEqual([
        "metadata must be an object.",
        "results must map each group to its tiers.",
        "analysis must be an object.",
      ])
    }
  })
})

describe("metadata", () => {
  const metadataProblems = (metadata: Loose) => validateResults(results({ metadata }))

  it("needs the current schema version", () => {
    expect(metadataProblems({ schemaVersion: RESULTS_SCHEMA_VERSION - 1 })).toEqual([
      `metadata.schemaVersion must be ${String(RESULTS_SCHEMA_VERSION)}.`,
    ])
    expect(metadataProblems({ schemaVersion: undefined })).toHaveLength(1)
  })

  it("needs a package name and a workload unit that are strings", () => {
    for (const bad of [undefined, null, 3, {}]) {
      expect(metadataProblems({ package: { name: bad } }), String(bad)).toEqual([
        "metadata.package.name must be a string.",
      ])
      expect(metadataProblems({ workload: { unit: bad } }), String(bad)).toEqual([
        "metadata.workload.unit must be a string.",
      ])
    }
    expect(metadataProblems({ package: undefined })).toEqual([
      "metadata.package.name must be a string.",
    ])
    expect(metadataProblems({ workload: null })).toEqual([
      "metadata.workload.unit must be a string.",
    ])
    expect(metadataProblems({ package: { name: "" }, workload: { unit: "" } })).toEqual([])
  })

  it("needs a non-empty list of tiers", () => {
    const message = "metadata.tiers must list the measured sizes."
    for (const bad of [undefined, [], "20", { length: 1 }])
      expect(metadataProblems({ tiers: bad }), String(bad)).toEqual([message])
    expect(metadataProblems({ tiers: [1] })).toEqual([])
  })

  it("needs each descriptive section to be an object", () => {
    for (const key of ["environment", "git", "bundleSizes", "costRates", "timing"]) {
      for (const bad of [undefined, null, [], "x", 1]) {
        expect(metadataProblems({ [key]: bad }), `${key} ${String(bad)}`).toEqual([
          `metadata.${key} must be an object.`,
        ])
      }
    }
  })
})

describe("groups", () => {
  const groupProblems = (groups: Loose) => validateResults(results({ groups }))

  it("needs an area of end-to-end or function, and tiers that are an object", () => {
    const area = 'results["fn:sum"].area must be "end-to-end" or "function".'
    for (const bad of ["other", "", undefined, 3])
      expect(
        groupProblems({ "fn:sum": { area: bad, tiers: { n20: completed() } } }),
        String(bad),
      ).toEqual([area])
    expect(groupProblems(group({ n20: completed() }, "end-to-end"))).toEqual([])
    const tiers = 'results["fn:sum"].tiers must be an object.'
    for (const bad of [undefined, null, [], 3, "x"])
      expect(groupProblems(group(bad as never)), String(bad)).toEqual([tiers])
    expect(groupProblems({ "fn:sum": null })).toEqual([area, tiers])
    expect(groupProblems({ "fn:sum": undefined })).toEqual([area, tiers])
  })

  it("names every group it reports", () => {
    expect(groupProblems({ a: { area: "x", tiers: {} }, b: { area: "y", tiers: {} } })).toEqual([
      'results["a"].area must be "end-to-end" or "function".',
      'results["b"].area must be "end-to-end" or "function".',
    ])
  })
})

describe("tiers", () => {
  const tierProblems = (tiers: Loose) => validateResults(results({ groups: group(tiers) }))

  it("are named n followed by digits, nothing more", () => {
    for (const ok of ["n1", "n640", "n0"])
      expect(tierProblems({ [ok]: completed() }), ok).toEqual([])
    for (const bad of ["xn640", "n640x", "640", "n", "n6.4", "N640", "n-1", " n640", "n640 "]) {
      expect(tierProblems({ [bad]: completed() }), bad).toEqual([
        `results["fn:sum"].tiers.${bad}: tier names look like "n640".`,
      ])
    }
  })

  it("need an id string and an inputs object, and survive a null entry", () => {
    expect(tierProblems({ n20: completed({ id: 5 }) })).toEqual([`${at}.id must be a string.`])
    expect(tierProblems({ n20: completed({ id: undefined }) })).toEqual([
      `${at}.id must be a string.`,
    ])
    for (const bad of [undefined, null, [], "x"])
      expect(tierProblems({ n20: completed({ inputs: bad }) }), String(bad)).toEqual([
        `${at}.inputs must be an object.`,
      ])
    expect(tierProblems({ n20: null })).toEqual([
      `${at}.id must be a string.`,
      `${at}.inputs must be an object.`,
      `${at}.status must be "completed" or "failed".`,
    ])
    expect(tierProblems({ n20: undefined })).toHaveLength(3)
  })

  it("need a status of completed or failed", () => {
    for (const status of ["weird", "", undefined, null, 1]) {
      expect(tierProblems({ n20: completed({ status }) }), String(status)).toEqual([
        `${at}.status must be "completed" or "failed".`,
      ])
    }
  })
})

describe("a completed tier", () => {
  const completedProblems = (extra: Loose) =>
    validateResults(results({ groups: group({ n20: completed(extra) }) }))
  const keys = ["minMs", "medianMs", "p95Ms", "maxMs", "stdDevMs", "iterations", "warmupIterations"]

  it("needs finite numbers for every duration and CPU statistic", () => {
    for (const key of keys) {
      for (const bad of [
        "1",
        undefined,
        null,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        expect(
          completedProblems({ durationMs: stats({ [key]: bad }) }),
          `${key} ${String(bad)}`,
        ).toEqual([`${at}.durationMs.${key} must be a finite number.`])
        expect(completedProblems({ cpuMs: stats({ [key]: bad }) })).toEqual([
          `${at}.cpuMs.${key} must be a finite number.`,
        ])
      }
    }
    expect(completedProblems({ durationMs: stats({ minMs: 0, medianMs: -1 }) })).toEqual([])
  })

  it("needs the statistics to be objects", () => {
    for (const bad of [undefined, null, [], "x", 3]) {
      expect(completedProblems({ durationMs: bad }), String(bad)).toEqual([
        `${at}.durationMs must be a duration-statistics object.`,
      ])
      expect(completedProblems({ cpuMs: bad })).toEqual([
        `${at}.cpuMs must be a duration-statistics object.`,
      ])
    }
  })

  it("needs a numeric heap delta", () => {
    for (const bad of ["1", undefined, null])
      expect(completedProblems({ heapDeltaBytes: bad }), String(bad)).toEqual([
        `${at}.heapDeltaBytes must be a number.`,
      ])
    expect(completedProblems({ heapDeltaBytes: -5 })).toEqual([])
  })

  it("is held to a lighter shape when it is derived, needing only a median", () => {
    const derived = { derived: true, cpuMs: undefined, heapDeltaBytes: undefined }
    expect(completedProblems({ ...derived, durationMs: { medianMs: 5 } })).toEqual([])
    for (const bad of [undefined, null, {}, { medianMs: "5" }]) {
      expect(completedProblems({ ...derived, durationMs: bad }), String(bad)).toEqual([
        `${at}.durationMs.medianMs must be a number.`,
      ])
    }
    expect(completedProblems({ derived: false, durationMs: { medianMs: 5 } })).not.toEqual([])
    expect(completedProblems({ derived: 0, cpuMs: undefined })).toContain(
      `${at}.cpuMs must be a duration-statistics object.`,
    )
  })
})

describe("a failed tier", () => {
  const failedProblems = (extra: Loose) =>
    validateResults(
      results({ groups: group({ n20: { id: "fn:sum", status: "failed", inputs: {}, ...extra } }) }),
    )

  it("needs the error's message", () => {
    expect(failedProblems({ error: { message: "boom" } })).toEqual([])
    for (const error of [undefined, null, {}, { message: 3 }, "boom"]) {
      expect(failedProblems({ error }), String(error)).toEqual([
        `${at}.error.message must be a string.`,
      ])
    }
  })
})

describe("analysis", () => {
  const analysisProblems = (analysis: Loose) => validateResults(results({ analysis }))

  it("needs complexity and cost as objects, and endToEnd and contribution as arrays", () => {
    const wanted: [string, string, unknown[]][] = [
      ["complexity", "an object", [undefined, null, [], "x"]],
      ["cost", "an object", [undefined, null, [], "x"]],
      ["endToEnd", "an array", [undefined, null, {}, "x"]],
      ["contribution", "an array", [undefined, null, {}, "x"]],
    ]
    for (const [key, kind, bads] of wanted) {
      for (const bad of bads)
        expect(analysisProblems({ [key]: bad }), `${key} ${String(bad)}`).toEqual([
          `analysis.${key} must be ${kind}.`,
        ])
    }
  })
})
