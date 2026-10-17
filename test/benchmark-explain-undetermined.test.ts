import { describe, expect, it } from "vitest"
import { explainUndetermined } from "../scripts/benchmark/explain-undetermined.mjs"

describe("explainUndetermined", () => {
  it("says how many sizes were usable, in the variable's own words, and what was lost", () => {
    expect(
      explainUndetermined({
        reason: "insufficient-data",
        points: 1,
        variable: "file",
        unmeasured: [
          {
            tier: "n20",
            status: "failed",
            message: "boom\n    at run (/home/runner/work/pkg/suite.mjs:1:1)",
          },
          { tier: "n40", status: "skipped" },
        ],
        discarded: [{ tier: "n80", why: "its time was zero, below the timer's resolution" }],
      }),
    ).toBe(
      "only 1 file size gave a usable measurement and a growth rate needs at least 2; lost: n20 failed (boom); n40 skipped; n80 was unusable: its time was zero, below the timer's resolution",
    )
  })
  it("pluralizes and says nothing was lost when nothing was", () => {
    expect(explainUndetermined({ reason: "insufficient-data", points: 0 })).toBe(
      "only 0 sizes gave a usable measurement and a growth rate needs at least 2",
    )
    expect(explainUndetermined({ reason: "insufficient-data" })).toBe(
      "only 0 sizes gave a usable measurement and a growth rate needs at least 2",
    )
  })
  it("says every size is the same when there is nothing to fit a slope to", () => {
    expect(explainUndetermined({ reason: "no-size-variation", size: 10, variable: "width" })).toBe(
      "every usable measurement is at the same width size (10), so there is no growth to measure",
    )
    expect(explainUndetermined({ reason: "no-size-variation", size: 7 })).toBe(
      "every usable measurement is at the same size (7), so there is no growth to measure",
    )
  })
  it("gives the fit, the floor and the exponent for a poor fit", () => {
    expect(
      explainUndetermined({
        reason: "poor-fit",
        points: 5,
        rSquared: 0.4234,
        exponent: 1.5678,
        minRSquared: 0.8,
        variable: "item",
      }),
    ).toBe(
      "over the largest 5 item sizes the timings do not follow one growth rate (R² 0.42, and a fit below 0.8 is not trusted; fitted exponent 1.57). The cost probably changes regime between sizes (a cache, a threshold, a batch size) or run-to-run noise outweighs the growth",
    )
    expect(
      explainUndetermined({ reason: "poor-fit", points: 1, rSquared: null, exponent: null }),
    ).toBe(
      "over the largest 1 size the timings do not follow one growth rate (R² n/a, and a fit below 0.8 is not trusted; fitted exponent n/a). The cost probably changes regime between sizes (a cache, a threshold, a batch size) or run-to-run noise outweighs the growth",
    )
    expect(explainUndetermined({ reason: "poor-fit" })).toContain("over the largest 0 sizes")
  })
  it("says so when no reason was recorded", () => {
    const text =
      "the results record no reason (they were written before reasons were recorded); run the benchmark again to get one"
    expect(explainUndetermined({})).toBe(text)
    expect(explainUndetermined({ reason: "something-new" })).toBe(text)
  })
})
