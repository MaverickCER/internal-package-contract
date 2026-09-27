import { describe, expect, it } from "vitest"
import {
  coderabbitai,
  evaluateCoderabbitPolicy,
  evaluateFinding,
  findBijectionErrors,
} from "../../../checks/coderabbitai.js"
import type {
  CoderabbitEvidence,
  CoderabbitExceptionRecord,
  NormalizedFinding,
} from "../../../scripts/coderabbitai/evidence-types.js"
import {
  createCoderabbitStub,
  deriveCoderabbitExceptionId,
} from "../../../scripts/coderabbitai/registry.js"
import { makeContext, makeJsonResult, makeResult } from "../../support.js"

const REGISTRY = ".repo-contract/exceptions/coderabbit.json"

function finding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  const base = {
    file: "src/example.ts",
    severity: "major" as NormalizedFinding["severity"],
    summary: "A finding CodeRabbit reported.",
    ...overrides,
  }
  return { ...base, id: deriveCoderabbitExceptionId(base) }
}

const COMPLETE = {
  justification: "The suggested change would regress a documented invariant.",
  remediation: "Tracked as a follow-up; not blocking.",
  method: "independent-human-review" as const,
  exceptionType: "accepted-risk" as const,
}

function record(
  from: NormalizedFinding,
  overrides: Partial<CoderabbitExceptionRecord> = {},
): CoderabbitExceptionRecord {
  return { ...createCoderabbitStub(from, from.id), ...overrides }
}

interface Pair {
  readonly finding: NormalizedFinding
  readonly record: CoderabbitExceptionRecord
}

function reviewed(
  pairs: readonly Pair[],
  extras: {
    readonly stale?: readonly CoderabbitExceptionRecord[]
    readonly scaffoldedIds?: readonly string[]
    readonly registryError?: readonly string[]
  } = {},
): CoderabbitEvidence {
  const activeExceptions: Record<string, CoderabbitExceptionRecord> = {}
  for (const { finding: f, record: r } of pairs) activeExceptions[f.id] = r
  return {
    status: "reviewed",
    registryPath: REGISTRY,
    findings: pairs.map((p) => p.finding),
    activeExceptions,
    staleExceptions: extras.stale ?? [],
    scaffoldedIds: extras.scaffoldedIds ?? [],
    ...(extras.registryError !== undefined ? { registryError: extras.registryError } : {}),
  }
}

const NOT_APPLICABLE: CoderabbitEvidence = {
  status: "not-applicable",
  reason: "ci",
  expectedProvider: "coderabbit-github-app",
  registryPath: REGISTRY,
  existingRecordCount: 0,
}

