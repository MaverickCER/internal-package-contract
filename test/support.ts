/**
 * Shared test fixtures for `checks/*.test.ts` -- every check's `policy` is a
 * pure function of a `PolicyContext`-shaped object, so a check is testable in
 * complete isolation by constructing one directly, with no real subprocess
 * ever spawned. `makeResult`/`makeContext` build the minimal, well-formed
 * shape `repo-contract`'s own `CheckEvidence`/`PolicyContext` require;
 * override only the fields a given test cares about.
 */
import type { CheckEvidence, Evidence, PolicyContext } from "repo-contract"

/** A `CheckEvidence` for a process that completed with `exitCode` (default 0) and the given output. */
export function makeResult(overrides: Partial<CheckEvidence> = {}): CheckEvidence {
  return {
    command: "true",
    args: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    status: "completed",
    ...overrides,
  }
}

/** A `CheckEvidence` reporting a successfully-parsed JSON `output.value`. */
export function makeJsonResult(
  value: unknown,
  overrides: Partial<CheckEvidence> = {},
): CheckEvidence {
  return makeResult({
    output: { format: "json", success: true, value },
    ...overrides,
  })
}

/** A `CheckEvidence` reporting a JSON parse failure. */
export function makeJsonParseFailure(
  error: string,
  overrides: Partial<CheckEvidence> = {},
): CheckEvidence {
  return makeResult({
    output: { format: "json", success: false, error },
    ...overrides,
  })
}

/** A minimal, well-formed `Evidence` -- `siblingChecks` populates `evidence.checks` for a policy that reads a sibling's own result (e.g. `Coverage` reading `evidence.checks["Tests"]`). */
export function makeEvidence(
  siblingChecks: Readonly<Record<string, CheckEvidence>> = {},
): Evidence {
  return {
    version: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    checks: siblingChecks,
  }
}

/** A minimal `PolicyContext` wrapping `result`, with empty sibling evidence/dependencies unless overridden. */
export function makeContext(
  result: CheckEvidence,
  overrides: Partial<Omit<PolicyContext, "result">> = {},
): PolicyContext {
  return {
    result,
    evidence: makeEvidence(),
    dependencies: {},
    ...overrides,
  }
}

/** Every `version: 2` exception-record field blank -- what a freshly scaffolded stub carries. */
export const BLANK_V2 = {
  ruleBroken: "",
  attempted: "",
  constraint: "",
  whyPreferable: "",
  residualRisk: "",
  revisitWhen: "",
  expires: "",
} as const

/** Every `version: 2` exception-record field written -- what a complete, reviewed record carries. */
export const COMPLETE_V2 = {
  ruleBroken: "The rule this exception breaks.",
  attempted: "What was tried first and why it did not work.",
  constraint: "The technical constraint that forced the exception.",
  whyPreferable: "Why the chosen outcome beats the alternatives.",
  residualRisk: "The risk that remains.",
  revisitWhen: "The condition under which this record is reopened.",
  expires: "",
} as const
