import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { npmScriptCheck } from "../checks/npm-script.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-npm-script-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function writePkgScripts(scripts: Record<string, string>): void {
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts }), "utf8")
}

describe("npmScriptCheck", () => {
  it("passes with a not-applicable note when the script is missing and whenMissing defaults to skip", async () => {
    writePkgScripts({})
    const check = npmScriptCheck({ script: "build", label: "Build" })
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Build: no `build` npm script -- not applicable to this package.",
    })
  })

  it("fails when the script is missing and whenMissing is fail", async () => {
    writePkgScripts({})
    const check = npmScriptCheck({ script: "build", label: "Build", whenMissing: "fail" })
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("defines no `build` npm script")
  })

  it("fails, naming the exact npm-run command, when the process terminated abnormally", async () => {
    writePkgScripts({ build: "tsc" })
    const check = npmScriptCheck({ script: "build", label: "Build" })
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("`npm run build` did not run to completion")
  })

  it("fails, printing exactly the last 4000 characters of output, on a non-zero exit", async () => {
    writePkgScripts({ build: "tsc" })
    const check = npmScriptCheck({ script: "build", label: "Build" })
    const longOutput = "a".repeat(4500) + "END"
    const result = await check.policy(makeContext(makeResult({ exitCode: 1, stderr: longOutput })))
    expect(result.outcome).toBe("fail")
    const tail = result.rationale.split("\n").at(-1) ?? ""
    expect(tail.length).toBe(4000)
    expect(tail.endsWith("END")).toBe(true)
  })

  it("fails with no trailing tail line at all when there is no output to print", async () => {
    writePkgScripts({ build: "tsc" })
    const check = npmScriptCheck({ script: "build", label: "Build" })
    const result = await check.policy(makeContext(makeResult({ exitCode: 1 })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Build: `npm run build` exited 1.",
    })
  })

  it("passes on a zero exit", async () => {
    writePkgScripts({ build: "tsc" })
    const check = npmScriptCheck({ script: "build", label: "Build" })
    const result = await check.policy(makeContext(makeResult({ exitCode: 0 })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Build: `npm run build` succeeded.",
    })
  })

  it("wires run to the plain npm-run form when mustNotChange is absent", () => {
    const check = npmScriptCheck({ script: "build", label: "Build" })
    expect(check.run).toEqual(["npm", "--loglevel=silent", "run", "build"])
  })

  it("wires run to the plain npm-run form (not the regeneration wrapper) when mustNotChange is an empty array", () => {
    const check = npmScriptCheck({ script: "build", label: "Build", mustNotChange: [] })
    expect(check.run).toEqual(["npm", "--loglevel=silent", "run", "build"])
  })

  describe("mustNotChange (regeneration wrapper)", () => {
    it("fails, printing exactly the last 3000 characters of output, when the regeneration result cannot be parsed", async () => {
      writePkgScripts({ schema: "gen-schema" })
      const check = npmScriptCheck({
        script: "schema",
        label: "Schema",
        mustNotChange: ["schemas"],
      })
      const longOutput = "a".repeat(3500) + "END"
      const result = await check.policy(
        makeContext(makeResult({ exitCode: 0, stdout: `not json\n${longOutput}` })),
      )
      expect(result.outcome).toBe("fail")
      expect(result.rationale).toContain("could not read the regeneration result")
      const tail = result.rationale.split("\n").at(-1) ?? ""
      expect(tail.length).toBe(3000)
      expect(tail.endsWith("END")).toBe(true)
    })

    it("trims trailing whitespace before taking the last line, so a trailing blank line doesn't shadow the real JSON line", async () => {
      writePkgScripts({ schema: "gen-schema" })
      const check = npmScriptCheck({
        script: "schema",
        label: "Schema",
        mustNotChange: ["schemas"],
      })
      const result = await check.policy(
        makeContext(
          makeResult({
            exitCode: 0,
            stdout: `${JSON.stringify({ ran: true, exitCode: 0, changed: [] })}\n\n`,
          }),
        ),
      )
      expect(result.outcome).toBe("pass")
    })

    it("fails, naming the exit code and printing exactly the last 3000 characters, when the wrapped script itself exited non-zero", async () => {
      writePkgScripts({ schema: "gen-schema" })
      const check = npmScriptCheck({
        script: "schema",
        label: "Schema",
        mustNotChange: ["schemas"],
      })
      const jsonLine = JSON.stringify({ ran: true, exitCode: 1, changed: [] })
      const stdout = `${"a".repeat(3500)}\n${jsonLine}`
      const result = await check.policy(makeContext(makeResult({ exitCode: 0, stdout })))
      expect(result).toEqual({
        outcome: "fail",
        rationale: `Schema: \`npm run schema\` exited 1.\n${stdout.slice(-3000)}`,
      })
    })

    it("fails, listing files with the exact heading and bullets, when regeneration produced changes", async () => {
      writePkgScripts({ schema: "gen-schema" })
      const check = npmScriptCheck({
        script: "schema",
        label: "Schema",
        mustNotChange: ["schemas"],
      })
      const result = await check.policy(
        makeContext(
          makeResult({
            exitCode: 0,
            stdout: JSON.stringify({
              ran: true,
              exitCode: 0,
              changed: ["schemas/env.json", "schemas/data.json"],
            }),
          }),
        ),
      )
      expect(result).toEqual({
        outcome: "fail",
        rationale: [
          "Schema: `npm run schema` regenerated 2 file(s) -- the committed output is stale. Run it locally and commit:",
          "- schemas/env.json",
          "- schemas/data.json",
        ].join("\n"),
      })
    })

    it("passes when regeneration produced no changes", async () => {
      writePkgScripts({ schema: "gen-schema" })
      const check = npmScriptCheck({
        script: "schema",
        label: "Schema",
        mustNotChange: ["schemas"],
      })
      const result = await check.policy(
        makeContext(
          makeResult({
            exitCode: 0,
            stdout: `some log line\n${JSON.stringify({ ran: true, exitCode: 0, changed: [] })}`,
          }),
        ),
      )
      expect(result).toEqual({
        outcome: "pass",
        rationale: "Schema: `npm run schema` succeeded and regenerated nothing.",
      })
    })

    it("wires run to the run-generated.mjs wrapper with the script and watched paths", () => {
      const check = npmScriptCheck({
        script: "schema",
        label: "Schema",
        mustNotChange: ["schemas", "api-docs"],
      })
      const run = check.run as string[]
      expect(run[0]).toBe("node")
      expect(run.slice(2)).toEqual(["schema", "schemas", "api-docs"])
    })
  })
})
