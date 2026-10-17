import { describe, expect, it } from "vitest"
import { describeGroup, renderTrendTable, trendOf, trendRows } from "../scripts/benchmark/trend.mjs"

const entry = (cls: string | null, notation: string | null, extra: object = {}) => ({
  class: cls,
  notation,
  ...extra,
})

describe("describeGroup", () => {
  it("names the function and variant, and the variable that is varied", () => {
    expect(describeGroup("fn:parse")).toEqual({ name: "parse", variable: "—" })
    expect(describeGroup("fn:parse", "file")).toEqual({ name: "parse", variable: "file" })
    expect(describeGroup("fn:parse@cold", "file")).toEqual({
      name: "parse (cold)",
      variable: "file",
    })
    expect(describeGroup("fn:parse#width")).toEqual({ name: "parse", variable: "width" })
    expect(describeGroup("fn:parse#width", "depth")).toEqual({ name: "parse", variable: "depth" })
  })
  it("shows any other group as it is", () => {
    expect(describeGroup("end-to-end:baseline")).toEqual({
      name: "end-to-end:baseline",
      variable: "—",
    })
    expect(describeGroup("end-to-end:baseline", "item")).toEqual({
      name: "end-to-end:baseline",
      variable: "item",
    })
  })
})

describe("trendOf", () => {
  const linear = entry("linear", "O(n)")
  const quadratic = entry("quadratic", "O(n²)")
  it("says the same, worse or improved, with both notations", () => {
    expect(trendOf(linear, linear, true)).toBe("same")
    expect(trendOf(quadratic, linear, true)).toBe("worse (O(n) → O(n²))")
    expect(trendOf(linear, quadratic, true)).toBe("improved (O(n²) → O(n))")
  })
  it("compares neighbouring classes too", () => {
    expect(trendOf(entry("linearithmic", "O(n log n)"), linear, true)).toBe(
      "worse (O(n) → O(n log n))",
    )
    expect(trendOf(entry("constant", "O(1)"), entry("logarithmic", "O(log n)"), true)).toBe(
      "improved (O(log n) → O(1))",
    )
  })
  it("says N/A, and why, when either run could not determine it", () => {
    expect(trendOf(entry(null, null), linear, true)).toBe("N/A (this run could not determine it)")
    expect(trendOf(undefined, linear, true)).toBe("N/A (this run could not determine it)")
    expect(trendOf(linear, entry(null, null), true)).toBe(
      "N/A (the previous run could not determine it)",
    )
    expect(trendOf(linear, { notation: "O(n)" }, true)).toBe(
      "N/A (the previous run could not determine it)",
    )
    expect(trendOf({ notation: "O(n)" }, linear, true)).toBe(
      "N/A (this run could not determine it)",
    )
  })
  it("says N/A when there was nothing to compare with", () => {
    expect(trendOf(linear, undefined, false)).toBe("N/A (no previous run)")
    expect(trendOf(linear, undefined, true)).toBe("N/A (not measured in the previous run)")
    expect(trendOf(entry(null, null), undefined, false)).toBe(
      "N/A (this run could not determine it)",
    )
  })
})

describe("trendRows and renderTrendTable", () => {
  const run = (complexity: object) => ({ analysis: { complexity } })
  it("gives one row per group, in order, with the variable each varies", () => {
    const rows = trendRows(
      run({
        "fn:a": entry("linear", "O(n)", { variable: "item" }),
        "fn:a#width": entry("constant", "O(1)", { variable: "width" }),
        "fn:b": entry(null, null),
      }),
      run({ "fn:a": entry("quadratic", "O(n²)"), "fn:b": entry("linear", "O(n)") }),
    )
    expect(rows).toEqual([
      { name: "a", variable: "item", bigO: "O(n)", trend: "improved (O(n²) → O(n))" },
      {
        name: "a",
        variable: "width",
        bigO: "O(1)",
        trend: "N/A (not measured in the previous run)",
      },
      {
        name: "b",
        variable: "—",
        bigO: "undetermined",
        trend: "N/A (this run could not determine it)",
      },
    ])
  })
  it("tells a first run, or a previous run without an analysis, from a new group", () => {
    const current = run({ "fn:a": entry("linear", "O(n)") })
    for (const previous of [undefined, null, {}, { analysis: {} }]) {
      expect(trendRows(current, previous)[0]?.trend).toBe("N/A (no previous run)")
    }
  })
  it("has no rows without an analysis", () => {
    expect(trendRows(undefined, undefined)).toEqual([])
    expect(trendRows({}, {})).toEqual([])
    expect(trendRows({ analysis: {} }, {})).toEqual([])
  })
  it("tolerates a group recorded as nothing", () => {
    expect(trendRows(run({ "fn:a": null }), run({}))).toEqual([
      {
        name: "a",
        variable: "—",
        bigO: "undetermined",
        trend: "N/A (this run could not determine it)",
      },
    ])
  })
  it("renders a Markdown table", () => {
    expect(
      renderTrendTable([{ name: "a", variable: "item", bigO: "O(n)", trend: "same" }]),
    ).toEqual([
      "| Function | Variable | Big-O | Since the last run |",
      "|---|---|---|---|",
      "| `a` | item | O(n) | same |",
    ])
    expect(renderTrendTable([])).toHaveLength(2)
  })
})
