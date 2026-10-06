import { describe, expect, it } from "vitest"
import {
  buildSizeSeries,
  classifyGroup,
  detectComplexityShift,
  estimateGrowthExponent,
  FIT_WINDOW,
  fitGrowth,
  MIN_R_SQUARED,
  inputTotal,
  snapExponentToClass,
  type TierMeasurements,
} from "../scripts/benchmark/classify-complexity.mjs"

describe("inputTotal", () => {
  it("sums every finite numeric value in an inputs object, regardless of key names", () => {
    expect(inputTotal({ contracts: 10, variables: 100 })).toBe(110)
    expect(inputTotal({ itemCount: 2000 })).toBe(2000)
    expect(inputTotal({ files: 10, parseWarnings: 2, extra: 5 })).toBe(17)
  })

  it("ignores non-numeric and non-finite values", () => {
    expect(inputTotal({ a: 1, b: "not a number", c: 2 })).toBe(3)
    expect(inputTotal({ a: Number.NaN, b: 5 })).toBe(5)
    expect(inputTotal({ a: Number.POSITIVE_INFINITY, b: 5 })).toBe(5)
  })

  it("returns undefined for a missing/non-object inputs, or one with no usable numeric values", () => {
    expect(inputTotal(undefined)).toBeUndefined()
    expect(inputTotal(null)).toBeUndefined()
    expect(inputTotal({})).toBeUndefined()
    expect(inputTotal({ a: "x" })).toBeUndefined()
  })
})

describe("buildSizeSeries", () => {
  it("sorts tiers by size ascending, independent of insertion/tier-name order", () => {
    const series = buildSizeSeries({
      extreme: { medianMs: 30, inputs: { n: 800 } },
      baseline: { medianMs: 10, inputs: { n: 10 } },
      stress: { medianMs: 20, inputs: { n: 100 } },
    })
    expect(series.map((p) => p.tier)).toEqual(["baseline", "stress", "extreme"])
    expect(series.map((p) => p.size)).toEqual([10, 100, 800])
  })

  it("excludes a tier missing inputs entirely, without crashing", () => {
    const series = buildSizeSeries({
      baseline: { medianMs: 10, inputs: { n: 10 } },
      stress: { medianMs: 20 }, // no inputs at all
      extreme: { medianMs: 30, inputs: { n: 800 } },
    } as TierMeasurements)
    expect(series.map((p) => p.tier)).toEqual(["baseline", "extreme"])
  })

  it("excludes a tier with a zero/negative medianMs (can't take its log)", () => {
    const series = buildSizeSeries({
      baseline: { medianMs: 0, inputs: { n: 10 } },
      stress: { medianMs: 20, inputs: { n: 100 } },
    })
    expect(series.map((p) => p.tier)).toEqual(["stress"])
  })

  it("excludes a tier whose inputs sum to zero or a non-finite value", () => {
    const series = buildSizeSeries({
      zeroed: { medianMs: 10, inputs: { n: 0 } },
      real: { medianMs: 20, inputs: { n: 100 } },
    })
    expect(series.map((p) => p.tier)).toEqual(["real"])
  })
})

