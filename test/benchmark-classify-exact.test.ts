import { describe, expect, it } from "vitest"
import {
  FIT_WINDOW,
  buildSizeSeries,
  classifyGroup,
  detectComplexityShift,
  estimateGrowthExponent,
  fitGrowth,
  inputTotal,
  snapExponentToClass,
} from "../scripts/benchmark/classify-complexity.mjs"
import { estimateCost, formatUsd, validateTiers } from "../scripts/benchmark/kit/index.mjs"

const tier = (size: number, medianMs: number) => ({ medianMs, inputs: { items: size } })
const ladder = (f: (n: number) => number, sizes = [10, 20, 40, 80, 160]) =>
  Object.fromEntries(sizes.map((n) => [`n${String(n)}`, tier(n, f(n))]))

describe("inputTotal()", () => {
  it("sums the finite numbers, whatever the keys", () => {
    expect(inputTotal({ a: 1, b: 2.5 })).toBe(3.5)
    expect(inputTotal({ a: 4 })).toBe(4)
    expect(
      inputTotal({
        a: 1,
        b: "2",
        c: null,
        d: Number.NaN,
        e: Number.POSITIVE_INFINITY,
        f: {},
        g: true,
      }),
    ).toBe(1)
  })

  it("is undefined when there is nothing to sum", () => {
    for (const bad of [undefined, null, 0, "", 5, "text", [], {}, { a: "x" }, { a: Number.NaN }]) {
      expect(inputTotal(bad as never), String(bad)).toBeUndefined()
    }
  })
})

describe("buildSizeSeries()", () => {
  it("orders tiers by size and keeps only usable ones", () => {
    const series = buildSizeSeries({
      big: tier(100, 5),
      small: tier(10, 1),
      zeroSize: tier(0, 1),
      negativeSize: tier(-5, 1),
      noInputs: { medianMs: 1 },
      zeroTime: tier(20, 0),
      negativeTime: tier(20, -1),
      nanTime: tier(20, Number.NaN),
      infiniteTime: tier(20, Number.POSITIVE_INFINITY),
      textTime: { medianMs: "5" as unknown as number, inputs: { items: 20 } },
      noTime: { inputs: { items: 20 } },
      nothing: undefined,
      nullish: null as never,
      mid: tier(50, 2),
    })
    expect(series).toEqual([
      { tier: "small", size: 10, medianMs: 1 },
      { tier: "mid", size: 50, medianMs: 2 },
      { tier: "big", size: 100, medianMs: 5 },
    ])
  })

  it("is empty for nothing", () => {
    expect(buildSizeSeries(undefined as never)).toEqual([])
    expect(buildSizeSeries({})).toEqual([])
  })
})

describe("estimateGrowthExponent()", () => {
  it("is the least-squares slope of log time against log size", () => {
    const points = (f: (n: number) => number) =>
      [10, 20, 40].map((size) => ({ size, medianMs: f(size) }))
    expect(estimateGrowthExponent(points((n) => n * 2))).toBeCloseTo(1, 12)
    expect(estimateGrowthExponent(points((n) => n * n))).toBeCloseTo(2, 12)
    expect(estimateGrowthExponent(points(() => 7))).toBeCloseTo(0, 12)
    expect(
      estimateGrowthExponent([
        { size: 10, medianMs: 1 },
        { size: 100, medianMs: 10 },
      ]),
    ).toBeCloseTo(1, 12)
  })

  it("is null when there is no slope to fit", () => {
    expect(estimateGrowthExponent(undefined as never)).toBeNull()
    expect(estimateGrowthExponent(null as never)).toBeNull()
    expect(estimateGrowthExponent("ab" as never)).toBeNull()
    expect(estimateGrowthExponent([])).toBeNull()
    expect(estimateGrowthExponent([{ size: 10, medianMs: 1 }])).toBeNull()
    expect(
      estimateGrowthExponent([
        { size: 10, medianMs: 1 },
        { size: 10, medianMs: 5 },
      ]),
    ).toBeNull()
  })
})

