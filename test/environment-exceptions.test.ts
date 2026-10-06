import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ENVIRONMENT_EXCEPTION_SCHEMA,
  ENVIRONMENT_REGISTRY_RELATIVE_PATH,
  degraded,
  environmentExceptionId,
  incompleteFields,
} from "../checks/environment-exceptions.js"
import type { EnvironmentExceptionRecord } from "../checks/environment-exceptions.js"
import { validateExceptionRegistry } from "../checks/exception-record.js"
import { COMPLETE_V2, unexcepted } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-env-exc-"))
})
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

const record = (over: Record<string, unknown> = {}) => ({
  id: "environment:CodeRabbit:ci",
  version: 2,
  justification: "CodeRabbit reviews pull requests as a GitHub App.",
  check: "CodeRabbit",
  code: "ci",
  ...COMPLETE_V2,
  ...over,
})

function writeRegistry(records: unknown): void {
  const file = path.join(cwd, ENVIRONMENT_REGISTRY_RELATIVE_PATH)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ exceptions: records }))
}

describe("environmentExceptionId()", () => {
  it("is environment:<Check>:<code>", () => {
    expect(environmentExceptionId("CodeRabbit", "ci")).toBe("environment:CodeRabbit:ci")
  })
})

describe("ENVIRONMENT_EXCEPTION_SCHEMA", () => {
  it("accepts a record whose id derives from its check and code", () => {
    expect(validateExceptionRegistry([record()], ENVIRONMENT_EXCEPTION_SCHEMA).ok).toBe(true)
  })

  it("rejects an id that does not match its check/code, and an empty check or code", () => {
    const result = validateExceptionRegistry(
      [
        record({ id: "environment:CodeRabbit:other" }),
        record({ check: "", id: "environment::ci" }),
      ],
      ENVIRONMENT_EXCEPTION_SCHEMA,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("does not match the id derived")
      expect(result.errors.join("\n")).toContain("check must be a non-empty string")
    }
  })
})

describe("incompleteFields()", () => {
  const now = new Date("2026-10-02T00:00:00Z")
  const complete = record() as unknown as EnvironmentExceptionRecord

  it("is empty for a complete, unexpired record", () => {
    expect(incompleteFields(complete, now)).toEqual([])
  })

  it("names a blank justification and every blank structured field", () => {
    expect(
      incompleteFields({ ...complete, justification: " ", ruleBroken: "", revisitWhen: "  " }, now),
    ).toEqual(["justification", "ruleBroken", "revisitWhen"])
  })

  it("treats a legacy record with none of the structured fields as incomplete", () => {
    const legacy = { id: complete.id, version: 1, justification: "j", check: "C", code: "c" }
    expect(incompleteFields(legacy as EnvironmentExceptionRecord, now)).toHaveLength(6)
  })

  it("names an expired record", () => {
    expect(incompleteFields({ ...complete, expires: "2026-10-01" }, now)).toEqual([
      "expires (2026-10-01 has passed)",
    ])
  })
})

describe("degraded()", () => {
  const baseInput = () => ({ check: "CodeRabbit", code: "ci", rationale: "no CLI in CI", cwd })

  it("is an unexcepted warn when there is no registry at all", async () => {
    expect(await degraded(baseInput())).toEqual({
      outcome: "warn",
      rationale: unexcepted("environment:CodeRabbit:ci", "no CLI in CI"),
    })
  })

  it("is an accepted warn when a complete record covers it", async () => {
    writeRegistry([record()])
    expect(await degraded(baseInput())).toEqual({
      outcome: "warn",
      rationale: "Not evaluated (accepted by environment:CodeRabbit:ci): no CLI in CI",
    })
  })

  it("stays unexcepted, naming what is missing, when the record is incomplete or expired", async () => {
    writeRegistry([record({ residualRisk: "" })])
    const incomplete = await degraded(baseInput())
    expect(incomplete.rationale).toContain("environment:CodeRabbit:ci (missing: residualRisk)")
    writeRegistry([record({ expires: "2020-01-01" })])
    const expired = await degraded({ ...baseInput(), now: new Date("2026-10-02T00:00:00Z") })
    expect(expired.rationale).toContain("missing: expires (2020-01-01 has passed)")
  })

  it("requires every code when one run degraded for several reasons", async () => {
    writeRegistry([
      record({
        id: "environment:DocsLinks:https://a.test",
        check: "DocsLinks",
        code: "https://a.test",
      }),
    ])
    const result = await degraded({
      check: "DocsLinks",
      codes: ["https://a.test", "https://b.test"],
      rationale: "2 links unreachable",
      cwd,
    })
    expect(result.rationale).toContain("environment:DocsLinks:https://b.test (no record)")
    expect(result.rationale).not.toContain("environment:DocsLinks:https://a.test (")
    writeRegistry([
      record({
        id: "environment:DocsLinks:https://a.test",
        check: "DocsLinks",
        code: "https://a.test",
      }),
      record({
        id: "environment:DocsLinks:https://b.test",
        check: "DocsLinks",
        code: "https://b.test",
      }),
    ])
    const accepted = await degraded({
      check: "DocsLinks",
      codes: ["https://a.test", "https://b.test"],
      rationale: "2 links unreachable",
      cwd,
    })
    expect(accepted.rationale).toBe(
      "Not evaluated (accepted by environment:DocsLinks:https://a.test, environment:DocsLinks:https://b.test): 2 links unreachable",
    )
  })

  it("fails, naming the problem, when the registry itself is malformed", async () => {
    writeRegistry([{ id: "wrong", version: 2 }])
    const result = await degraded(baseInput())
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(`${ENVIRONMENT_REGISTRY_RELATIVE_PATH} failed to load`)
  })

  it("accepts nothing to degrade over (no codes) as accepted", async () => {
    expect((await degraded({ check: "X", rationale: "r", cwd })).rationale).toBe(
      "Not evaluated (accepted by ): r",
    )
  })
})
