import { describe, expect, it } from "vitest"
import {
  interpretCliResult,
  parseAgentStream,
  reviewArguments,
  runCoderabbitCli,
} from "../../../scripts/coderabbitai/review.js"
import type { CliDependencies, CliSpawnResult } from "../../../scripts/coderabbitai/review.js"

/**
 * Fixtures are the real `coderabbit review --agent` event stream shapes repo-contract captured
 * directly from a live, authenticated CLI while designing this check (see its own
 * specs/decisions/0014-coderabbit-as-a-surfaced-check.md) -- a clean 0-findings run, and a run with
 * real `finding` events (severity/fileName/codegenInstructions, no line, no category, no native
 * id). No CodeRabbit CLI is ever spawned here: `parseAgentStream` is a pure string->result
 * function.
 */
const REVIEW_CONTEXT = JSON.stringify({
  type: "review_context",
  reviewType: "uncommitted",
  currentBranch: "feat/x",
  baseBranch: "main",
})
const STATUS = JSON.stringify({ type: "status", phase: "analyzing", status: "reviewing" })
const HEARTBEAT = JSON.stringify({ type: "heartbeat", status: "reviewing" })

function finding(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "finding",
    severity: "major",
    fileName: "src/example.ts",
    codegenInstructions: "Do the thing at line 3.",
    suggestions: [],
    ...overrides,
  })
}

function complete(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "complete",
    status: "review_completed",
    findings: 0,
    reviewedFiles: [],
    ...overrides,
  })
}