describe("estimateGrowthExponent + snapExponentToClass (ground-truth synthetic series)", () => {
  it("doubling medianMs when input size doubles is linear (exponent exactly 1)", () => {
    const series = [
      { size: 100, medianMs: 1 },
      { size: 200, medianMs: 2 },
    ]
    const exponent = estimateGrowthExponent(series)
    expect(exponent).toBeCloseTo(1, 10)
    expect(snapExponentToClass(exponent!)).toBe("linear")
  })

  it("quadrupling medianMs when input size doubles is quadratic (exponent exactly 2)", () => {
    const series = [
      { size: 100, medianMs: 1 },
      { size: 200, medianMs: 4 },
    ]
    const exponent = estimateGrowthExponent(series)
    expect(exponent).toBeCloseTo(2, 10)
    expect(snapExponentToClass(exponent!)).toBe("quadratic")
  })

  it("flat medianMs across growing size is constant (exponent exactly 0)", () => {
    const series = [
      { size: 100, medianMs: 5 },
      { size: 200, medianMs: 5 },
      { size: 400, medianMs: 5 },
    ]
    const exponent = estimateGrowthExponent(series)
    expect(exponent).toBeCloseTo(0, 10)
    expect(snapExponentToClass(exponent!)).toBe("constant")
  })

  it("a realistic O(log n) series (medianMs = ln(size) across a 10/100/1000 ladder) classifies as logarithmic", () => {
    // Ground truth: medianMs is *defined* as ln(size), independent of the
    // classifier under test. Regression slope computed independently
    // (see the PR description) is ~0.2386, closer to the logarithmic
    // anchor (0.3, distance 0.061) than the constant anchor (0, distance
    // 0.239) -- see the module's own documented "constant vs logarithmic
    // is the weakest distinction" limitation for why the margin here is
    // real but not huge.
    const sizes = [10, 100, 1000]
    const series = sizes.map((size) => ({ size, medianMs: Math.log(size) }))
    const exponent = estimateGrowthExponent(series)
    expect(exponent).toBeCloseTo(0.2385606273598312, 10)
    expect(snapExponentToClass(exponent!)).toBe("logarithmic")
  })

  it("a realistic O(n log n) series (medianMs = size * ln(size)) classifies as linearithmic", () => {
    const sizes = [10, 100, 1000]
    const series = sizes.map((size) => ({ size, medianMs: size * Math.log(size) }))
    const exponent = estimateGrowthExponent(series)
    expect(exponent).toBeCloseTo(1.238560627359831, 10)
    expect(snapExponentToClass(exponent!)).toBe("linearithmic")
  })

  it("a series far worse than quadratic (medianMs = size^4) classifies as cubic-or-worse", () => {
    const series = [
      { size: 100, medianMs: 1 },
      { size: 200, medianMs: 16 }, // 2^4
    ]
    const exponent = estimateGrowthExponent(series)
    expect(exponent).toBeCloseTo(4, 10)
    expect(snapExponentToClass(exponent!)).toBe("cubic-or-worse")
  })

  it("returns null for fewer than 2 points", () => {
    expect(estimateGrowthExponent([])).toBeNull()
    expect(estimateGrowthExponent([{ size: 100, medianMs: 1 }])).toBeNull()
  })

  it("returns null when every point shares the same size (no size variation to fit a slope against)", () => {
    const series = [
      { size: 100, medianMs: 1 },
      { size: 100, medianMs: 5 },
      { size: 100, medianMs: 9 },
    ]
    expect(estimateGrowthExponent(series)).toBeNull()
  })
})

describe("snapExponentToClass tie-breaking", () => {
  it("an exact midpoint between constant(0) and logarithmic(0.3) -- 0.15 -- breaks toward the lower/simpler class (constant)", () => {
    expect(snapExponentToClass(0.15)).toBe("constant")
  })

  it("an exact midpoint between quadratic(2) and cubic-or-worse(3) -- 2.5 -- breaks toward the lower/simpler class (quadratic)", () => {
    expect(snapExponentToClass(2.5)).toBe("quadratic")
  })

  it("a near-tie just above the midpoint snaps to the higher class", () => {
    expect(snapExponentToClass(2.50001)).toBe("cubic-or-worse")
  })

  it("a near-tie just below the midpoint snaps to the lower class", () => {
    expect(snapExponentToClass(2.49999)).toBe("quadratic")
  })
})

describe("classifyGroup", () => {
  it("classifies a full, well-formed tier ladder end to end", () => {
    const result = classifyGroup({
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 2, inputs: { n: 200 } },
    })
    expect(result.complexityClass).toBe("linear")
    expect(result.points).toBe(2)
    expect(result.reason).toBeUndefined()
  })

  it("reports insufficient-data with fewer than 2 usable tiers (one tier missing inputs)", () => {
    const result = classifyGroup({
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 2 }, // excluded: no inputs
    } as TierMeasurements)
    expect(result.complexityClass).toBeNull()
    expect(result.points).toBe(1)
    expect(result.reason).toBe("insufficient-data")
  })

  it("reports insufficient-data for an empty tiers object", () => {
    const result = classifyGroup({})
    expect(result.complexityClass).toBeNull()
    expect(result.reason).toBe("insufficient-data")
  })

  it("reports no-size-variation when 2+ tiers all resolve to the same total input size", () => {
    const result = classifyGroup({
      a: { medianMs: 1, inputs: { x: 5, y: 5 } },
      b: { medianMs: 9, inputs: { x: 10 } }, // same total (10) as a's (5+5)
    })
    expect(result.complexityClass).toBeNull()
    expect(result.points).toBe(2)
    expect(result.reason).toBe("no-size-variation")
  })
})