describe("evaluateCoderabbitPolicy", () => {
  it("warns when the review is not-applicable (CI), naming the expected provider", () => {
    const result = evaluateCoderabbitPolicy({ evidence: NOT_APPLICABLE })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("coderabbit-github-app")
  })

  it("warns when the CLI isn't installed", () => {
    const result = evaluateCoderabbitPolicy({
      evidence: {
        status: "unavailable",
        reason: "cli-not-installed",
        registryPath: REGISTRY,
        existingRecordCount: 0,
      },
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("cli-not-installed")
    expect(result.rationale).toContain("https://docs.coderabbit.ai/cli")
  })

  it("warns when git context is unavailable (a detached HEAD)", () => {
    const result = evaluateCoderabbitPolicy({
      evidence: {
        status: "unavailable",
        reason: "git-context-unavailable",
        registryPath: REGISTRY,
        existingRecordCount: 0,
      },
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("git-context-unavailable")
  })

  it("fails a not-applicable run when the registry is malformed (registryError)", () => {
    const result = evaluateCoderabbitPolicy({
      evidence: { ...NOT_APPLICABLE, registryError: ["exceptions[0] is broken"] },
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load or reconcile")
    expect(result.rationale).toContain("exceptions[0] is broken")
  })

  it("fails a reviewed run when reconciliation itself failed (registryError)", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f, COMPLETE) }], {
        registryError: [`Writing ${REGISTRY} failed: EACCES`],
      }),
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("EACCES")
  })

  it("lists every registry error on its own '- ' line, newline-joined, in order", () => {
    const result = evaluateCoderabbitPolicy({
      evidence: {
        ...NOT_APPLICABLE,
        registryError: [
          "exceptions[0].file must be a non-empty string.",
          "exceptions[1] is broken",
        ],
      },
    })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        `${REGISTRY} failed to load or reconcile and was left unchanged:`,
        "- exceptions[0].file must be a non-empty string.",
        "- exceptions[1] is broken",
      ].join("\n"),
    })
  })

  it("notes present-but-unreconciled records on a not-applicable run", () => {
    const result = evaluateCoderabbitPolicy({
      evidence: { ...NOT_APPLICABLE, existingRecordCount: 2 },
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("were validated but not reconciled")
  })

  it("omits the unreconciled note when the registry holds nothing", () => {
    const result = evaluateCoderabbitPolicy({ evidence: NOT_APPLICABLE })
    expect(result.rationale).not.toContain("were validated but not reconciled")
  })

  it("warns with the exact not-applicable rationale, with nothing appended, at 0 records", () => {
    expect(evaluateCoderabbitPolicy({ evidence: NOT_APPLICABLE })).toEqual({
      outcome: "warn",
      rationale:
        "CodeRabbit did not run (ci) -- findings were not evaluated. Expected in CI, where review is delegated to the coderabbit-github-app.",
    })
  })

  it("appends the exact unreconciled-record note at 1 record", () => {
    expect(
      evaluateCoderabbitPolicy({ evidence: { ...NOT_APPLICABLE, existingRecordCount: 1 } }),
    ).toEqual({
      outcome: "warn",
      rationale:
        "CodeRabbit did not run (ci) -- findings were not evaluated. Expected in CI, where review is delegated to the coderabbit-github-app." +
        ` 1 exception record(s) in ${REGISTRY} were validated but not reconciled (no review ran).`,
    })
  })

  it("warns with the exact unavailable rationale, with nothing appended, at 0 records", () => {
    expect(
      evaluateCoderabbitPolicy({
        evidence: {
          status: "unavailable",
          reason: "cli-not-installed",
          registryPath: REGISTRY,
          existingRecordCount: 0,
        },
      }),
    ).toEqual({
      outcome: "warn",
      rationale:
        "CodeRabbit did not run (cli-not-installed) -- findings were not evaluated. Install the CodeRabbit CLI (https://docs.coderabbit.ai/cli) and run from a real branch to enable real enforcement.",
    })
  })

  it("fails on a real CLI-reported error", () => {
    const result = evaluateCoderabbitPolicy({
      evidence: {
        status: "error",
        message: "unexpected shape",
        registryPath: REGISTRY,
        existingRecordCount: 0,
      },
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("unexpected shape")
  })

  it("passes a 0-findings review with an empty registry, with no scaffolded-count suffix", () => {
    expect(evaluateCoderabbitPolicy({ evidence: reviewed([], { scaffoldedIds: [] }) })).toEqual({
      outcome: "pass",
      rationale: "0 CodeRabbit finding(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("appends the exact scaffolded-count suffix at exactly 1 scaffolded id", () => {
    expect(
      evaluateCoderabbitPolicy({
        evidence: reviewed([], { scaffoldedIds: ["coderabbit:src/other.ts:minor:aaaaaaaaaaaa"] }),
      }),
    ).toEqual({
      outcome: "pass",
      rationale:
        "0 CodeRabbit finding(s) evaluated: all permitted by a complete exception record." +
        ` (1 new record(s) scaffolded blank in ${REGISTRY})`,
    })
  })

  it("fails a 0-findings review with a stale record", () => {
    const gone = finding({ file: "src/gone.ts" })
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([], { stale: [record(gone, COMPLETE)] }),
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("Stale exception")
    expect(result.rationale).toContain(gone.id)
  })

  it("fails a finding backed only by a blank stub", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f) }]),
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("missing:")
  })

  it("fails a finding whose record fills every field but `remediation`", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f, { ...COMPLETE, remediation: "" }) }]),
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("remediation")
  })

  it("passes a finding with a complete matching record", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f, COMPLETE) }]),
    })
    expect(result.outcome).toBe("pass")
  })

  it("requires the same complete record at every severity -- there is no lighter tier", () => {
    for (const severity of ["critical", "major", "minor", "unknown"] as const) {
      const f = finding({ severity })
      expect(
        evaluateCoderabbitPolicy({ evidence: reviewed([{ finding: f, record: record(f) }]) })
          .outcome,
        severity,
      ).toBe("fail")
      expect(
        evaluateCoderabbitPolicy({
          evidence: reviewed([{ finding: f, record: record(f, COMPLETE) }]),
        }).outcome,
        severity,
      ).toBe("pass")
    }
  })

  it("names the number of blank stubs it scaffolded on an otherwise-clean pass", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f, COMPLETE) }], {
        scaffoldedIds: ["coderabbit:src/other.ts:minor:aaaaaaaaaaaa"],
      }),
    })
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("1 new record(s) scaffolded blank")
  })

  it("includes the finding's own summary text in the failure rationale", () => {
    const f = finding({ summary: "A very specific description of the problem." })
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f) }]),
    })
    expect(result.rationale).toContain("A very specific description of the problem.")
  })

  it("fails on a broken findings <-> activeExceptions bijection", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: {
        status: "reviewed",
        registryPath: REGISTRY,
        findings: [f],
        activeExceptions: {},
        staleExceptions: [],
        scaffoldedIds: [],
      },
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("bijection")
  })

  it("fails when the evidence's own records don't satisfy the registry schema", () => {
    const f = finding()
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([
        // A record whose id no longer agrees with its own file/severity/summary -- exactly what an
        // evidence value the wrapper script never actually produced would look like.
        { finding: f, record: { ...record(f, COMPLETE), summary: "tampered with" } },
      ]),
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("independent registry validation")
  })

  it("lists every independent-validation error on its own '- ' line, newline-joined", () => {
    // Two records whose `severity` is a value the registry schema doesn't recognize -- one error
    // each, so the "- " prefix and the "\n" join are both observable in the asserted output.
    const bad = "nope" as NormalizedFinding["severity"]
    const first = finding({ severity: bad, summary: "The first finding." })
    const second = finding({ severity: bad, summary: "The second finding." })
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([
        { finding: first, record: record(first, COMPLETE) },
        { finding: second, record: record(second, COMPLETE) },
      ]),
    })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "CodeRabbit evidence failed independent registry validation:",
        '- exceptions[0].severity must be one of "critical", "major", "minor", "unknown" (got "nope").',
        '- exceptions[1].severity must be one of "critical", "major", "minor", "unknown" (got "nope").',
      ].join("\n"),
    })
  })

  it("lists every bijection error on its own '- ' line, newline-joined", () => {
    const unbacked = finding({ summary: "A finding with no record at all." })
    const orphaned = finding({ summary: "A record whose finding is gone." })
    const result = evaluateCoderabbitPolicy({
      evidence: {
        status: "reviewed",
        registryPath: REGISTRY,
        findings: [unbacked],
        activeExceptions: { [orphaned.id]: record(orphaned, COMPLETE) },
        staleExceptions: [],
        scaffoldedIds: [],
      },
    })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "CodeRabbit evidence broke the findings <-> activeExceptions bijection:",
        `- finding ${JSON.stringify(unbacked.id)} has no active exception record.`,
        `- active exception ${JSON.stringify(orphaned.id)} matches no finding.`,
      ].join("\n"),
    })
  })

  it("fails with the exact offender line, missing-field list and combined count", () => {
    const f = finding({ file: "src/resolve.ts", summary: "Consider returning early." })
    const gone = finding({ file: "src/gone.ts", summary: "A finding no longer raised." })
    const result = evaluateCoderabbitPolicy({
      evidence: reviewed([{ finding: f, record: record(f) }], {
        stale: [record(gone, COMPLETE)],
      }),
    })
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "2 CodeRabbit finding(s) or stale record(s) need attention:",
        "- src/resolve.ts [major]: exception incomplete (missing: justification, remediation, method, exceptionType) -- Consider returning early.",
        `- Stale exception in ${REGISTRY}: ${JSON.stringify(gone.id)} -- CodeRabbit no longer raises this finding (or its wording changed); delete this entry.`,
      ].join("\n"),
    })
  })
})

