import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readmeStructureCheck } from "../checks/readme-structure.js"
import { REQUIRED_SECTIONS } from "../scripts/readme/validate.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const judge = (value: unknown) => readmeStructureCheck().policy(makeContext(makeJsonResult(value)))

describe("readmeStructureCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = readmeStructureCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-readme\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a private package, saying why", async () => {
    expect(await judge({ ok: true, state: "exempt" })).toEqual({
      outcome: "pass",
      rationale: "ReadmeStructure: this package is private, so its README is not an adoption page.",
    })
  })
  it("passes a README that follows the layout", async () => {
    expect(await judge({ ok: true, state: "current" })).toEqual({
      outcome: "pass",
      rationale:
        "ReadmeStructure: the README follows the shared layout, has the trust badges and is within the length limit.",
    })
  })
  it("fails with every problem the validator found", async () => {
    expect(await judge({ ok: true, state: "problem", message: "a\nb" })).toEqual({
      outcome: "fail",
      rationale: "ReadmeStructure: a\nb",
    })
  })
  it("fails closed on output that is not the envelope", async () => {
    const result = await readmeStructureCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe("ReadmeStructure: output could not be parsed as JSON.\noops")
  })
})

describe("check-readme (script)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-readme-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-readme.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
  const manifest = (value: unknown) =>
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(value))

  it("exempts a private package even without a README", () => {
    manifest({ name: "x", private: true })
    expect(envelope()).toEqual({ ok: true, state: "exempt" })
  })
  it("treats a missing package.json as a published package", () => {
    expect(envelope()).toEqual({ ok: true, state: "problem", message: "README.md is missing." })
  })
  it("fails a published package with no README", () => {
    manifest({ name: "x" })
    expect(envelope()).toEqual({ ok: true, state: "problem", message: "README.md is missing." })
  })
  it("reports every problem in a README that ignores the layout", () => {
    manifest({ name: "x", private: false })
    writeFileSync(path.join(dir, "README.md"), "# x\n\n## Install\n")
    const result = envelope()
    expect(result.state).toBe("problem")
    expect(result.message).toContain('README.md is missing the "Why it exists" section.')
    expect(result.message).toContain("not part of the standard layout")
  })
  it("passes a README that follows the layout", () => {
    manifest({ name: "x" })
    const badges = [
      "![CI](https://github.com/o/p/actions/workflows/ci.yml/badge.svg)",
      "![npm](https://img.shields.io/npm/v/p.svg)",
      "![Coverage](https://x/coverage-badge.json)",
      "![Socket](https://badge.socket.dev/npm/package/p/latest)",
      "![License](https://img.shields.io/npm/l/p.svg)",
    ]
    const body = REQUIRED_SECTIONS.map((name) =>
      name === "What it does"
        ? `## ${name}\n\n### See it run\n`
        : name === "Next steps"
          ? `## ${name}\n\n**Evaluate:** a **Integrate:** b **Verify:** c\n`
          : `## ${name}\n`,
    )
    writeFileSync(path.join(dir, "README.md"), ["# x", ...badges, ...body].join("\n"))
    expect(envelope()).toEqual({ ok: true, state: "current" })
  })
})
