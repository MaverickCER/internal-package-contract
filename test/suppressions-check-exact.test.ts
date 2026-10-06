import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { packageRoot } from "../checks/shared.js"
import { suppressions } from "../checks/suppressions.js"
import type { Suppression } from "../scripts/suppressions-scan.mjs"
import {
  COMPLETE_V2,
  makeContext,
  makeJsonParseFailure,
  makeJsonResult,
  makeResult,
} from "./support.js"

const make = (over: Partial<Suppression> = {}): Suppression => ({
  id: "suppression:eslint:no-console:src/a.ts:0123456789ab",
  domain: "eslint",
  rule: "no-console",
  directive: "eslint-disable-next-line",
  file: "src/a.ts",
  line: 3,
  reason: "",
  blockReason: "",
  blanket: false,
  documented: false,
  closing: false,
  ...over,
})
const numbered = (n: number) =>
  make({
    id: `suppression:eslint:no-console:src/f${String(n).padStart(2, "0")}.ts:0123456789ab`,
    file: `src/f${String(n).padStart(2, "0")}.ts`,
    line: n,
  })

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-suppressions-exact-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

const REGISTRY = ".repo-contract/exceptions/suppressions.json"
const writeRegistry = (text: string) => {
  mkdirSync(path.join(cwd, ".repo-contract/exceptions"), { recursive: true })
  writeFileSync(path.join(cwd, REGISTRY), text)
}
const record = (s: Suppression, over: Record<string, unknown> = {}) => ({
  id: s.id,
  version: 2,
  justification: "Generated.",
  domain: s.domain,
  rule: s.rule,
  file: s.file,
  anchor: s.id.split(":").at(-1),
  ...COMPLETE_V2,
  ...over,
})
const run = (found: Suppression[], files = 12) =>
  suppressions().policy(makeContext(makeJsonResult({ ok: true, files, suppressions: found })))

describe("suppressions()", () => {
  it("runs the scan script and reads its JSON", () => {
    const check = suppressions()
    expect(check.run).toEqual(["node", path.join(packageRoot, "scripts", "check-suppressions.mjs")])
    expect(check.output).toEqual({ format: "json" })
  })

  it("fails when the scan output is unusable, or the scan says it failed", async () => {
    expect(
      await suppressions().policy(makeContext(makeJsonParseFailure("bad", { stdout: "x" }))),
    ).toEqual({
      outcome: "fail",
      rationale: "Suppressions: output could not be parsed as JSON.\nx",
    })
    expect(await suppressions().policy(makeContext(makeResult({ status: "timed_out" })))).toEqual({
      outcome: "fail",
      rationale: "node did not run to completion (status: timed_out).",
    })
    expect(
      await suppressions().policy(makeContext(makeJsonResult({ ok: false, error: "no tsc" }))),
    ).toEqual({
      outcome: "fail",
      rationale: "Suppressions: could not scan the repository: no tsc",
    })
  })

  it("lists the registry's load errors, one per line", async () => {
    writeRegistry(JSON.stringify({ exceptions: [{ id: "suppression:x", version: 3 }] }))
    const result = await run([])
    expect(result.outcome).toBe("fail")
    const lines = result.rationale.split("\n")
    expect(lines[0]).toBe(`Suppressions: ${REGISTRY} failed to load:`)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) expect(line.startsWith("- ")).toBe(true)
    expect(result.rationale).toContain("version must be the number 2")
  })

  it("describes each undocumented suppression: where, which directive, which rule, why, and its id", async () => {
    const named = make()
    const blanket = make({
      id: "suppression:eslint:*:src/b.ts:aaaaaaaaaaaa",
      rule: "*",
      file: "src/b.ts",
      line: 9,
      directive: "eslint-disable",
      blanket: true,
      documented: false,
    })
    const result = await run([named, blanket])
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Suppressions: 2 problem(s). Give each suppression a reason where it is written (`-- why`), or record it in .repo-contract/exceptions/suppressions.json:",
        "- src/a.ts:3 eslint-disable-next-line no-console: no reason given -- id suppression:eslint:no-console:src/a.ts:0123456789ab",
        "- src/b.ts:9 eslint-disable: blanket (names no rule, or a form that never says what it excuses) -- id suppression:eslint:*:src/b.ts:aaaaaaaaaaaa",
      ].join("\n"),
    })
  })

  it("accepts a suppression with a complete record, and names what an incomplete one lacks", async () => {
    const s = make()
    writeRegistry(JSON.stringify({ exceptions: [record(s)] }))
    expect((await run([s])).outcome).toBe("pass")
    writeRegistry(JSON.stringify({ exceptions: [record(s, { constraint: "" })] }))
    const result = await run([s])
    expect(result.outcome).toBe("fail")
    expect(result.rationale.split("\n")[1]).toBe(
      "- src/a.ts:3 eslint-disable-next-line no-console: no reason given; its record is incomplete (missing: constraint) -- id suppression:eslint:no-console:src/a.ts:0123456789ab",
    )
    writeRegistry(JSON.stringify({ exceptions: [record(s, { constraint: "", residualRisk: "" })] }))
    expect((await run([s])).rationale.split("\n")[1]).toContain(
      "(missing: constraint, residualRisk)",
    )
  })

  it("fails a record whose suppression is gone or now documented, counting it with the others", async () => {
    const s = make()
    const gone = make({
      id: "suppression:eslint:no-console:src/gone.ts:bbbbbbbbbbbb",
      file: "src/gone.ts",
    })
    writeRegistry(JSON.stringify({ exceptions: [record(gone)] }))
    const result = await run([s])
    expect(result.outcome).toBe("fail")
    expect(result.rationale.split("\n")).toEqual([
      "Suppressions: 2 problem(s). Give each suppression a reason where it is written (`-- why`), or record it in .repo-contract/exceptions/suppressions.json:",
      "- src/a.ts:3 eslint-disable-next-line no-console: no reason given -- id suppression:eslint:no-console:src/a.ts:0123456789ab",
      `- Stale record in ${REGISTRY}: "${gone.id}" -- that suppression is gone or now gives its reason; delete this entry.`,
    ])
    const onlyStale = await run([make({ documented: true, reason: "because" })])
    expect(onlyStale.rationale).toContain("Suppressions: 1 problem(s).")
  })

  it("lists at most twenty offenders, and says how many more", async () => {
    const found = (count: number) => Array.from({ length: count }, (_, i) => numbered(i))
    const exactly = await run(found(20))
    expect(exactly.rationale.split("\n")).toHaveLength(21)
    expect(exactly.rationale).not.toContain("more.")
    const over = await run(found(21))
    const lines = over.rationale.split("\n")
    expect(lines).toHaveLength(22)
    expect(lines.at(-1)).toBe("...and 1 more.")
    expect(over.rationale).not.toContain("f20.ts")
    expect(over.rationale).toContain("Suppressions: 21 problem(s).")
    expect((await run(found(23))).rationale.split("\n").at(-1)).toBe("...and 3 more.")
  })

  it("passes, saying what it found, when every suppression gives its reason", async () => {
    expect(await run([], 5)).toEqual({
      outcome: "pass",
      rationale: "Suppressions: none in 5 file(s).",
    })
    const documented = [
      make({ documented: true, reason: "x" }),
      make({ documented: true, reason: "y", domain: "stryker" }),
      make({ closing: true, domain: "stryker" }),
    ]
    expect(await run(documented, 7)).toEqual({
      outcome: "pass",
      rationale: "Suppressions: 2 in 7 file(s) (eslint 1, stryker 1), every one gives its reason.",
    })
  })
})
