import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hashRequirementFields } from "repo-contract/helpers"
import { mutation, MUTATION_THRESHOLD } from "../checks/mutation.js"
import { makeContext, makeResult } from "./support.js"

/** Mirrors mutation.ts's own private `deriveMutationId` exactly -- a registry record's `id` must match this, or the schema validator rejects it as an integrity failure before the policy ever gets to evaluate it. */
function deriveMutationId(mutant: {
  readonly file: string
  readonly mutator: string
  readonly original: string
  readonly replacement: string
}): string {
  const digest = hashRequirementFields(mutant, ["original", "replacement"], (record, field) => {
    const value = (record as unknown as Record<string, unknown>)[field]
    return typeof value === "string" ? value : ""
  })
  return `mutation:${mutant.file}:${mutant.mutator}:${digest.slice(0, 12)}`
}

/** A minimal, well-formed Stryker JSON report with one file and the given mutants. */
function makeReport(
  file: string,
  source: string,
  mutants: readonly {
    status: string
    mutatorName: string
    replacement: string
    start: { line: number; column: number }
    end: { line: number; column: number }
  }[],
): object {
  return {
    files: {
      [file]: {
        source,
        mutants: mutants.map((m) => ({
          status: m.status,
          mutatorName: m.mutatorName,
          replacement: m.replacement,
          location: { start: m.start, end: m.end },
        })),
      },
    },
  }
}

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-mutation-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function writeReport(report: object): void {
  mkdirSync(path.join(process.cwd(), "reports/mutation"), { recursive: true })
  writeFileSync(
    path.join(process.cwd(), "reports/mutation/mutation.json"),
    JSON.stringify(report),
    "utf8",
  )
}

function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.join(process.cwd(), ".repo-contract/exceptions"), { recursive: true })
  writeFileSync(
    path.join(process.cwd(), ".repo-contract/exceptions/mutation.json"),
    JSON.stringify({ exceptions }),
    "utf8",
  )
}

