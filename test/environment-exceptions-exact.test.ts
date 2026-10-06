import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ENVIRONMENT_EXCEPTION_SCHEMA,
  ENVIRONMENT_REGISTRY_RELATIVE_PATH,
  degraded,
  incompleteFields,
} from "../checks/environment-exceptions.js"
import { validateExceptionRegistry } from "../checks/exception-record.js"
import { NOT_EVALUATED_ACCEPTED, NOT_EVALUATED_UNEXCEPTED } from "../scripts/contract-report.mjs"
import { COMPLETE_V2 } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-env-exact-"))
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

const record = (over: Record<string, unknown> = {}) => ({
  id: "environment:CodeRabbit:ci",
  version: 2,
  justification: "Reviews run as a GitHub App.",
  check: "CodeRabbit",
  code: "ci",
  ...COMPLETE_V2,
  ...over,
})
const writeRegistry = (text: string) => {
  const file = path.join(cwd, ENVIRONMENT_REGISTRY_RELATIVE_PATH)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}
const NOW = new Date("2026-10-02T12:00:00Z")

describe("ENVIRONMENT_EXCEPTION_SCHEMA errors", () => {
  const errorsOf = (over: Record<string, unknown>) => {
    const result = validateExceptionRegistry([record(over)], ENVIRONMENT_EXCEPTION_SCHEMA)
    if (result.ok) throw new Error("valid")
    return result.errors
  }

  it("names the check or the code when it is missing, one error for each", () => {
    expect(errorsOf({ check: "" })).toEqual([expect.stringContaining("exceptions[0].check")])
    expect(errorsOf({ code: "" })).toEqual([expect.stringContaining("exceptions[0].code")])
    const both = errorsOf({ check: "", code: "" })
    expect(both).toHaveLength(2)
    expect(both[0]).toContain("exceptions[0].check")
    expect(both[1]).toContain("exceptions[0].code")
    expect(errorsOf({ check: 3 })).toHaveLength(1)
  })

  it("quotes both ids when they do not match", () => {
    expect(errorsOf({ id: "environment:CodeRabbit:other" })).toEqual([
      'exceptions[0].id "environment:CodeRabbit:other" does not match the id derived from its own check and code ("environment:CodeRabbit:ci").',
    ])
  })
})

describe("incompleteFields()", () => {
  const complete = { justification: "j", ...COMPLETE_V2 }

  it("is empty for a complete record, and lists a blank justification first, then each blank field in order", () => {
    expect(incompleteFields(complete, NOW)).toEqual([])
    expect(incompleteFields({ ...complete, justification: "  " }, NOW)).toEqual(["justification"])
    const blank = { justification: "", ruleBroken: "", attempted: undefined, constraint: 3 }
    expect(incompleteFields(blank as never, NOW)).toEqual([
      "justification",
      "ruleBroken",
      "attempted",
      "constraint",
      "whyPreferable",
      "residualRisk",
      "revisitWhen",
    ])
  })

  it("says an expiry has passed only for a real date before today, ignoring one that is missing or not a string", () => {
    expect(incompleteFields({ ...complete, expires: "2026-10-01" }, NOW)).toEqual([
      "expires (2026-10-01 has passed)",
    ])
    expect(incompleteFields({ ...complete, expires: "2026-10-02" }, NOW)).toEqual([])
    expect(incompleteFields({ ...complete, expires: "2030-01-01" }, NOW)).toEqual([])
    expect(incompleteFields({ ...complete, expires: "" }, NOW)).toEqual([])
    expect(incompleteFields({ ...complete, expires: "soon" }, NOW)).toEqual([])
    expect(incompleteFields({ ...complete, expires: 20200101 as never }, NOW)).toEqual([])
    expect(incompleteFields(complete, NOW)).toEqual([])
  })
})

