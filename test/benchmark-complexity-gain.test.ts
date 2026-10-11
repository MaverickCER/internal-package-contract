import { describe, expect, it } from "vitest"
import {
  classRank,
  complexityGains,
  describeGain,
  gainExceptionId,
  judgeGains,
  missingFields,
  REGISTRY_RELATIVE_PATH,
  REQUIRED_FIELDS,
} from "../scripts/benchmark/complexity-gain.mjs"

const SIZES = [10, 100, 1000, 10000]

/** A results.json whose group scales as size^exponent across four tiers. */
function results(groups: Record<string, number>) {
  return {
    results: Object.fromEntries(
      Object.entries(groups).map(([name, exponent]) => [
        name,
        {
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
      ]),
    ),
  }
}

describe("classRank", () => {
  it("orders the classes from cheapest to worst and rejects anything else", () => {
    expect(classRank("constant")).toBe(0)
    expect(classRank("linear")).toBeLessThan(classRank("quadratic"))
    expect(classRank("cubic-or-worse")).toBe(5)
    expect(classRank("exponential")).toBe(-1)
    expect(classRank(null)).toBe(-1)
  })
})

describe("complexityGains", () => {
  it("reports a group whose class got worse, with both classes and exponents", () => {
    const gains = complexityGains("perf", results({ parse: 1 }), results({ parse: 2 }))
    expect(gains).toHaveLength(1)
    expect(gains[0]).toMatchObject({
      suite: "perf",
      group: "parse",
      previousClass: "linear",
      currentClass: "quadratic",
    })
    expect(gains[0]?.previousExponent).toBeCloseTo(1, 5)
    expect(gains[0]?.currentExponent).toBeCloseTo(2, 5)
  })
  it("never reports an improvement or an unchanged class", () => {
    expect(complexityGains("perf", results({ parse: 2 }), results({ parse: 1 }))).toEqual([])
    expect(complexityGains("perf", results({ parse: 1 }), results({ parse: 1 }))).toEqual([])
  })
  it("ignores a label change smaller than the shift margin", () => {
    expect(complexityGains("perf", results({ parse: 1 }), results({ parse: 1.2 }))).toEqual([])
  })
  it("has nothing to compare for a new group or a missing baseline", () => {
    expect(complexityGains("perf", results({ other: 1 }), results({ parse: 3 }))).toEqual([])
    expect(complexityGains("perf", null, results({ parse: 3 }))).toEqual([])
    expect(complexityGains("perf", undefined, results({ parse: 3 }))).toEqual([])
    expect(complexityGains("perf", {}, results({ parse: 3 }))).toEqual([])
    expect(complexityGains("perf", results({ parse: 1 }), null)).toEqual([])
  })
  it("never classifies a group that is computed from other groups", () => {
    const derived = "end-to-end:overhead"
    expect(complexityGains("perf", results({ [derived]: 1 }), results({ [derived]: 3 }))).toEqual(
      [],
    )
  })
  it("reports each worsened group and leaves the rest", () => {
    const gains = complexityGains(
      "perf",
      results({ a: 1, b: 1, c: 2 }),
      results({ a: 2, b: 1, c: 3 }),
    )
    expect(gains.map((gain) => gain.group)).toEqual(["a", "c"])
  })
})

const gain = {
  suite: "perf",
  group: "parse",
  previousClass: "linear",
  currentClass: "quadratic",
  previousExponent: 1,
  currentExponent: 2,
}
const FILLED = Object.fromEntries(REQUIRED_FIELDS.map((key) => [key, `${key} written`]))
const record = (extra: Record<string, unknown> = {}) => ({
  id: "benchmark-complexity:perf:parse:quadratic",
  version: 2,
  suite: "perf",
  group: "parse",
  to: "quadratic",
  ...FILLED,
  expires: "",
  ...extra,
})
const NOW = new Date("2026-10-11T12:00:00Z")

describe("gainExceptionId and describeGain", () => {
  it("names the id that accepts a group growing to a class", () => {
    expect(gainExceptionId("perf", "parse", "quadratic")).toBe(
      "benchmark-complexity:perf:parse:quadratic",
    )
    expect(REGISTRY_RELATIVE_PATH).toBe(".repo-contract/exceptions/benchmark-complexity.json")
  })
  it("describes what got worse in one line", () => {
    expect(describeGain(gain)).toBe("perf / parse: linear -> quadratic (exponent 1.00 -> 2.00)")
  })
})

describe("missingFields", () => {
  it("is empty for a complete record", () => {
    expect(missingFields(record(), NOW)).toEqual([])
  })
  it("names every required field that is absent, not a string, or blank", () => {
    expect(REQUIRED_FIELDS).toEqual([
      "justification",
      "ruleBroken",
      "attempted",
      "constraint",
      "whyPreferable",
      "residualRisk",
      "revisitWhen",
    ])
    for (const key of REQUIRED_FIELDS) {
      expect(missingFields(record({ [key]: "" }), NOW)).toEqual([key])
      expect(missingFields(record({ [key]: "   " }), NOW)).toEqual([key])
      expect(missingFields(record({ [key]: 5 }), NOW)).toEqual([key])
      expect(missingFields(record({ [key]: undefined }), NOW)).toEqual([key])
    }
  })
  it("lists several missing fields separated by commas, in order", () => {
    expect(
      missingFields(record({ ruleBroken: "", constraint: "", expires: "2026-01-01" }), NOW),
    ).toEqual(["ruleBroken", "constraint", "expires (2026-01-01 has passed)"])
  })
  it("treats a past expiry as missing, and today, the future, none or a non-date as fine", () => {
    expect(missingFields(record({ expires: "2026-10-10" }), NOW)).toEqual([
      "expires (2026-10-10 has passed)",
    ])
    expect(missingFields(record({ expires: "2026-10-11" }), NOW)).toEqual([])
    expect(missingFields(record({ expires: "2027-01-01" }), NOW)).toEqual([])
    expect(missingFields(record({ expires: "" }), NOW)).toEqual([])
    expect(missingFields(record({ expires: "soon" }), NOW)).toEqual([])
    expect(missingFields(record({ expires: 20260101 }), NOW)).toEqual([])
    expect(missingFields(record({ expires: undefined }), NOW)).toEqual([])
    expect(missingFields(record({ expires: "2026-01-01x" }), NOW)).toEqual([])
    expect(missingFields(record({ expires: "1x2026-01-01" }), NOW)).toEqual([])
  })
})

describe("judgeGains", () => {
  it("accepts a gain a complete record covers", () => {
    expect(judgeGains([gain], [record()], NOW)).toEqual({
      accepted: [{ gain, id: "benchmark-complexity:perf:parse:quadratic" }],
      unaccepted: [],
    })
  })
  it("accepts a record for a worse class than the one reached, because that increase was accepted", () => {
    const worse = record({
      id: "benchmark-complexity:perf:parse:cubic-or-worse",
      to: "cubic-or-worse",
    })
    expect(judgeGains([gain], [worse], NOW).accepted).toHaveLength(1)
  })
  it("does not accept a record for a cheaper class than the one reached", () => {
    const cheaper = record({
      id: "benchmark-complexity:perf:parse:linearithmic",
      to: "linearithmic",
    })
    expect(judgeGains([gain], [cheaper], NOW)).toEqual({
      accepted: [],
      unaccepted: [
        {
          gain,
          id: "benchmark-complexity:perf:parse:quadratic",
          reason: "no record accepts it",
        },
      ],
    })
  })
  it("does not accept a record for another suite or group", () => {
    expect(judgeGains([gain], [record({ suite: "other" })], NOW).unaccepted).toHaveLength(1)
    expect(judgeGains([gain], [record({ group: "other" })], NOW).unaccepted).toHaveLength(1)
    expect(judgeGains([gain], [], NOW).unaccepted[0]?.reason).toBe("no record accepts it")
  })
  it("says what an incomplete or expired record is missing", () => {
    const incomplete = judgeGains([gain], [record({ whyPreferable: "" })], NOW)
    expect(incomplete.unaccepted[0]?.reason).toBe(
      "benchmark-complexity:perf:parse:quadratic is not complete (missing: whyPreferable)",
    )
    const expired = judgeGains([gain], [record({ expires: "2026-01-01" })], NOW)
    expect(expired.unaccepted[0]?.reason).toBe(
      "benchmark-complexity:perf:parse:quadratic is not complete (missing: expires (2026-01-01 has passed))",
    )
  })
  it("uses a complete record even when an incomplete one also matches", () => {
    const stub = record({
      id: "benchmark-complexity:perf:parse:cubic-or-worse",
      to: "cubic-or-worse",
      justification: "",
    })
    expect(judgeGains([gain], [stub, record()], NOW).accepted[0]?.id).toBe(
      "benchmark-complexity:perf:parse:quadratic",
    )
  })
  it("lists every missing field in the reason, joined by commas", () => {
    const stub = record({ ruleBroken: "", constraint: "" })
    expect(judgeGains([gain], [stub], NOW).unaccepted[0]?.reason).toBe(
      "benchmark-complexity:perf:parse:quadratic is not complete (missing: ruleBroken, constraint)",
    )
  })
  it("judges each gain on its own", () => {
    const other = { ...gain, group: "emit" }
    const result = judgeGains([gain, other], [record()], NOW)
    expect(result.accepted.map((entry) => entry.gain.group)).toEqual(["parse"])
    expect(result.unaccepted.map((entry) => entry.gain.group)).toEqual(["emit"])
  })
})
