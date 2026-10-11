import { describe, expect, it } from "vitest"
import {
  describeProvenance,
  groupKind,
  isDerivedGroup,
  packageCostRows,
} from "../scripts/benchmark/page-sections.mjs"

describe("groupKind", () => {
  it("names the four kinds of group a suite produces, and nothing else", () => {
    expect(groupKind("end-to-end:baseline")).toBe("baseline")
    expect(groupKind("end-to-end:with-package")).toBe("with-package")
    expect(groupKind("end-to-end:overhead")).toBe("derived-overhead")
    expect(groupKind("fn:validate-env")).toBe("function")
    expect(groupKind("fn:validate-env@large")).toBe("function")
    expect(groupKind("something-else")).toBeUndefined()
    expect(groupKind("end-to-end:other")).toBeUndefined()
  })
  it("treats only the derived overhead as derived", () => {
    expect(isDerivedGroup("end-to-end:overhead")).toBe(true)
    for (const name of ["end-to-end:baseline", "end-to-end:with-package", "fn:x", "overhead"]) {
      expect(isDerivedGroup(name), name).toBe(false)
    }
  })
})

const m = (ms: number, n: number) => ({ medianMs: ms, inputs: { variable: n } })
const measurements = {
  "end-to-end:baseline": { n20: m(0.5, 20), n40: m(1, 40), n80: m(0.001, 80) },
  "end-to-end:with-package": { n20: m(0.75, 20), n40: m(0.9, 40), n80: m(0.01, 80) },
}

describe("packageCostRows", () => {
  it("pairs the two groups per size and computes added time and relative cost", () => {
    const rows = packageCostRows(measurements, ["n20", "n40"], 0.005)
    expect(rows).toEqual([
      {
        tier: "n20",
        size: 20,
        baselineMs: 0.5,
        withPackageMs: 0.75,
        addedMs: 0.25,
        relativePercent: 50,
      },
      {
        tier: "n40",
        size: 40,
        baselineMs: 1,
        withPackageMs: 0.9,
        addedMs: -0.09999999999999998,
        relativePercent: expect.closeTo(-10, 6),
      },
    ])
  })
  it("gives no relative cost when the baseline is below the timer-noise floor", () => {
    const [row] = packageCostRows(measurements, ["n80"], 0.005)
    expect(row).toMatchObject({ tier: "n80", baselineMs: 0.001, relativePercent: null })
    expect(row?.addedMs).toBeCloseTo(0.009, 9)
  })
  it("counts a baseline exactly at the floor as measurable", () => {
    const rows = packageCostRows(
      { "end-to-end:baseline": { t: m(0.005, 1) }, "end-to-end:with-package": { t: m(0.01, 1) } },
      ["t"],
      0.005,
    )
    expect(rows[0]?.relativePercent).toBe(100)
  })
  it("orders rows by input size, not by the tier list", () => {
    const rows = packageCostRows(measurements, ["n40", "n20"], 0.005)
    expect(rows.map((r) => r.tier)).toEqual(["n20", "n40"])
  })
  it("skips a size missing from either group, and returns nothing without both groups", () => {
    const partial = {
      "end-to-end:baseline": { a: m(1, 1), b: m(1, 2) },
      "end-to-end:with-package": { a: m(2, 1) },
    }
    expect(packageCostRows(partial, ["a", "b"], 0.005).map((r) => r.tier)).toEqual(["a"])
    expect(packageCostRows({ "end-to-end:baseline": { a: m(1, 1) } }, ["a"], 0.005)).toEqual([])
    expect(packageCostRows(undefined, ["a"], 0.005)).toEqual([])
  })
  it("uses the package's own input total as the size, and leaves it null when none was recorded", () => {
    const rows = packageCostRows(
      {
        "end-to-end:baseline": { a: { medianMs: 1 } },
        "end-to-end:with-package": { a: { medianMs: 2 } },
      },
      ["a"],
      0.005,
    )
    expect(rows[0]?.size).toBeNull()
  })
})

describe("describeProvenance", () => {
  const run = (
    commit: string | null,
    runner: string | null = "GitHub Actions",
    cpuModel: string | null = null,
  ) => ({
    commit,
    runner,
    cpuModel,
  })
  it("says each run is its own commit when they are all distinct", () => {
    expect(describeProvenance([run("a"), run("b"), run("c")])).toBe(
      "3 runs from 3 commits. Each run is one measurement of one commit, not a repeat. Measured on GitHub Actions (3 runs); the processor was not recorded.",
    )
  })
  it("says so when a commit was measured more than once", () => {
    expect(describeProvenance([run("a"), run("a"), run("b")])).toContain(
      "3 runs from 2 commits. Some commits were measured more than once.",
    )
  })
  it("counts runs without a commit as runs, not as commits", () => {
    expect(describeProvenance([run(null), run("a")])).toContain("2 runs from 1 commit.")
  })
  it("lists each distinct environment with its run count, including the processor when recorded", () => {
    const text = describeProvenance([
      run("a", "GitHub Actions", "EPYC 7763"),
      run("b", "GitHub Actions", "EPYC 7763"),
      run("c", "GitHub Actions", "Xeon 8370C"),
    ])
    expect(text).toContain(
      "Measured on GitHub Actions, EPYC 7763 (2 runs); GitHub Actions, Xeon 8370C (1 run).",
    )
    expect(text).not.toContain("not recorded")
  })
  it("names an unknown runner, and handles a single run and no runs", () => {
    expect(describeProvenance([run("a", null)])).toContain(
      "Measured on an unrecorded runner (1 run)",
    )
    expect(describeProvenance([run("a")]).startsWith("1 run from 1 commit.")).toBe(true)
    expect(describeProvenance([])).toBe("No runs recorded.")
  })
})
