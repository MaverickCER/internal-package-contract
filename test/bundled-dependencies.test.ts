import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { bundledDependencies } from "repo-contract/presets"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { bundledDependenciesCheck, isPrivate } from "../checks/bundled-dependencies.js"
import { makeContext, makeJsonResult } from "./support.js"

const PRIVATE = "BundledDependencies: this package is private, so npm never publishes its manifest."

/** What repo-contract's reader prints for a package that bundles `left-pad` without declaring it. */
const undeclared = {
  readable: true,
  fields: { bundleDependencies: ["left-pad"] },
  dependencies: [],
}

describe("bundledDependenciesCheck", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "bundled-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const manifest = (text: string) => writeFileSync(path.join(dir, "package.json"), text)
  const judge = (report: unknown) =>
    bundledDependenciesCheck({ cwd: dir }).policy(makeContext(makeJsonResult(report)))

  it("runs repo-contract's reader, which reads package.json with node and nothing else", () => {
    const check = bundledDependenciesCheck({ cwd: dir })
    expect(check.run).toEqual(bundledDependencies.run)
    expect(check.output).toEqual({ format: "json" })
  })

  it("passes a private package, which npm never publishes, even when it bundles an undeclared name", async () => {
    manifest(JSON.stringify({ name: "p", private: true }))
    expect(await judge(undeclared)).toEqual({ outcome: "pass", rationale: PRIVATE })
  })

  it("fails a published package that bundles a name its dependencies do not declare", async () => {
    manifest(JSON.stringify({ name: "p" }))
    const verdict = await judge(undeclared)
    expect(verdict.outcome).toBe("fail")
    expect(verdict.rationale).toMatch(
      /^BundledDependencies: 1 bundled package\(s\) are missing from "dependencies"\./,
    )
    expect(verdict.rationale).toContain('- bundleDependencies: "left-pad"')
  })

  it("passes a published package that bundles nothing, saying so", async () => {
    manifest(JSON.stringify({ name: "p" }))
    expect(await judge({ readable: true, fields: {}, dependencies: [] })).toEqual({
      outcome: "pass",
      rationale: "BundledDependencies: package.json bundles no dependencies.",
    })
  })

  it("judges the package as published unless private is the boolean true", async () => {
    for (const text of [
      JSON.stringify({ name: "p", private: "true" }),
      JSON.stringify({ name: "p", private: false }),
      "null",
      "[]",
      "{",
    ]) {
      manifest(text)
      expect((await judge(undeclared)).outcome, text).toBe("fail")
    }
  })

  it("judges the package as published when there is no package.json to read", async () => {
    expect((await judge(undeclared)).outcome).toBe("fail")
    expect(isPrivate(dir)).toBe(false)
  })

  it("reads private only from a package.json it can parse as an object", () => {
    for (const text of ["{", "null"]) {
      manifest(text)
      expect(isPrivate(dir), text).toBe(false)
    }
    manifest(JSON.stringify({ private: true }))
    expect(isPrivate(dir)).toBe(true)
  })

  it("reads the working directory when given none, where this private package passes", async () => {
    const verdict = await bundledDependenciesCheck().policy(makeContext(makeJsonResult(undeclared)))
    expect(verdict).toEqual({ outcome: "pass", rationale: PRIVATE })
  })

  it("fails on the real reader's output for a package.json that bundles an undeclared name", async () => {
    manifest(JSON.stringify({ name: "p", bundledDependencies: ["tar"], dependencies: {} }))
    const [command, ...args] = bundledDependenciesCheck({ cwd: dir }).run as readonly string[]
    const ran = spawnSync(command ?? "", args, { cwd: dir, encoding: "utf8" })
    expect(ran.status).toBe(0)
    const verdict = await judge(JSON.parse(ran.stdout))
    expect(verdict.outcome).toBe("fail")
    expect(verdict.rationale).toContain('- bundledDependencies: "tar"')
  })
})
