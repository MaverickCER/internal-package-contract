import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  abnormalTermination,
  bundledConfig,
  combinedOutput,
  consumerScripts,
  firstExisting,
  hasScript,
  packageRoot,
  parseToolEnvelope,
  resolveConfig,
} from "../checks/shared.js"
import { makeResult } from "./support.js"

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
