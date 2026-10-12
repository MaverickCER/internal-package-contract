import { describe, expect, it } from "vitest"
import { buildEntry } from "../scripts/benchmark/append-history.mjs"
import { dispersionOf, resultsToMeasurements } from "../scripts/benchmark/lib/results.mjs"

const tier = (durationMs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  status: "completed",
  durationMs,
  ...extra,
})
const results = (tiers: Record<string, unknown>, metadata?: unknown) => ({
  ...(metadata === undefined ? {} : { metadata }),
  results: { g: { tiers } },
})

describe("dispersionOf", () => {
  it("keeps the standard deviation, the 95th percentile and the iteration count when they are finite numbers", () => {
    expect(
      dispersionOf({ durationMs: { medianMs: 1, stdDevMs: 0.2, p95Ms: 1.5, iterations: 60 } }),
    ).toEqual({ stdDevMs: 0.2, p95Ms: 1.5, iterations: 60 })
  })
  it("keeps only what is present and finite, and nothing for a derived entry with just a median", () => {
    expect(dispersionOf({ durationMs: { medianMs: 1, stdDevMs: 0 } })).toEqual({ stdDevMs: 0 })
    expect(dispersionOf({ durationMs: { medianMs: 1 } })).toEqual({})
    expect(
      dispersionOf({
        durationMs: { medianMs: 1, stdDevMs: "x", p95Ms: Infinity, iterations: NaN },
      }),
    ).toEqual({})
    expect(dispersionOf(undefined)).toEqual({})
  })
  it("reads the same source as the median: totalMs when an entry has one", () => {
    expect(
      dispersionOf({
        totalMs: { medianMs: 9, stdDevMs: 3 },
        durationMs: { medianMs: 1, stdDevMs: 0.1 },
      }),
    ).toEqual({ stdDevMs: 3 })
  })
})

describe("resultsToMeasurements keeps dispersion", () => {
  it("carries it beside the median and inputs", () => {
    expect(
      resultsToMeasurements(
        results({
          a: tier({ medianMs: 2, stdDevMs: 0.5, p95Ms: 3, iterations: 10 }, { inputs: { n: 4 } }),
        }) as never,
      ),
    ).toEqual({
      g: { a: { medianMs: 2, inputs: { n: 4 }, stdDevMs: 0.5, p95Ms: 3, iterations: 10 } },
    })
  })
})

describe("buildEntry keeps dispersion and the processor", () => {
  const entryFor = (metadata: unknown) =>
    buildEntry(
      results(
        { a: tier({ medianMs: 2, stdDevMs: 0.5, p95Ms: 3, iterations: 10 }, { inputs: { n: 4 } }) },
        metadata,
      ) as never,
      { commit: "abc" },
    )
  it("records stdDevMs, p95Ms and iterations on each tier", () => {
    expect(
      (entryFor({}) as { measurements: Record<string, Record<string, unknown>> }).measurements[
        "g"
      ]?.["a"],
    ).toMatchObject({
      stdDevMs: 0.5,
      p95Ms: 3,
      iterations: 10,
    })
  })
  it("records the CPU model when the run reported one, and omits it otherwise", () => {
    expect(entryFor({ environment: { cpuModel: "EPYC 7763" } })).toMatchObject({
      cpuModel: "EPYC 7763",
    })
    expect(entryFor({ environment: { cpuModel: null } })).not.toHaveProperty("cpuModel")
    expect(entryFor({})).not.toHaveProperty("cpuModel")
  })
})