describe("mutation()", () => {
  it("fails when Stryker itself terminated abnormally", async () => {
    const check = mutation()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when Stryker produced no mutation.json", async () => {
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not produce reports/mutation/mutation.json")
  })

  it("fails when Stryker's report contains 0 valid mutants", async () => {
    writeReport({ files: {} })
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Mutation: Stryker report contains 0 valid mutants.",
    })
  })

  it("passes when the score meets the threshold, with no registry file at all", async () => {
    writeReport(
      makeReport("a.ts", "const x = 1", [
        {
          status: "Killed",
          mutatorName: "M",
          replacement: "2",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
      ]),
    )
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Mutation: score 100.00% (killed 1, timeout 0, survived 0, no-coverage 0) >= 80%.",
    })
  })

  it("wires run to the run-mutation.mjs wrapper with the bundled stryker fallback config", () => {
    const run = mutation().run as string[]
    expect(run[0]).toBe("node")
    expect(run).toContain("--fallback-config")
    expect(run.at(-1)).toContain("stryker.config.mjs")
  })

  it("Timeout counts as detected, same as Killed", async () => {
    writeReport(
      makeReport("a.ts", "const x = 1", [
        {
          status: "Timeout",
          mutatorName: "M",
          replacement: "2",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
      ]),
    )
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("killed 0, timeout 1")
  })

  it(`fails when the score is below ${String(MUTATION_THRESHOLD)}%`, async () => {
    writeReport(
      makeReport("a.ts", "const x = 1; const y = 2;", [
        {
          status: "Survived",
          mutatorName: "M",
          replacement: "0",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
        {
          status: "Killed",
          mutatorName: "M",
          replacement: "0",
          start: { line: 1, column: 15 },
          end: { line: 1, column: 16 },
        },
      ]),
    )
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("< 80% required")
  })

  it("fails with a clear message when the registry is not valid JSON", async () => {
    mkdirSync(path.join(process.cwd(), ".repo-contract/exceptions"), { recursive: true })
    writeFileSync(
      path.join(process.cwd(), ".repo-contract/exceptions/mutation.json"),
      "{ not json",
      "utf8",
    )
    writeReport(makeReport("a.ts", "x", []))
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it("suppresses a Survived mutant whose registry record matches it exactly (file+mutator+original+replacement)", async () => {
    writeReport(
      makeReport("a.ts", "const flag = false", [
        {
          status: "Survived",
          mutatorName: "BooleanLiteral",
          replacement: "true",
          start: { line: 1, column: 14 },
          end: { line: 1, column: 19 },
        },
        // An unrelated, genuinely-killed mutant so the report isn't
        // suppressed down to nothing -- keeps this test's own assertions
        // about the score summary meaningful (see the dedicated
        // "every mutant ... excluded" test below for the all-suppressed case).
        {
          status: "Killed",
          mutatorName: "StringLiteral",
          replacement: '""',
          start: { line: 1, column: 1 },
          end: { line: 1, column: 6 },
        },
      ]),
    )
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "BooleanLiteral",
          original: "false",
          replacement: "true",
        }),
        version: 1,
        justification: "hand-verified false positive",
        file: "a.ts",
        mutator: "BooleanLiteral",
        original: "false",
        replacement: "true",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("1 known Stryker false positive excluded")
    expect(result.rationale).toContain("survived 0")
  })

  it("suppresses every mutant matching the same content, when several occurrences share identical original/replacement text", async () => {
    writeReport({
      files: {
        "a.ts": {
          source: "false || false || 1",
          mutants: [
            {
              status: "Survived",
              mutatorName: "BooleanLiteral",
              replacement: "true",
              location: { start: { line: 1, column: 1 }, end: { line: 1, column: 6 } },
            },
            {
              status: "NoCoverage",
              mutatorName: "BooleanLiteral",
              replacement: "true",
              location: { start: { line: 1, column: 10 }, end: { line: 1, column: 15 } },
            },
            // An unrelated, genuinely-killed mutant so the report isn't
            // suppressed down to nothing -- see this file's other comment
            // making the same point.
            {
              status: "Killed",
              mutatorName: "NumberLiteral",
              replacement: "0",
              location: { start: { line: 1, column: 19 }, end: { line: 1, column: 20 } },
            },
          ],
        },
      },
    })
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "BooleanLiteral",
          original: "false",
          replacement: "true",
        }),
        version: 1,
        justification: "both occurrences are the same confirmed false positive",
        file: "a.ts",
        mutator: "BooleanLiteral",
        original: "false",
        replacement: "true",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("survived 0")
    expect(result.rationale).toContain("no-coverage 0")
  })

  it("fails when a registry record's justification is empty", async () => {
    writeReport(
      makeReport("a.ts", "const flag = false", [
        {
          status: "Survived",
          mutatorName: "BooleanLiteral",
          replacement: "true",
          start: { line: 1, column: 14 },
          end: { line: 1, column: 19 },
        },
      ]),
    )
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "BooleanLiteral",
          original: "false",
          replacement: "true",
        }),
        version: 1,
        justification: "",
        file: "a.ts",
        mutator: "BooleanLiteral",
        original: "false",
        replacement: "true",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("missing: justification")
  })

  it("fails as stale when a registry record matches nothing in the current report at all", async () => {
    writeReport(
      makeReport("a.ts", "const x = 1", [
        {
          status: "Killed",
          mutatorName: "NumberLiteral",
          replacement: "0",
          start: { line: 1, column: 11 },
          end: { line: 1, column: 12 },
        },
      ]),
    )
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "BooleanLiteral",
          original: "false",
          replacement: "true",
        }),
        version: 1,
        justification: "used to be real",
        file: "a.ts",
        mutator: "BooleanLiteral",
        original: "false",
        replacement: "true",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("no longer matches any mutant in the report")
  })

  it("reports insufficient-justification problems before stale ones, with the exact combined count and newline-joined list", async () => {
    writeReport(
      makeReport("a.ts", "const flag = false", [
        {
          status: "Survived",
          mutatorName: "BooleanLiteral",
          replacement: "true",
          start: { line: 1, column: 14 },
          end: { line: 1, column: 19 },
        },
      ]),
    )
    const insufficientRecord = {
      file: "a.ts",
      mutator: "BooleanLiteral",
      original: "false",
      replacement: "true",
    }
    const staleRecord = { file: "a.ts", mutator: "NumberLiteral", original: "1", replacement: "2" }
    writeRegistry([
      {
        id: deriveMutationId(insufficientRecord),
        version: 1,
        justification: "",
        ...insufficientRecord,
      },
      { id: deriveMutationId(staleRecord), version: 1, justification: "stale one", ...staleRecord },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Mutation: .repo-contract/exceptions/mutation.json has 2 problem(s):",
        `- ${deriveMutationId(insufficientRecord)} -- missing: justification. Fill those fields in .repo-contract/exceptions/mutation.json.`,
        `- ${deriveMutationId(staleRecord)} -- a.ts [NumberLiteral] "1" -> "2" no longer matches any mutant in the report; the surrounding code likely changed.`,
      ].join("\n"),
    })
  })

  it("does NOT fail as stale when a registry record matches a mutant that is currently Killed/Timeout, not Survived -- Stryker's own perTest attribution is non-deterministic across runs of unchanged code", async () => {
    writeReport(
      makeReport("a.ts", "const flag = false", [
        {
          status: "Killed",
          mutatorName: "BooleanLiteral",
          replacement: "true",
          start: { line: 1, column: 14 },
          end: { line: 1, column: 19 },
        },
      ]),
    )
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "BooleanLiteral",
          original: "false",
          replacement: "true",
        }),
        version: 1,
        justification: "flaky mutant, sometimes reported Survived",
        file: "a.ts",
        mutator: "BooleanLiteral",
        original: "false",
        replacement: "true",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).not.toContain("known Stryker false positive")
  })

  it("fails, with the exact stock message and no extra tail text, when Stryker produced no output at all alongside the missing report", async () => {
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Mutation: Stryker did not produce reports/mutation/mutation.json.",
    })
  })

  it("truncates a long Stryker output tail to exactly the last 3000 characters when the report file is missing", async () => {
    const longOutput = "a".repeat(3500) + "END"
    const check = mutation()
    const result = await check.policy(makeContext(makeResult({ stdout: longOutput })))
    const tail = result.rationale.split("\n").at(-1) ?? ""
    expect(tail.length).toBe(3000)
    expect(tail.endsWith("END")).toBe(true)
  })

  it("extracts a multi-line span exactly -- first partial line, whole middle line(s), last partial line, newline-joined", async () => {
    writeReport({
      files: {
        "a.ts": {
          source: "AB\nCD\nEF",
          mutants: [
            {
              status: "Survived",
              mutatorName: "M",
              replacement: "X",
              location: { start: { line: 1, column: 2 }, end: { line: 3, column: 2 } },
            },
            {
              status: "Killed",
              mutatorName: "N",
              replacement: "Y",
              location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
            },
          ],
        },
      },
    })
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "M",
          original: "B\nCD\nE",
          replacement: "X",
        }),
        version: 1,
        justification: "exact multi-line span match, hand-verified",
        file: "a.ts",
        mutator: "M",
        original: "B\nCD\nE",
        replacement: "X",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("1 known Stryker false positive excluded")
  })

  it("extracts an empty original (never throws) when a mutant's location line is out of range for the source", async () => {
    writeReport(
      makeReport("a.ts", "short", [
        {
          status: "Survived",
          mutatorName: "M",
          replacement: "X",
          start: { line: 5, column: 1 },
          end: { line: 5, column: 2 },
        },
        {
          status: "Killed",
          mutatorName: "N",
          replacement: "Y",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 2 },
        },
      ]),
    )
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("survived 1")
  })

  it("extracts an empty original (never throws) when a mutant's file result carries no source text at all", async () => {
    writeReport({
      files: {
        "a.ts": {
          mutants: [
            {
              status: "Survived",
              mutatorName: "M",
              replacement: "X",
              location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
            },
            {
              status: "Killed",
              mutatorName: "N",
              replacement: "Y",
              location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
            },
          ],
        },
      },
    })
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("survived 1")
  })

  describe("matchesRecord requires file, mutator, original, AND replacement to all match", () => {
    const survivedMutant = {
      status: "Survived",
      mutatorName: "M",
      replacement: "true",
      start: { line: 1, column: 14 },
      end: { line: 1, column: 19 },
    }
    const killedMutant = {
      status: "Killed",
      mutatorName: "K",
      replacement: "0",
      start: { line: 1, column: 1 },
      end: { line: 1, column: 2 },
    }
    const base = { file: "a.ts", mutator: "M", original: "false", replacement: "true" }

    function expectNoMatch(record: typeof base) {
      return async () => {
        writeReport(makeReport("a.ts", "const flag = false", [survivedMutant, killedMutant]))
        writeRegistry([
          { id: deriveMutationId(record), version: 1, justification: "attempted match", ...record },
        ])
        const check = mutation()
        const result = await check.policy(makeContext(makeResult()))
        expect(result.outcome).toBe("fail")
        expect(result.rationale).toContain("no longer matches any mutant in the report")
      }
    }

    it("does not match when only file differs", expectNoMatch({ ...base, file: "b.ts" }))
    it("does not match when only mutator differs", expectNoMatch({ ...base, mutator: "N" }))
    it("does not match when only original differs", expectNoMatch({ ...base, original: "other" }))
    it(
      "does not match when only replacement differs",
      expectNoMatch({ ...base, replacement: "other" }),
    )
  })

  describe("MUTATION_EXCEPTION_SCHEMA field validation", () => {
    function writeRawRegistry(record: Record<string, unknown>): void {
      mkdirSync(path.join(process.cwd(), ".repo-contract/exceptions"), { recursive: true })
      writeFileSync(
        path.join(process.cwd(), ".repo-contract/exceptions/mutation.json"),
        JSON.stringify({ exceptions: [record] }),
        "utf8",
      )
    }

    beforeEach(() => {
      writeReport(
        makeReport("a.ts", "x", [
          {
            status: "Killed",
            mutatorName: "M",
            replacement: "y",
            start: { line: 1, column: 1 },
            end: { line: 1, column: 2 },
          },
        ]),
      )
    })

    it("rejects a non-string file field, and only that error", async () => {
      writeRawRegistry({
        id: "mutation:x:M:x",
        version: 1,
        justification: "j",
        file: 123,
        mutator: "M",
        original: "x",
        replacement: "y",
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.rationale).toContain("file must be a non-empty string")
      expect(result.rationale).not.toContain("mutator must be")
    })

    it("rejects an empty-string file field", async () => {
      writeRawRegistry({
        id: "mutation::M:x",
        version: 1,
        justification: "j",
        file: "",
        mutator: "M",
        original: "x",
        replacement: "y",
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.rationale).toContain("file must be a non-empty string")
    })

    it("rejects a non-string mutator field, and only that error", async () => {
      writeRawRegistry({
        id: "mutation:a.ts::x",
        version: 1,
        justification: "j",
        file: "a.ts",
        mutator: null,
        original: "x",
        replacement: "y",
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.rationale).toContain("mutator must be a non-empty string")
      expect(result.rationale).not.toContain("file must be")
    })

    it("rejects a non-string original field, and only that error", async () => {
      writeRawRegistry({
        id: "mutation:a.ts:M:x",
        version: 1,
        justification: "j",
        file: "a.ts",
        mutator: "M",
        original: 0,
        replacement: "y",
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.rationale).toContain("original must be a non-empty string")
      expect(result.rationale).not.toContain("mutator must be")
    })

    it("rejects a non-string replacement field, distinctly from the non-empty-string checks", async () => {
      writeRawRegistry({
        id: "mutation:a.ts:M:x",
        version: 1,
        justification: "j",
        file: "a.ts",
        mutator: "M",
        original: "x",
        replacement: 0,
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.rationale).toContain("replacement must be a string")
      expect(result.rationale).not.toContain("original must be")
    })

    it("accepts an empty-string replacement (only replacement's type, not its length, is checked)", async () => {
      const record = { file: "a.ts", mutator: "M", original: "x", replacement: "" }
      writeReport(
        makeReport("a.ts", "x", [
          {
            status: "Survived",
            mutatorName: "M",
            replacement: "",
            start: { line: 1, column: 1 },
            end: { line: 1, column: 2 },
          },
          {
            status: "Killed",
            mutatorName: "K",
            replacement: "z",
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
          },
        ]),
      )
      writeRawRegistry({
        id: deriveMutationId(record),
        version: 1,
        justification: "empty replacement is valid",
        ...record,
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.outcome).toBe("pass")
    })

    it("rejects a record whose id does not match the id derived from its own fields", async () => {
      writeRawRegistry({
        id: "mutation:totally:wrong:id",
        version: 1,
        justification: "j",
        file: "a.ts",
        mutator: "M",
        original: "x",
        replacement: "y",
      })
      const result = await mutation().policy(makeContext(makeResult()))
      expect(result.outcome).toBe("fail")
      expect(result.rationale).toContain("does not match the id derived from its own")
    })
  })

  it("computes killed+timeout as detected and detected+survived+noCoverage as valid -- not any sign-flipped variant", async () => {
    const mk = (status: string, i: number) => ({
      status,
      mutatorName: "M",
      replacement: String(i),
      start: { line: 1, column: i + 1 },
      end: { line: 1, column: i + 2 },
    })
    writeReport(
      makeReport("a.ts", "0123456789", [
        mk("Killed", 0),
        mk("Killed", 1),
        mk("Killed", 2),
        mk("Timeout", 3),
        mk("Survived", 4),
        mk("NoCoverage", 5),
      ]),
    )
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    // killed=3, timeout=1 -> detected=4; +survived=1 +noCoverage=1 -> valid=6; 4/6 = 66.67%.
    // killed-timeout would give detected=2 (score 50.00%); either sign-flip on
    // the valid sum would give a denominator of 4 (score 100.00%) -- both
    // distinct from the real 66.67%.
    expect(result.rationale).toContain("score 66.67%")
    expect(result.rationale).toContain("killed 3, timeout 1, survived 1, no-coverage 1")
  })

  it(`passes at exactly the ${String(MUTATION_THRESHOLD)}% boundary (score < threshold fails; score >= threshold passes)`, async () => {
    const mk = (status: string, i: number) => ({
      status,
      mutatorName: "M",
      replacement: String(i),
      start: { line: 1, column: i + 1 },
      end: { line: 1, column: i + 2 },
    })
    writeReport(
      makeReport("a.ts", "01234", [
        mk("Killed", 0),
        mk("Killed", 1),
        mk("Killed", 2),
        mk("Killed", 3),
        mk("Survived", 4),
      ]),
    )
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    // killed=4, survived=1 -> detected=4, valid=5, score=80.00% exactly.
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("score 80.00%")
  })

  it("passes, without dividing by zero, when EVERY mutant in the report is excluded by the registry -- nothing is left to score, which is success, not the 'Stryker never ran' failure", async () => {
    writeReport(
      makeReport("a.ts", "const flag = false", [
        {
          status: "Survived",
          mutatorName: "BooleanLiteral",
          replacement: "true",
          start: { line: 1, column: 14 },
          end: { line: 1, column: 19 },
        },
      ]),
    )
    writeRegistry([
      {
        id: deriveMutationId({
          file: "a.ts",
          mutator: "BooleanLiteral",
          original: "false",
          replacement: "true",
        }),
        version: 1,
        justification: "the only mutant in this report, confirmed false positive",
        file: "a.ts",
        mutator: "BooleanLiteral",
        original: "false",
        replacement: "true",
      },
    ])
    const check = mutation()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "Mutation: every mutant in the report (1) was excluded by a known Stryker false positive, see .repo-contract/exceptions/mutation.json.",
    })
  })
})