describe("parseAgentStream", () => {
  it("parses a clean 0-findings run", () => {
    const result = parseAgentStream([REVIEW_CONTEXT, STATUS, HEARTBEAT, complete()].join("\n"))
    expect(result).toEqual({ ok: true, findings: [], completed: true })
  })

  it("ignores blank and whitespace-only lines", () => {
    const result = parseAgentStream(["", "   ", REVIEW_CONTEXT, "", complete(), ""].join("\n"))
    expect(result).toEqual({ ok: true, findings: [], completed: true })
  })

  it("normalizes finding events, mapping fileName -> file and codegenInstructions -> summary", () => {
    const result = parseAgentStream(
      [REVIEW_CONTEXT, finding(), complete({ findings: 1 })].join("\n"),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      file: "src/example.ts",
      severity: "major",
      summary: "Do the thing at line 3.",
    })
    expect(result.findings[0]?.id).toMatch(/^coderabbit:src\/example\.ts:major:[0-9a-f]{12}$/)
  })

  it("lower-cases a recognized severity reported in mixed case", () => {
    const result = parseAgentStream(
      [finding({ severity: "CRITICAL" }), complete({ findings: 1 })].join("\n"),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.findings[0]?.severity).toBe("critical")
  })

  it("maps an unrecognized severity value to 'unknown' (not an error)", () => {
    const result = parseAgentStream(
      [finding({ severity: "blocker" }), complete({ findings: 1 })].join("\n"),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.findings[0]?.severity).toBe("unknown")
  })

  it("maps a missing severity field to 'unknown' (not an error)", () => {
    const result = parseAgentStream(
      [
        JSON.stringify({
          type: "finding",
          fileName: "src/a.ts",
          codegenInstructions: "Something.",
        }),
        complete({ findings: 1 }),
      ].join("\n"),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.findings[0]?.severity).toBe("unknown")
  })

  it("fails closed when the 'complete' count claims more findings than were streamed", () => {
    const result = parseAgentStream([complete({ findings: 2 })].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("does not match the 0 finding event(s)")
  })

  it("fails closed when the 'complete' count claims fewer findings than were streamed", () => {
    const result = parseAgentStream(
      [finding(), complete({ findings: 0, status: "review_completed" })].join("\n"),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("does not match the 1 finding event(s)")
  })

  it("fails closed on a non-integer 'complete' findings count", () => {
    const result = parseAgentStream([complete({ findings: "many" })].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain('findings count ("many")')
  })

  it("fails closed on a fractional 'complete' findings count", () => {
    const result = parseAgentStream([complete({ findings: 1.5 })].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("findings count (1.5)")
  })

  it("fails closed on a negative 'complete' findings count", () => {
    const result = parseAgentStream([complete({ findings: -1 })].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("findings count (-1)")
  })

  it("ignores unrecognized event types (forward-compatible)", () => {
    const result = parseAgentStream(
      [JSON.stringify({ type: "some_future_event", data: 1 }), complete()].join("\n"),
    )
    expect(result).toEqual({ ok: true, findings: [], completed: true })
  })

  it("fails closed on a non-JSON line", () => {
    const result = parseAgentStream(["not json at all", complete()].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("non-JSON line")
  })

  it("fails closed on a JSON line that isn't an object", () => {
    const result = parseAgentStream(["[1,2,3]", complete()].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain('no recognized "type"')
  })

  it("fails closed on an event with no 'type' field", () => {
    const result = parseAgentStream([JSON.stringify({ notType: "x" }), complete()].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain('no recognized "type"')
  })

  it.each([
    ["no fileName", { type: "finding", severity: "major", codegenInstructions: "x" }],
    ["an empty fileName", { type: "finding", fileName: "", codegenInstructions: "x" }],
    ["no codegenInstructions", { type: "finding", severity: "major", fileName: "src/a.ts" }],
    [
      "empty codegenInstructions",
      { type: "finding", fileName: "src/a.ts", codegenInstructions: "" },
    ],
  ])("fails closed on a finding event with %s", (_desc, event) => {
    const result = parseAgentStream([JSON.stringify(event), complete()].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("missing a required field")
  })

  it("keeps two findings in the same file+severity distinct when their summary text differs", () => {
    const result = parseAgentStream(
      [
        finding({ codegenInstructions: "First problem." }),
        finding({ codegenInstructions: "A different, second problem in the same file." }),
        complete({ findings: 2 }),
      ].join("\n"),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0]?.id).not.toBe(result.findings[1]?.id)
  })

  it("accepts a 'review_skipped' terminal status (nothing in scope to review -- an empty diff)", () => {
    const result = parseAgentStream(
      [REVIEW_CONTEXT, complete({ status: "review_skipped" })].join("\n"),
    )
    expect(result).toEqual({ ok: true, findings: [], completed: true })
  })

  it("fails closed on a 'complete' event whose status is neither 'review_completed' nor 'review_skipped'", () => {
    const result = parseAgentStream([finding(), complete({ status: "review_failed" })].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("unexpected status")
  })

  it("fails closed on a 'complete' event with no status field at all", () => {
    const result = parseAgentStream([JSON.stringify({ type: "complete", findings: 0 })].join("\n"))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("unexpected status")
  })

  it("fails closed on any event after the terminal 'complete' event", () => {
    const result = parseAgentStream(
      [REVIEW_CONTEXT, complete(), finding(), complete({ findings: 1 })].join("\n"),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain('after its terminal "complete" event')
  })

  it("fails closed on a 'review_skipped' complete event that also carries findings", () => {
    const result = parseAgentStream(
      [finding(), complete({ status: "review_skipped", findings: 1 })].join("\n"),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected ok:false")
    expect(result.error).toContain("skipped review cannot also have findings")
  })

  it("reports completed: false when the stream ends without a 'complete' event", () => {
    const result = parseAgentStream([REVIEW_CONTEXT, STATUS, finding()].join("\n"))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok:true")
    expect(result.completed).toBe(false)
  })

  it("reports completed: false for a wholly empty stream", () => {
    expect(parseAgentStream("")).toEqual({ ok: true, findings: [], completed: false })
  })
})

describe("reviewArguments()", () => {
  it("reviews uncommitted edits as they are, and the committed branch diff when the tree is clean", () => {
    expect(reviewArguments(true, "origin/main")).toEqual(["review", "--agent", "--uncommitted"])
    expect(reviewArguments(false, "origin/main")).toEqual([
      "review",
      "--agent",
      "--committed",
      "--base",
      "origin/main",
    ])
  })
})

const COMPLETE = JSON.stringify({ type: "complete", status: "review_completed", findings: 1 })
const result = (over: Partial<CliSpawnResult> = {}): CliSpawnResult => ({
  stdout: "",
  stderr: "",
  status: 0,
  ...over,
})
const failure = (code: string, message = "boom") =>
  result({ error: Object.assign(new Error(message), { code }) })

describe("interpretCliResult()", () => {
  it("names each way the CLI can fail to run", () => {
    expect(interpretCliResult(failure("ENOENT"))).toEqual({
      status: "unavailable",
      reason: "cli-not-installed",
    })
    expect(interpretCliResult(failure("ETIMEDOUT"))).toEqual({
      status: "error",
      message: "The `coderabbit` CLI timed out (exceeded 10 minutes).",
    })
    expect(interpretCliResult(failure("ENOBUFS"))).toEqual({
      status: "error",
      message: "The `coderabbit` CLI produced more output than its buffer limit.",
    })
    expect(interpretCliResult(failure("EACCES", "denied"))).toEqual({
      status: "error",
      message: "Failed to spawn the `coderabbit` CLI: denied",
    })
  })

  it("reports a stream it cannot parse, and one that never completed, with its exit code and stderr", () => {
    expect(interpretCliResult(result({ stdout: "not json\n" })).status).toBe("error")
    expect(interpretCliResult(result({ stdout: REVIEW_CONTEXT, status: 3 }))).toEqual({
      status: "error",
      message: 'coderabbit review --agent ended without a "complete" event (exit code 3).',
    })
    expect(
      interpretCliResult(result({ stdout: REVIEW_CONTEXT, status: 2, stderr: " auth expired \n" })),
    ).toEqual({
      status: "error",
      message:
        'coderabbit review --agent ended without a "complete" event (exit code 2): auth expired',
    })
  })

  it("returns the findings of a completed review", () => {
    const out = interpretCliResult(
      result({ stdout: [REVIEW_CONTEXT, finding(), COMPLETE].join("\n") }),
    )
    expect(out.status).toBe("reviewed")
    if (out.status === "reviewed") expect(out.findings).toHaveLength(1)
  })
})

describe("runCoderabbitCli()", () => {
  const deps = (over: Partial<CliDependencies> = {}): CliDependencies => ({
    env: {},
    isDetachedHead: () => false,
    hasUncommittedEdits: () => true,
    defaultBaseRef: () => "origin/main",
    spawn: () =>
      result({
        stdout: [REVIEW_CONTEXT, COMPLETE.replace('"findings":1', '"findings":0')].join("\n"),
      }),
    ...over,
  })

  it("defers to the GitHub App in CI, and cannot review a detached HEAD", () => {
    expect(runCoderabbitCli(deps({ env: { CI: "true" } }))).toEqual({
      status: "not-applicable",
      reason: "ci",
      expectedProvider: "coderabbit-github-app",
    })
    expect(runCoderabbitCli(deps({ isDetachedHead: () => true }))).toEqual({
      status: "unavailable",
      reason: "git-context-unavailable",
    })
  })

  it("runs the CLI with arguments for the tree's state, a bounded time and a large buffer", () => {
    const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
    const spawn = (command: string, args: string[], options: object) => {
      calls.push({ command, args, options: options as Record<string, unknown> })
      return result({
        stdout: [REVIEW_CONTEXT, COMPLETE.replace('"findings":1', '"findings":0')].join("\n"),
      })
    }
    expect(runCoderabbitCli(deps({ spawn })).status).toBe("reviewed")
    expect(runCoderabbitCli(deps({ spawn, hasUncommittedEdits: () => false }))).toMatchObject({
      status: "reviewed",
    })
    expect(calls[0]).toMatchObject({
      command: "coderabbit",
      args: ["review", "--agent", "--uncommitted"],
      options: { encoding: "utf8", timeout: 600_000, killSignal: "SIGKILL", maxBuffer: 33_554_432 },
    })
    expect(calls[1]?.args).toEqual(["review", "--agent", "--committed", "--base", "origin/main"])
  })

  it("normalizes a failing spawn", () => {
    expect(runCoderabbitCli(deps({ spawn: () => failure("ENOENT") }))).toEqual({
      status: "unavailable",
      reason: "cli-not-installed",
    })
  })
})
