import { describe, expect, it } from "vitest"
import { DEFERRED_CHECK, planPhases } from "../scripts/contract-phases.mjs"

describe("planPhases()", () => {
  it("defers only SecuritySocket", () => {
    expect(DEFERRED_CHECK).toBe("SecuritySocket")
  })

  it("runs everything else first and SecuritySocket last when the whole contract is selected", () => {
    expect(planPhases(["Lint", "SecuritySocket", "Tests"], undefined)).toEqual({
      first: ["Lint", "Tests"],
      deferred: "SecuritySocket",
    })
  })

  it("applies the same split to an explicit selection that includes it among others", () => {
    expect(planPhases(["Lint", "SecuritySocket", "Tests"], ["Tests", "SecuritySocket"])).toEqual({
      first: ["Tests"],
      deferred: "SecuritySocket",
    })
  })

  it("runs it alone, immediately, when it is the only check selected", () => {
    expect(planPhases(["Lint", "SecuritySocket"], ["SecuritySocket"])).toEqual({
      first: ["SecuritySocket"],
      deferred: undefined,
    })
  })

  it("leaves a selection without it untouched", () => {
    expect(planPhases(["Lint", "SecuritySocket"], ["Lint"])).toEqual({
      first: ["Lint"],
      deferred: undefined,
    })
    expect(planPhases(["Lint", "Tests"], undefined)).toEqual({
      first: ["Lint", "Tests"],
      deferred: undefined,
    })
  })
})
