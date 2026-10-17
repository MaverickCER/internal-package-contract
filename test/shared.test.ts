import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  abnormalTermination,
  bundledConfig,
  combinedOutput,
  unparseableRationale,
  crashLine,
  withErrorHeadline,
  consumerScripts,
  firstExisting,
  hasScript,
  packageRoot,
  parseToolEnvelope,
  resolveConfig,
} from "../checks/shared.js"
import type { CheckDefinitionConfig } from "repo-contract"
import { makeContext, makeResult } from "./support.js"

describe("packageRoot", () => {
  it("resolves to this package's own root (one level up from checks/)", () => {
    // Asserts structurally, not by directory name -- Stryker runs this same
    // test from a `.stryker-tmp/sandbox-<id>/` copy of the whole repo, so the
    // containing directory is never literally named
    // "internal-package-contract" there.
    const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      name: string
    }
    expect(pkg.name).toBe("internal-package-contract")
  })
})

describe("bundledConfig", () => {
  it("joins packageRoot/config/<relPath>", () => {
    expect(bundledConfig("knip.json")).toBe(path.join(packageRoot, "config", "knip.json"))
  })
})

describe("combinedOutput", () => {
  it("joins non-empty stdout and stderr with a newline", () => {
    expect(combinedOutput(makeResult({ stdout: "out", stderr: "err" }))).toBe("out\nerr")
  })

  it("omits stdout when empty", () => {
    expect(combinedOutput(makeResult({ stdout: "", stderr: "err" }))).toBe("err")
  })

  it("omits stderr when empty", () => {
    expect(combinedOutput(makeResult({ stdout: "out", stderr: "" }))).toBe("out")
  })

  it("trims whitespace-only streams to empty and joins nothing", () => {
    expect(combinedOutput(makeResult({ stdout: "  \n", stderr: "  " }))).toBe("")
  })
})

describe("abnormalTermination", () => {
  it("returns undefined for a completed process", () => {
    expect(abnormalTermination(makeResult({ status: "completed" }), "tool")).toBeUndefined()
  })

  it("describes a spawn_error with its code and message", () => {
    const message = abnormalTermination(
      makeResult({
        status: "spawn_error",
        spawnError: "spawn tool ENOENT",
        spawnErrorCode: "ENOENT",
      }),
      "tool",
    )
    expect(message).toContain("tool could not be spawned")
    expect(message).toContain("ENOENT")
  })

  it("describes a spawn_error with no code/message using fallbacks", () => {
    const message = abnormalTermination(makeResult({ status: "spawn_error" }), "tool")
    expect(message).toContain("spawn error")
    expect(message).toContain("unknown error")
  })

  it("describes any other non-completed status generically", () => {
    expect(abnormalTermination(makeResult({ status: "timed_out" }), "tool")).toBe(
      "tool did not run to completion (status: timed_out).",
    )
  })
})

describe("consumerScripts / hasScript", () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "ipc-shared-test-"))
    vi.spyOn(process, "cwd").mockReturnValue(cwd)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(cwd, { recursive: true, force: true })
  })

  it("reads scripts from package.json in process.cwd()", () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }))
    expect(consumerScripts()).toEqual({ build: "tsc" })
    expect(hasScript("build")).toBe(true)
    expect(hasScript("test")).toBe(false)
  })

  it("returns {} when package.json has no scripts field", () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({}))
    expect(consumerScripts()).toEqual({})
  })

  it("returns {} when package.json is missing entirely", () => {
    expect(consumerScripts()).toEqual({})
    expect(hasScript("anything")).toBe(false)
  })

  it("returns {} when package.json is not valid JSON", () => {
    writeFileSync(path.join(cwd, "package.json"), "{ not json")
    expect(consumerScripts()).toEqual({})
  })
})

describe("firstExisting / resolveConfig", () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "ipc-shared-test-"))
    vi.spyOn(process, "cwd").mockReturnValue(cwd)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(cwd, { recursive: true, force: true })
  })

  it("firstExisting returns the first candidate that exists on disk", () => {
    writeFileSync(path.join(cwd, "b.json"), "{}")
    expect(firstExisting(["a.json", "b.json", "c.json"])).toBe("b.json")
  })

  it("firstExisting returns undefined when no candidate exists", () => {
    expect(firstExisting(["a.json", "b.json"])).toBeUndefined()
  })

  it("resolveConfig prefers the consumer's own config file when present", () => {
    writeFileSync(path.join(cwd, "knip.json"), "{}")
    const resolved = resolveConfig(["knip.json"], "knip.json")
    // `process.cwd()` (used both by resolveConfig and here) resolves any
    // symlinked tmp-dir prefix (e.g. macOS's /tmp -> /private/tmp) the same
    // way on both sides -- comparing against the pre-chdir `cwd` value
    // would spuriously fail on such a platform.
    expect(resolved).toEqual({ path: path.join(process.cwd(), "knip.json"), isBundled: false })
  })

  it("resolveConfig falls back to the bundled config when the consumer has none", () => {
    const resolved = resolveConfig(["knip.json"], "knip.json")
    expect(resolved).toEqual({ path: bundledConfig("knip.json"), isBundled: true })
  })
})