describe("fitGrowth()", () => {
  const series = (f: (n: number) => number, sizes: number[]) =>
    sizes.map((size) => ({ size, medianMs: f(size) }))

  it("fits the largest FIT_WINDOW sizes of a long ladder, and all of a short one", () => {
    expect(FIT_WINDOW).toBe(5)
    // Fixed overhead dominates the small end; only the large end is linear.
    const long = series((n) => (n < 100 ? 100 : n), [1, 2, 4, 8, 16, 32, 64, 128, 256, 512])
    const fit = fitGrowth(long)
    expect(fit?.points).toBe(5)
    expect(fit?.exponent).toBeGreaterThan(0.5)
    const exactlyWindow = fitGrowth(series((n) => n, [1, 2, 3, 4, 5]))
    expect(exactlyWindow?.points).toBe(5)
    expect(fitGrowth(series((n) => n, [1, 2, 3, 4, 5, 6]))?.points).toBe(5)
    expect(fitGrowth(series((n) => n, [1, 2, 3]))?.points).toBe(3)
    expect(fitGrowth(series((n) => n, [1, 2]))?.points).toBe(2)
  })

  it("says how well a power law fits", () => {
    const perfect = fitGrowth(series((n) => n ** 2, [10, 20, 40, 80]))
    expect(perfect?.rSquared).toBeCloseTo(1, 12)
    expect(perfect?.exponent).toBeCloseTo(2, 12)
    const bumpy = fitGrowth([
      { size: 10, medianMs: 10 },
      { size: 20, medianMs: 1 },
      { size: 40, medianMs: 10 },
      { size: 80, medianMs: 1 },
    ])
    expect(bumpy?.rSquared).toBeLessThan(0.5)
    expect(fitGrowth(series(() => 5, [10, 20, 40]))?.rSquared).toBe(1)
  })

  it("calls a group flat only when its slowest tier is under 1.5 times its fastest", () => {
    const withRatio = (ratio: number) =>
      fitGrowth([
        { size: 10, medianMs: 1 },
        { size: 20, medianMs: ratio },
        { size: 40, medianMs: 1 },
      ])
    expect(withRatio(1.4)?.flat).toBe(true)
    expect(withRatio(1.5)?.flat).toBe(false)
    expect(withRatio(1.6)?.flat).toBe(false)
    expect(withRatio(1)?.flat).toBe(true)
  })

  it("is null when no slope exists", () => {
    expect(fitGrowth([{ size: 10, medianMs: 1 }])).toBeNull()
    expect(fitGrowth([])).toBeNull()
  })
})

describe("snapExponentToClass()", () => {
  it("picks the nearest anchor", () => {
    const expected: [number, string][] = [
      [-1, "constant"],
      [0, "constant"],
      [0.1, "constant"],
      [0.3, "logarithmic"],
      [0.5, "logarithmic"],
      [1, "linear"],
      [1.1, "linearithmic"],
      [1.2, "linearithmic"],
      [1.5, "linearithmic"],
      [1.7, "quadratic"],
      [2, "quadratic"],
      [2.4, "quadratic"],
      [2.6, "cubic-or-worse"],
      [3, "cubic-or-worse"],
      [10, "cubic-or-worse"],
    ]
    for (const [exponent, expectedClass] of expected)
      expect(snapExponentToClass(exponent), String(exponent)).toBe(expectedClass)
  })

  it("breaks an exact tie towards the cheaper class", () => {
    expect(snapExponentToClass(0.15)).toBe("constant")
    expect(snapExponentToClass(2.5)).toBe("quadratic")
  })
})

describe("classifyGroup()", () => {
  it("classifies a clean ladder with its fit", () => {
    expect(classifyGroup(ladder((n) => n * 0.1))).toMatchObject({
      complexityClass: "linear",
      points: 5,
      rSquared: 1,
    })
    expect(classifyGroup(ladder((n) => n * n * 0.01))).toMatchObject({
      complexityClass: "quadratic",
    })
    expect(classifyGroup(ladder(() => 5))).toMatchObject({
      complexityClass: "constant",
      exponent: 0,
      rSquared: 1,
    })
  })

  it("explains why it could not classify", () => {
    expect(classifyGroup({})).toEqual({
      complexityClass: null,
      exponent: null,
      points: 0,
      reason: "insufficient-data",
    })
    expect(classifyGroup({ a: tier(10, 1) })).toEqual({
      complexityClass: null,
      exponent: null,
      points: 1,
      reason: "insufficient-data",
    })
    expect(
      classifyGroup({
        a: { medianMs: 1, inputs: { items: 10 } },
        b: { medianMs: 2, inputs: { other: 10 } },
      }),
    ).toEqual({
      complexityClass: null,
      exponent: null,
      points: 2,
      reason: "no-size-variation",
    })
  })

  it("gives no class to a group that moves but not along a power law", () => {
    const stepped = classifyGroup({
      a: tier(10, 1),
      b: tier(20, 1),
      c: tier(40, 1),
      d: tier(80, 100),
      e: tier(160, 100),
    })
    expect(stepped.complexityClass).toBeNull()
    expect(stepped.reason).toBe("poor-fit")
    expect(stepped.rSquared).toBeLessThan(0.8)
    expect(typeof stepped.exponent).toBe("number")
  })

  it("still classifies a nearly flat group that fits badly", () => {
    const wobble = classifyGroup({
      a: tier(10, 1),
      b: tier(20, 1.2),
      c: tier(40, 1),
      d: tier(80, 1.2),
      e: tier(160, 1),
    })
    expect(wobble.complexityClass).not.toBeNull()
    expect(wobble.reason).toBeUndefined()
  })
})