describe("findBijectionErrors", () => {
  it("reports nothing for a well-formed one-to-one correspondence", () => {
    const f = finding()
    expect(findBijectionErrors([f], { [f.id]: record(f) })).toEqual([])
  })

  it("reports a duplicate finding id", () => {
    const f = finding()
    expect(findBijectionErrors([f, f], { [f.id]: record(f) }).join("\n")).toContain("duplicate ids")
  })

  it("reports a finding with no active record", () => {
    const f = finding()
    expect(findBijectionErrors([f], {}).join("\n")).toContain("has no active exception record")
  })

  it("reports an active record matching no finding", () => {
    const f = finding()
    expect(findBijectionErrors([], { [f.id]: record(f) }).join("\n")).toContain(
      "matches no finding",
    )
  })
})

describe("evaluateFinding", () => {
  it("is 'unmatched' when the reconciled record is missing entirely", () => {
    expect(evaluateFinding(finding(), undefined)).toEqual({ verdict: "unmatched", missing: [] })
  })

  it("is 'permitted' for a complete record and 'insufficient' (naming the gaps) for a stub", () => {
    const f = finding()
    expect(evaluateFinding(f, record(f, COMPLETE)).verdict).toBe("permitted")
    const stub = evaluateFinding(f, record(f))
    expect(stub.verdict).toBe("insufficient")
    expect([...stub.missing].sort()).toEqual([
      "exceptionType",
      "justification",
      "method",
      "remediation",
    ])
  })
})