describe("detectComplexityShift", () => {
  it("flags a shift when the previous and current classifications disagree", () => {
    const previous = {
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 2, inputs: { n: 200 } }, // linear
    }
    const current = {
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 4, inputs: { n: 200 } }, // quadratic
    }
    const shift = detectComplexityShift(previous, current)
    expect(shift.shifted).toBe(true)
    expect(shift.previousClass).toBe("linear")
    expect(shift.currentClass).toBe("quadratic")
  })

  it("does not flag a shift when both classifications agree", () => {
    const tiers = {
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 2, inputs: { n: 200 } },
    }
    const shift = detectComplexityShift(tiers, tiers)
    expect(shift.shifted).toBe(false)
    expect(shift.previousClass).toBe("linear")
    expect(shift.currentClass).toBe("linear")
  })

  it("never flags a shift when either side can't be classified (e.g. previous is pre-schema-v2 history with no inputs at all)", () => {
    const previousV1Shaped = {
      baseline: { medianMs: 1 }, // no `inputs` -- a real pre-v2 history entry shape
      stress: { medianMs: 2 },
    } as TierMeasurements
    const current = {
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 4, inputs: { n: 200 } },
    }
    const shift = detectComplexityShift(previousV1Shaped, current)
    expect(shift.shifted).toBe(false)
    expect(shift.previousClass).toBeNull()
    expect(shift.currentClass).toBe("quadratic")
  })

  it("handles an entirely missing previous group (first time this group appears)", () => {
    const shift = detectComplexityShift(undefined, {
      baseline: { medianMs: 1, inputs: { n: 100 } },
      stress: { medianMs: 2, inputs: { n: 200 } },
    })
    expect(shift.shifted).toBe(false)
    expect(shift.previousClass).toBeNull()
    expect(shift.currentClass).toBe("linear")
  })
})

describe("fitGrowth() and the asymptotic fit", () => {
  const ladder = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240]
  const tiers = (cost: (n: number) => number): TierMeasurements =>
    Object.fromEntries(ladder.map((n) => [`n${String(n)}`, { medianMs: cost(n), inputs: { n } }]))

  it("fits only the largest sizes once the ladder is longer than the window", () => {
    expect(FIT_WINDOW).toBe(5)
    const series = ladder.map((size) => ({ size, medianMs: size }))
    expect(fitGrowth(series)?.points).toBe(FIT_WINDOW)
    expect(fitGrowth(series.slice(0, 4))?.points).toBe(4)
  })

  it("reports a function that is linear for large inputs as linear despite a large fixed per-call cost", () => {
    // 0.5 ms of fixed overhead plus 0.001 ms per item: a single power law across all ten sizes reads this
    // as sub-linear ("logarithmic") because the overhead dominates the small end.
    const cost = (n: number) => 0.5 + 0.001 * n
    const wholeLadder = estimateGrowthExponent(
      ladder.map((size) => ({ size, medianMs: cost(size) })),
    )
    expect(wholeLadder).toBeLessThan(0.7)
    expect(classifyGroup(tiers(cost)).complexityClass).toBe("linear")
  })

  it("classifies quadratic and constant series correctly, with their fit quality", () => {
    const quadratic = classifyGroup(tiers((n) => (n * n) / 1e6))
    expect(quadratic.complexityClass).toBe("quadratic")
    expect(quadratic.rSquared).toBeCloseTo(1, 6)
    const constant = classifyGroup(tiers(() => 0.05))
    expect(constant.complexityClass).toBe("constant")
  })

  it("treats noise around a flat line as flat (constant), whatever its R-squared", () => {
    const noisy = classifyGroup(tiers((n) => 0.05 * (1 + 0.2 * Math.sin(n))))
    expect(noisy.complexityClass).toBe("constant")
  })

  it("gives no class, saying why, when the cost moves but not along a power law", () => {
    // A cliff: flat, then 50x at the largest size (a cache or GC cliff), not a growth rate.
    const cliff = classifyGroup(tiers((n) => (n < 5000 ? 1 : n < 10000 ? 1.05 : 50)))
    expect(MIN_R_SQUARED).toBe(0.8)
    expect(cliff.complexityClass).toBeNull()
    expect(cliff).toMatchObject({ reason: "poor-fit" })
    expect(cliff.rSquared).toBeLessThan(MIN_R_SQUARED)
  })

  it("fitGrowth is null with no size variation, and R-squared is 1 for a perfectly flat series", () => {
    expect(fitGrowth([{ size: 10, medianMs: 1 }])).toBeNull()
    expect(
      fitGrowth([
        { size: 10, medianMs: 1 },
        { size: 10, medianMs: 2 },
      ]),
    ).toBeNull()
    expect(
      fitGrowth([
        { size: 10, medianMs: 2 },
        { size: 20, medianMs: 2 },
      ]),
    ).toMatchObject({
      rSquared: 1,
      flat: true,
    })
  })
})