describe("degraded()", () => {
  it("is accepted when a complete record covers the one code, saying so", async () => {
    writeRegistry(JSON.stringify({ exceptions: [record()] }))
    expect(
      await degraded({
        check: "CodeRabbit",
        code: "ci",
        rationale: "CI runs the App.",
        cwd,
        now: NOW,
      }),
    ).toEqual({
      outcome: "warn",
      rationale: `${NOT_EVALUATED_ACCEPTED} environment:CodeRabbit:ci): CI runs the App.`,
    })
  })

  it("needs every one of several codes covered, and lists those that are not, with what each lacks", async () => {
    writeRegistry(
      JSON.stringify({
        exceptions: [
          record(),
          record({ id: "environment:CodeRabbit:b", code: "b", constraint: "" }),
          record({ id: "environment:CodeRabbit:d", code: "d", expires: "2020-01-01" }),
        ],
      }),
    )
    const result = await degraded({
      check: "CodeRabbit",
      codes: ["ci", "b", "c", "d"],
      rationale: "why",
      cwd,
      now: NOW,
    })
    expect(result).toEqual({
      outcome: "warn",
      rationale: `${NOT_EVALUATED_UNEXCEPTED}; add or complete in ${ENVIRONMENT_REGISTRY_RELATIVE_PATH}: environment:CodeRabbit:b (missing: constraint); environment:CodeRabbit:c (no record); environment:CodeRabbit:d (missing: expires (2020-01-01 has passed))): why`,
    })
    writeRegistry(
      JSON.stringify({
        exceptions: [record(), record({ id: "environment:CodeRabbit:b", code: "b" })],
      }),
    )
    expect(
      (await degraded({ check: "CodeRabbit", codes: ["ci", "b"], rationale: "why", cwd, now: NOW }))
        .rationale,
    ).toBe(`${NOT_EVALUATED_ACCEPTED} environment:CodeRabbit:ci, environment:CodeRabbit:b): why`)
  })

  it("is unaccepted with no record at all, with several missing fields joined by commas", async () => {
    expect(
      (await degraded({ check: "X", code: "y", rationale: "r", cwd, now: NOW })).rationale,
    ).toBe(
      `${NOT_EVALUATED_UNEXCEPTED}; add or complete in ${ENVIRONMENT_REGISTRY_RELATIVE_PATH}: environment:X:y (no record)): r`,
    )
    writeRegistry(
      JSON.stringify({
        exceptions: [
          record({
            id: "environment:X:y",
            check: "X",
            code: "y",
            constraint: "",
            residualRisk: "",
          }),
        ],
      }),
    )
    expect(
      (await degraded({ check: "X", code: "y", rationale: "r", cwd, now: NOW })).rationale,
    ).toContain("(missing: constraint, residualRisk)")
  })

  it("has no code to judge when none is given, and is accepted with an empty list", async () => {
    expect(await degraded({ check: "X", rationale: "r", cwd, now: NOW })).toEqual({
      outcome: "warn",
      rationale: `${NOT_EVALUATED_ACCEPTED} ): r`,
    })
  })

  it("fails, listing the problems, when the registry cannot be loaded", async () => {
    writeRegistry(JSON.stringify({ exceptions: [{ id: "environment:X:y", version: 3 }] }))
    const result = await degraded({ check: "X", code: "y", rationale: "r", cwd, now: NOW })
    expect(result.outcome).toBe("fail")
    const lines = result.rationale.split("\n")
    expect(lines[0]).toBe(
      `${ENVIRONMENT_REGISTRY_RELATIVE_PATH} failed to load, so "X could not run" cannot be judged:`,
    )
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) expect(line.startsWith("- ")).toBe(true)
    expect(result.rationale).toContain("version must be the number 2")
  })

  it("judges expiry against the clock it is given, not the real one", async () => {
    writeRegistry(JSON.stringify({ exceptions: [record({ expires: "2025-01-01" })] }))
    const earlier = await degraded({
      check: "CodeRabbit",
      code: "ci",
      rationale: "r",
      cwd,
      now: new Date("2020-01-01T00:00:00Z"),
    })
    expect(earlier.rationale.startsWith(NOT_EVALUATED_ACCEPTED)).toBe(true)
    const real = await degraded({ check: "CodeRabbit", code: "ci", rationale: "r", cwd })
    expect(real.rationale.startsWith(NOT_EVALUATED_UNEXCEPTED)).toBe(true)
  })
})