describe("detectComplexityShift()", () => {
  const linear = ladder((n) => n * 0.1)
  const quadratic = ladder((n) => n * n * 0.01)
  const constant = ladder(() => 5)

  it("flags a change of class when both sides classified", () => {
    expect(detectComplexityShift(linear, quadratic)).toMatchObject({
      shifted: true,
      previousClass: "linear",
      currentClass: "quadratic",
    })
    expect(detectComplexityShift(linear, linear)).toMatchObject({
      shifted: false,
      previousClass: "linear",
      currentClass: "linear",
    })
    expect(detectComplexityShift(constant, linear).shifted).toBe(true)
  })

  it("never flags a shift when either side could not be classified", () => {
    const unclassified = { a: tier(10, 1) }
    expect(detectComplexityShift(linear, unclassified)).toMatchObject({
      shifted: false,
      previousClass: "linear",
      currentClass: null,
    })
    expect(detectComplexityShift(unclassified, linear)).toMatchObject({
      shifted: false,
      previousClass: null,
      currentClass: "linear",
    })
    expect(detectComplexityShift(unclassified, unclassified).shifted).toBe(false)
    expect(detectComplexityShift(undefined as never, linear)).toMatchObject({
      shifted: false,
      previousClass: null,
    })
    expect(detectComplexityShift(linear, undefined as never)).toMatchObject({
      shifted: false,
      currentClass: null,
    })
  })

  it("reports both exponents", () => {
    const shift = detectComplexityShift(linear, quadratic)
    expect(shift.previousExponent).toBeCloseTo(1, 9)
    expect(shift.currentExponent).toBeCloseTo(2, 9)
  })
})

describe("estimateCost()", () => {
  it("derives a cost bracket and throughput from one operation's times", () => {
    const cost = estimateCost({ wallMs: 2, cpuMs: 1, heapBytes: 0 })
    expect(cost.opsPerSecondPerCore).toBe(500)
    expect(cost.lowUsdPerMillion).toBeCloseTo(0.011244444, 8)
    expect(cost.highUsdPerMillion).toBeCloseTo(0.004166675, 9)
  })

  it("has unbounded throughput for no time at all, or a nonsensical negative one", () => {
    expect(estimateCost({ wallMs: 0, cpuMs: 0 }).opsPerSecondPerCore).toBe(Number.POSITIVE_INFINITY)
    expect(estimateCost({ wallMs: -5, cpuMs: 0 }).opsPerSecondPerCore).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(estimateCost({ wallMs: 0.5, cpuMs: 0 }).opsPerSecondPerCore).toBe(2000)
  })
})

describe("formatUsd()", () => {
  it("formats zero, and small, medium and large amounts", () => {
    expect(formatUsd(0)).toBe("$0")
    expect(formatUsd(Number.NaN)).toBe("n/a")
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("n/a")
    expect(formatUsd(12.345)).toBe("$12.35")
    expect(formatUsd(1)).toBe("$1.00")
    expect(formatUsd(0.5)).toBe("$0.500")
    expect(formatUsd(0.01)).toBe("$0.010")
    expect(formatUsd(0.0123)).toBe("$0.012")
    expect(formatUsd(0.0000045)).toBe("$0.0000045")
  })
})

describe("validateTiers()", () => {
  it("accepts four or more distinct positive integers, ascending", () => {
    expect(validateTiers([1, 2, 3, 4])).toEqual([])
    expect(validateTiers([10, 20, 40, 80, 160])).toEqual([])
  })

  it("asks for at least four", () => {
    const fewer = "tiers must list at least 4 sizes, or the growth rate (big-O) cannot be estimated"
    expect(validateTiers([1, 2, 3])).toEqual([fewer])
    expect(validateTiers([])).toEqual([fewer])
    expect(validateTiers(undefined as never)).toEqual([fewer])
    expect(validateTiers("1234" as never)).toEqual([fewer])
  })

  it("asks for positive integers, strictly ascending", () => {
    expect(validateTiers([1, 2, 3, 0])).toEqual([
      "tiers must all be positive integers",
      "tiers must be strictly ascending",
    ])
    expect(validateTiers([1, 2, 3.5, 4])).toEqual(["tiers must all be positive integers"])
    expect(validateTiers([-1, 2, 3, 4])).toEqual(["tiers must all be positive integers"])
    expect(validateTiers([1, 2, 2, 4])).toEqual(["tiers must be strictly ascending"])
    expect(validateTiers([1, 3, 2, 4])).toEqual(["tiers must be strictly ascending"])
    expect(validateTiers([4, 3, 2, 1])).toEqual(["tiers must be strictly ascending"])
    expect(validateTiers([1, 2, 3, 3])).toEqual(["tiers must be strictly ascending"])
  })
})