describe("coderabbitai()", () => {
  it("runs the bundled review script through tsx, as parsed JSON", () => {
    const check = coderabbitai()
    expect(check.run[0]).toBe("tsx")
    expect(check.run[1]).toMatch(/scripts[/\\]coderabbitai[/\\]review\.ts$/)
    expect(check.output).toEqual({ format: "json" })
  })

  it("fails when the wrapper script terminated abnormally, naming tsx", async () => {
    const result = await coderabbitai().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "tsx did not run to completion (status: timed_out).",
    })
  })

  it("fails, surfacing the parse error and printed output, when stdout wasn't JSON", async () => {
    const result = await coderabbitai().policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "Unexpected token o" },
          stdout: "oops",
        }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("could not be parsed as JSON. Unexpected token o")
    expect(result.rationale).toContain("oops")
  })

  it("fails with the bare parse-failure rationale when there is no parsed output at all", async () => {
    // `output` entirely absent (the wrapper printed nothing parseable) and nothing on
    // stdout/stderr: both the error detail and the printed-output tail must be empty, and every
    // `result.output` access must stay optional or this throws.
    const result = await coderabbitai().policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "CodeRabbit: scripts/coderabbitai/review.ts output could not be parsed as JSON.",
    })
  })

  it("delegates a well-formed evidence value straight to evaluateCoderabbitPolicy", async () => {
    const result = await coderabbitai().policy(makeContext(makeJsonResult(NOT_APPLICABLE)))
    expect(result).toEqual(evaluateCoderabbitPolicy({ evidence: NOT_APPLICABLE }))
    expect(result.outcome).toBe("warn")
  })
})
