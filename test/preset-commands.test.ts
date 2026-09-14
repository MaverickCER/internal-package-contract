import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { presetCommands } from "../checks/preset-commands.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-preset-commands-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function registryPath(): string {
  return path.join(process.cwd(), ".repo-contract/exceptions/preset-commands.json")
}

function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}

function readRegistry(): { exceptions: readonly Record<string, unknown>[] } {
  return JSON.parse(readFileSync(registryPath(), "utf8"))
}

function finding(overrides: Partial<Record<string, unknown>> = {}) {
  const base = { command: "eslint", file: "checks/lint.ts", line: 10 }
  const f = { ...base, ...overrides }
  return { id: `preset-command:${f.command}`, ...f }
}

function scanResult(findings: readonly unknown[], nonLiteral: readonly unknown[] = []) {
  return makeJsonResult({ ok: true, findings, nonLiteral })
}

function completeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const f = finding()
  return {
    id: f.id,
    version: 1,
    justification: "Lints the consumer's own source; read-only, no network access.",
    command: f.command,
    ...overrides,
  }
}

describe("presetCommands", () => {
  it("fails when the scan terminated abnormally", async () => {
    const result = await presetCommands.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when the scan's own output could not be parsed as JSON", async () => {
    const result = await presetCommands.policy(
      makeContext(makeResult({ output: { format: "json", success: false, error: "bad" } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "check-preset-commands output could not be parsed as JSON.",
    })
  })

  it("fails when discovery itself reports a failure", async () => {
    const result = await presetCommands.policy(
      makeContext(makeJsonResult({ ok: false, error: "Preset-command discovery failed: boom" })),
    )
    expect(result).toEqual({ outcome: "fail", rationale: "Preset-command discovery failed: boom" })
  })

  it("passes with zero commands and leaves an empty registry alone", async () => {
    const result = await presetCommands.policy(makeContext(scanResult([])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 preset command(s), each backed by a reviewed record.",
    })
  })

  it("fails and scaffolds a blank stub for a new, unmatched command -- never silently accepted", async () => {
    const f = finding()
    const result = await presetCommands.policy(makeContext(scanResult([f])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain('fill in "justification"')

    const written = readRegistry().exceptions
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ id: f.id, justification: "", command: f.command })
  })

  it("passes a command with a complete, matching exception record", async () => {
    const f = finding()
    writeRegistry([completeRecord()])
    const result = await presetCommands.policy(makeContext(scanResult([f])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "1 preset command(s), each backed by a reviewed record.",
    })
  })

  it("reports a stale record that matches no current command", async () => {
    writeRegistry([completeRecord()])
    const result = await presetCommands.policy(makeContext(scanResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("no check spawns")
  })

  it("always fails on a non-literal run command -- no registry entry can waive it", async () => {
    const nonLiteral = [{ file: "checks/weird.ts", line: 7, detail: "not a string literal" }]
    const result = await presetCommands.policy(makeContext(scanResult([], nonLiteral)))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("checks/weird.ts:7 -- not a string literal")
  })

  it("fails when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const result = await presetCommands.policy(makeContext(scanResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it("rejects a record whose id disagrees with its own command", async () => {
    writeRegistry([completeRecord({ id: "preset-command:something-else" })])
    const result = await presetCommands.policy(makeContext(scanResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it("rejects a record with an empty command", async () => {
    writeRegistry([completeRecord({ command: "" })])
    const result = await presetCommands.policy(makeContext(scanResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })
})