describe("parseToolEnvelope", () => {
  it("fails with abnormalTermination's own rationale when the process terminated abnormally", () => {
    const result = parseToolEnvelope(makeResult({ status: "timed_out" }), "tool", "Prefix:")
    expect(result).toEqual({
      ok: false,
      result: { outcome: "fail", rationale: "tool did not run to completion (status: timed_out)." },
    })
  })

  it("fails, with no trailing output, when result.output is missing entirely -- never reads .success off undefined", () => {
    const result = parseToolEnvelope(makeResult(), "tool", "Prefix:")
    expect(result).toEqual({
      ok: false,
      result: { outcome: "fail", rationale: "Prefix: output could not be parsed as JSON." },
    })
  })

  it("fails, appending combinedOutput, when result.output.success is false", () => {
    const result = parseToolEnvelope(
      makeResult({
        output: { format: "json", success: false, error: "bad" },
        stdout: "raw output",
      }),
      "tool",
      "Prefix:",
    )
    expect(result).toEqual({
      ok: false,
      result: {
        outcome: "fail",
        rationale: "Prefix: output could not be parsed as JSON.\nraw output",
      },
    })
  })

  it("fails, without crashing, when the parsed value is null (typeof null is 'object', so the 'ok' in check must never be reached for it)", () => {
    const result = parseToolEnvelope(
      makeResult({ output: { format: "json", success: true, value: null } }),
      "tool",
      "Prefix:",
    )
    expect(result).toEqual({
      ok: false,
      result: { outcome: "fail", rationale: "Prefix: output could not be parsed as JSON." },
    })
  })

  it("fails, without crashing, when the parsed value is a non-object primitive (a string)", () => {
    const result = parseToolEnvelope(
      makeResult({ output: { format: "json", success: true, value: "just a string" } }),
      "tool",
      "Prefix:",
    )
    expect(result).toEqual({
      ok: false,
      result: { outcome: "fail", rationale: "Prefix: output could not be parsed as JSON." },
    })
  })

  it("fails when the parsed value is a plain object missing its own 'ok' key", () => {
    const result = parseToolEnvelope(
      makeResult({ output: { format: "json", success: true, value: { notOk: true } } }),
      "tool",
      "Prefix:",
    )
    expect(result).toEqual({
      ok: false,
      result: { outcome: "fail", rationale: "Prefix: output could not be parsed as JSON." },
    })
  })

  it("succeeds, returning the parsed value verbatim, once it carries an own 'ok' key", () => {
    const result = parseToolEnvelope(
      makeResult({ output: { format: "json", success: true, value: { ok: true, data: 1 } } }),
      "tool",
      "Prefix:",
    )
    expect(result).toEqual({ ok: true, value: { ok: true, data: 1 } })
  })
})

describe("unparseableRationale", () => {
  it("says the output could not be parsed when the tool printed no error", () => {
    expect(unparseableRationale("X:", makeResult())).toBe(
      "X: check output could not be parsed as JSON.",
    )
    expect(unparseableRationale("X:", makeResult({ stdout: "oops" }))).toBe(
      "X: check output could not be parsed as JSON.\noops",
    )
  })
  it("leads with the error that stopped the check, then everything it printed", () => {
    const stderr =
      "node:internal/x\n  throw new E\n        ^\n\nError: Cannot find module './b.js'\n    at foo (a.ts:1:1)\n"
    expect(unparseableRationale("ApiContract:", makeResult({ stderr }))).toBe(
      `ApiContract: the check stopped with an error before it produced a result: Error: Cannot find module './b.js'\n${stderr.trim()}`,
    )
  })
  it("recognises the other error classes, including a code in brackets", () => {
    for (const line of [
      "TypeError: x is not a function",
      "UnknownCheckIdError [CODE]: bad id",
      "RangeError: out",
    ]) {
      expect(unparseableRationale("X:", makeResult({ stderr: `noise\n${line}\nat y` }))).toContain(
        `error before it produced a result: ${line}`,
      )
    }
  })
  it("does not mistake prose that merely mentions an error for one", () => {
    expect(unparseableRationale("X:", makeResult({ stderr: "see Error: in the docs" }))).toContain(
      "could not be parsed as JSON",
    )
    expect(unparseableRationale("X:", makeResult({ stderr: "an Error: x" }))).toContain(
      "could not be parsed",
    )
  })
})

