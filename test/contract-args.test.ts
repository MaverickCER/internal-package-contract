import { describe, expect, it } from "vitest"
import { selectChecks } from "../scripts/contract-args.mjs"

const available = ["Lint", "Tests", "Coverage", "Mutation"]

describe("selectChecks()", () => {
  it("returns undefined (everything) when no selection flag is present", () => {
    expect(selectChecks(["node", "contract"], available)).toBeUndefined()
  })

  it("honours --checks and --only, in both `--flag value` and `--flag=value` forms", () => {
    expect(selectChecks(["--checks", "Lint,Tests"], available)).toEqual(["Lint", "Tests"])
    expect(selectChecks(["--checks=Lint"], available)).toEqual(["Lint"])
    expect(selectChecks(["--only", " Tests , "], available)).toEqual(["Tests"])
    expect(selectChecks(["--only=Tests"], available)).toEqual(["Tests"])
  })

  it("--skip removes checks from the full set, so a check added later is included by default", () => {
    expect(selectChecks(["--skip", "Coverage,Mutation"], available)).toEqual(["Lint", "Tests"])
    expect(selectChecks(["--skip=Mutation"], available)).toEqual(["Lint", "Tests", "Coverage"])
  })

  it("--skip applies on top of --checks", () => {
    expect(selectChecks(["--checks", "Lint,Tests", "--skip", "Tests"], available)).toEqual(["Lint"])
  })

  it("treats a flag with no value as an empty list", () => {
    expect(selectChecks(["--checks"], available)).toEqual([])
    expect(selectChecks(["--skip"], available)).toBeUndefined()
  })

  it("rejects a check name the contract does not declare", () => {
    expect(() => selectChecks(["--skip", "Nope"], available)).toThrow(/Unknown check "Nope"/)
    expect(() => selectChecks(["--checks", "Lint,Nope"], available)).toThrow(/Unknown check/)
  })
})