describe("crashLine", () => {
  it("finds the first error line a tool died with, in any of its usual shapes", () => {
    for (const line of [
      "Error: boom",
      "TypeError: x is not a function",
      'ConfigError: Config "x": bad',
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'typedoc'",
    ]) {
      expect(crashLine(makeResult({ stderr: `warning\n${line}\n    at a (b.js:1:1)\n` }))).toBe(
        line,
      )
    }
  })
  it("ignores a line that only mentions an error, and stdout", () => {
    expect(crashLine(makeResult({ stderr: "an Error: in prose" }))).toBeUndefined()
    expect(crashLine(makeResult({ stdout: "Error: only on stdout" }))).toBeUndefined()
    expect(crashLine(makeResult())).toBeUndefined()
  })
})

describe("withErrorHeadline", () => {
  const fail = (rationale: string) => ({ outcome: "fail" as const, rationale })
  const wrapped = (verdict: { outcome: "pass" | "fail" | "warn"; rationale: string }) =>
    withErrorHeadline<Record<string, CheckDefinitionConfig>>({
      Lint: { run: ["x"], policy: () => verdict },
    })["Lint"]!.policy
  const stack = "Error: Cannot find module 'x'\n    at a (b.js:1:1)\n    at c (d.js:2:2)"
  it("leads a failure that blames something else with the error the tool died with, keeping the whole reason", async () => {
    const policy = wrapped(
      fail("ESLint output could not be parsed as JSON. ESLint printed:\nline\n"),
    )
    const result = await policy(makeContext(makeResult({ stderr: stack })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: `Lint: the tool stopped with an error before it produced a result: Error: Cannot find module 'x'\nESLint output could not be parsed as JSON. ESLint printed:\nline\n`,
    })
  })
  it("covers each kind of headline that hides a crash", async () => {
    for (const first of [
      "could not be parsed",
      "licensee did not evaluate any dependency licenses",
      "tool produced no output",
      "API docs: `npm run docs:api` exited 1.",
    ]) {
      const result = await wrapped(fail(first))(makeContext(makeResult({ stderr: stack })))
      expect(result.rationale.startsWith("Lint: the tool stopped with an error")).toBe(true)
    }
  })
  it("leaves a failure whose headline is not about missing output alone", async () => {
    const verdict = fail("3 errors found in src/a.ts")
    expect(await wrapped(verdict)(makeContext(makeResult({ stderr: stack })))).toBe(verdict)
  })
  it("leaves a pass, a warning, and a failure with no error on stderr alone", async () => {
    const pass = { outcome: "pass" as const, rationale: "output could not be parsed" }
    expect(await wrapped(pass)(makeContext(makeResult({ stderr: stack })))).toBe(pass)
    const warn = { outcome: "warn" as const, rationale: "output could not be parsed" }
    expect(await wrapped(warn)(makeContext(makeResult({ stderr: stack })))).toBe(warn)
    const noError = fail("output could not be parsed")
    expect(await wrapped(noError)(makeContext(makeResult({ stderr: "plain text" })))).toBe(noError)
  })
  it("does not repeat an error the headline already names", async () => {
    const verdict = fail("output could not be parsed: Error: Cannot find module 'x'")
    expect(await wrapped(verdict)(makeContext(makeResult({ stderr: stack })))).toBe(verdict)
  })
  it("keeps every other property of a check, and awaits an async policy", async () => {
    const check = {
      run: ["x"],
      isolated: true,
      dependsOn: ["A"],
      policy: () => Promise.resolve(fail("exited 2")),
    }
    const out = withErrorHeadline<Record<string, CheckDefinitionConfig>>({ A: check })["A"]!
    expect(out.isolated).toBe(true)
    expect((out as { dependsOn?: string[] }).dependsOn).toEqual(["A"])
    expect((await out.policy(makeContext(makeResult({ stderr: stack })))).rationale).toContain(
      "stopped with an error",
    )
  })
})
