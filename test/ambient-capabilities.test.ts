import { sync as crossSpawnSync } from "cross-spawn"
import { spawnSync } from "node:child_process"
import { gzipSync } from "node:zlib"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ambientCapabilitiesCheck } from "../checks/ambient-capabilities.js"
import { OPTIONAL_CHECKS, optionalChecks, withOptionalChecks } from "../checks/optional.js"
import {
  CAPABILITIES,
  DEFAULT_CONFIG,
  exemptFiles,
  normalizeConfig,
  scanFiles,
} from "../scripts/ambient/scan.mjs"
import { inspectAmbient, npmPack } from "../scripts/ambient/inspect.mjs"
import { run as ambientTool } from "../scripts/package-tools/ambient.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const file = (name: string, text: string) => ({ name, content: Buffer.from(text) })

describe("normalizeConfig", () => {
  it("forbids everything but a bin's filesystem use when nothing is written", () => {
    expect(normalizeConfig(undefined)).toEqual({ config: DEFAULT_CONFIG, problems: [] })
    expect(DEFAULT_CONFIG).toEqual({
      child_process: [],
      env: [],
      fs: ["bin"],
      forbiddenDependencies: [],
    })
  })
  it("keeps what is written, forbidding only the capabilities named", () => {
    expect(
      normalizeConfig({ fs: ["bin", "./node"], forbiddenDependencies: ["cross-spawn"] }),
    ).toEqual({
      config: { fs: ["bin", "./node"], forbiddenDependencies: ["cross-spawn"] },
      problems: [],
    })
    expect(normalizeConfig({})).toEqual({ config: { forbiddenDependencies: [] }, problems: [] })
  })
  it("does not hand back the defaults themselves to be changed", () => {
    const { config } = normalizeConfig(undefined)
    config.fs?.push("x")
    expect(DEFAULT_CONFIG.fs).toEqual(["bin"])
  })
  it("says what is wrong with each mistake", () => {
    for (const raw of [null, 3, "x", ["a"]]) {
      expect(normalizeConfig(raw)).toEqual({
        config: { forbiddenDependencies: [] },
        problems: ['"ambientCapabilities" must be an object.'],
      })
    }
    expect(normalizeConfig({ network: [] }).problems).toEqual([
      '"ambientCapabilities.network" is not one of child_process, fs, env, forbiddenDependencies.',
    ])
    expect(normalizeConfig({ fs: "bin" }).problems).toEqual([
      '"ambientCapabilities.fs" must be a list of strings: the entry points ("bin", "./node") that may use it.',
    ])
    expect(normalizeConfig({ forbiddenDependencies: [1] }).problems).toEqual([
      '"ambientCapabilities.forbiddenDependencies" must be a list of strings: dependency names.',
    ])
    expect(normalizeConfig({ env: [3] }).problems).toHaveLength(1)
    expect(normalizeConfig({ env: ["bin", 3] }).problems).toHaveLength(1)
  })
})

describe("exemptFiles", () => {
  it("derives the entry points from the manifest, with their maps and CommonJS siblings", () => {
    const manifest = {
      bin: { tool: "./dist/cli/index.js" },
      exports: {
        "./node": { import: "./dist/node.js", require: "./dist/node.cjs" },
        "./plain": "./dist/plain.js",
        ".": "./dist/index.js",
      },
    }
    expect([...exemptFiles(manifest, ["bin", "./node"])].sort()).toEqual([
      "dist/cli/index.cjs",
      "dist/cli/index.cjs.map",
      "dist/cli/index.js",
      "dist/cli/index.js.map",
      "dist/node.cjs",
      "dist/node.cjs.map",
      "dist/node.js",
      "dist/node.js.map",
    ])
    expect(exemptFiles(manifest, ["./plain"]).has("dist/plain.js")).toBe(true)
    expect(exemptFiles(manifest, ["./plain"]).has("dist/index.js")).toBe(false)
  })
  it("rewrites only a trailing .js and a leading ./", () => {
    const names = [
      ...exemptFiles({ bin: "./dist/x.json.js" }, ["bin"]),
      ...exemptFiles({ bin: "dist/a./b.js" }, ["bin"]),
    ]
    expect(names.sort()).toEqual([
      "dist/a./b.cjs",
      "dist/a./b.cjs.map",
      "dist/a./b.js",
      "dist/a./b.js.map",
      "dist/x.json.cjs",
      "dist/x.json.cjs.map",
      "dist/x.json.js",
      "dist/x.json.js.map",
    ])
  })
  it("accepts a bin written as a string, a default condition, and entries that do not exist", () => {
    expect(exemptFiles({ bin: "cli.js" }, ["bin"]).has("cli.js")).toBe(true)
    expect(exemptFiles({ exports: { "./a": { default: "./a.js" } } }, ["./a"]).has("a.js")).toBe(
      true,
    )
    expect(exemptFiles({}, ["bin", "./missing"]).size).toBe(0)
    expect(exemptFiles({ exports: { "./a": null } }, ["./a"]).size).toBe(0)
    expect(exemptFiles({ exports: { "./a": 5 } }, ["./a"]).size).toBe(0)
  })
})

describe("scanFiles", () => {
  const scan = (files: ReturnType<typeof file>[], config: object, manifest: object = {}) =>
    scanFiles({ files, manifest, config })
  it("lists what each capability looks like", () => {
    expect(Object.keys(CAPABILITIES)).toEqual(["child_process", "fs", "env"])
  })
  it("finds every way of reaching the filesystem and of starting a process", () => {
    const fs = [
      "node:fs",
      'require("fs/promises")',
      "require('fs/promises')",
      'require("fs")',
      "require('fs')",
      'import("fs")',
      "import('fs')",
      'from "fs"',
      "from 'fs'",
    ]
    for (const hit of fs) {
      expect(scan([file("a.js", `x ${hit} y`)], { fs: [] }).violations).toEqual([
        { file: "a.js", capability: "fs", hit: fs.find((n) => hit.includes(n)) },
      ])
    }
    const spawn = [
      "node:child_process",
      'require("child_process")',
      "require('child_process')",
      'import("child_process")',
      "import('child_process')",
      'from "child_process"',
      "from 'child_process'",
    ]
    for (const hit of spawn) {
      expect(scan([file("a.js", hit)], { child_process: [] }).violations).toEqual([
        { file: "a.js", capability: "child_process", hit: spawn.find((n) => hit.includes(n)) },
      ])
    }
  })
  it("finds process.env but not a longer name", () => {
    expect(scan([file("a.js", "const e = process.env.HOME")], { env: [] }).violations).toEqual([
      { file: "a.js", capability: "env", hit: "process.env" },
    ])
    expect(
      scan([file("a.js", "myprocess.env x; process.environment")], { env: [] }).violations,
    ).toEqual([])
  })
  it("checks only capabilities the package forbids", () => {
    const files = [file("a.js", 'import "node:fs"; process.env; require("child_process")')]
    expect(scan(files, {}).violations).toEqual([])
    expect(scan(files, { env: [] }).violations.map((v) => v.capability)).toEqual(["env"])
  })
  it("exempts a capability's entry points, and only for that capability", () => {
    const manifest = { bin: "cli.js" }
    const files = [
      file("cli.js", 'import "node:fs"; process.env'),
      file("lib.js", 'import "node:fs"'),
    ]
    const result = scan(files, { fs: ["bin"], env: [] }, manifest)
    expect(result.violations).toEqual([
      { file: "cli.js", capability: "env", hit: "process.env" },
      { file: "lib.js", capability: "fs", hit: "node:fs" },
    ])
    expect(result.exempt).toEqual({
      fs: ["cli.js", "cli.js.map", "cli.cjs", "cli.cjs.map"].sort(),
      env: [],
    })
    expect(result.checked).toBe(2)
  })
  it("reads only JavaScript, skips bundled dependencies and files too large to be source", () => {
    const manifest = { bundleDependencies: ["typescript"] }
    const big = { name: "big.js", content: Buffer.alloc(8 * 1024 * 1024 + 1, "a") }
    const files = [
      file("a.d.ts", 'import "node:fs"'),
      file("README.md", "node:fs"),
      file("node_modules/typescript/lib.js", 'import "node:fs"'),
      file("node_modules/other/lib.js", 'import "node:fs"'),
      file("a.cjs", 'import "node:fs"'),
      file("a.mjs", 'import "node:fs"'),
      file("noextension", 'import "node:fs"'),
      big,
    ]
    const result = scan(files, { fs: [] }, manifest)
    expect(result.violations.map((v) => v.file)).toEqual([
      "node_modules/other/lib.js",
      "a.cjs",
      "a.mjs",
    ])
    expect(result.checked).toBe(3)
    const edge = {
      name: "edge.js",
      content: Buffer.from(`${"a".repeat(8 * 1024 * 1024 - 7)}node:fs`),
    }
    expect(scan([edge], { fs: [] }).violations).toHaveLength(1)
  })
  it("fails a dependency the package must not have, naming package.json", () => {
    const result = scan(
      [],
      { forbiddenDependencies: ["cross-spawn", "other"] },
      { dependencies: { "cross-spawn": "^7" } },
    )
    expect(result.violations).toEqual([
      { file: "package.json", capability: "dependencies", hit: "cross-spawn" },
    ])
    expect(scan([], { forbiddenDependencies: ["x"] }).violations).toEqual([])
    expect(scan([], {}, { dependencies: { x: "1" } }).violations).toEqual([])
  })
})

const judge = (value: unknown) =>
  ambientCapabilitiesCheck().policy(makeContext(makeJsonResult(value)))

describe("ambientCapabilitiesCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = ambientCapabilitiesCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-ambient-capabilities\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a private package and a clean one", async () => {
    expect(await judge({ ok: true, state: "exempt" })).toEqual({
      outcome: "pass",
      rationale: "AmbientCapabilities: this package is private, so nothing it ships is received.",
    })
    expect(await judge({ ok: true, state: "clean", checked: 4 })).toEqual({
      outcome: "pass",
      rationale:
        "AmbientCapabilities: none of the 4 shipped file(s) reaches a capability the package must be handed, and no forbidden dependency is declared.",
    })
  })
  it("fails a misconfiguration, listing what is wrong", async () => {
    expect(await judge({ ok: true, state: "misconfigured", problems: ["a", "b"] })).toEqual({
      outcome: "fail",
      rationale:
        'AmbientCapabilities: "internal-package-contract"."ambientCapabilities" in package.json is not valid:\n- a\n- b',
    })
  })
  it("fails when there was nothing to read", async () => {
    expect(
      await judge({ ok: true, state: "unpacked", message: "no tarball to check at /x." }),
    ).toEqual({
      outcome: "fail",
      rationale: "AmbientCapabilities: no tarball to check at /x.",
    })
  })
  it("fails every finding, saying what the file does and how to fix it", async () => {
    const result = await judge({
      ok: true,
      state: "violations",
      violations: [
        { file: "a.js", capability: "child_process", hit: "node:child_process" },
        { file: "b.js", capability: "fs", hit: "node:fs" },
        { file: "c.js", capability: "env", hit: "process.env" },
        { file: "package.json", capability: "dependencies", hit: "cross-spawn" },
        { file: "d.js", capability: "other", hit: "x" },
      ],
    })
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe(
      [
        "AmbientCapabilities: the package that would be published reaches what it must be handed (5 finding(s)):",
        '- a.js starts a process itself (node:child_process). Take it from the caller, or list this entry point under "ambientCapabilities"."child_process".',
        '- b.js reaches the filesystem itself (node:fs). Take it from the caller, or list this entry point under "ambientCapabilities"."fs".',
        '- c.js reads the environment itself (process.env). Take it from the caller, or list this entry point under "ambientCapabilities"."env".',
        '- package.json depends on a package it must not (cross-spawn). Take it from the caller, or list this entry point under "ambientCapabilities"."dependencies".',
        '- d.js other (x). Take it from the caller, or list this entry point under "ambientCapabilities"."other".',
      ].join("\n"),
    )
    expect((await judge({ ok: true, state: "violations" })).rationale).toContain("(0 finding(s))")
  })
  it("copes with an envelope that leaves out the details", async () => {
    expect((await judge({ ok: true, state: "misconfigured" })).rationale).toBe(
      'AmbientCapabilities: "internal-package-contract"."ambientCapabilities" in package.json is not valid:',
    )
    expect((await judge({ ok: true, state: "unpacked" })).rationale).toBe("AmbientCapabilities: ")
    expect((await judge({ ok: true, state: "clean" })).rationale).toContain("none of the 0 shipped")
  })
  it("fails closed on a run that did not finish", async () => {
    const stuck = await ambientCapabilitiesCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stuck.rationale).toBe(
      "check-ambient-capabilities did not run to completion (status: timed_out).",
    )
  })
  it("fails closed on output that is not the envelope", async () => {
    const bad = await ambientCapabilitiesCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("AmbientCapabilities: output could not be parsed as JSON.\noops")
  })
})

describe("optional checks", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "optional-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const manifest = (value: object) =>
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(value))

  it("offers AmbientCapabilities, which waits for the tests", () => {
    expect(Object.keys(OPTIONAL_CHECKS)).toEqual(["AgentSkill", "AmbientCapabilities"])
    expect(OPTIONAL_CHECKS["AgentSkill"]?.dependsOn).toEqual([])
    expect(OPTIONAL_CHECKS["AmbientCapabilities"]?.dependsOn).toEqual(["Tests"])
  })
  it("turns on nothing unless package.json names it", () => {
    expect(optionalChecks(dir)).toEqual({})
    manifest({})
    expect(optionalChecks(dir)).toEqual({})
    manifest({ "internal-package-contract": { checks: "AmbientCapabilities" } })
    expect(optionalChecks(dir)).toEqual({})
    manifest({ "internal-package-contract": {} })
    expect(optionalChecks(dir)).toEqual({})
  })
  it("turns on the checks it names, each after the tests", () => {
    manifest({ "internal-package-contract": { checks: ["AmbientCapabilities"] } })
    const checks = optionalChecks(dir)
    expect(Object.keys(checks)).toEqual(["AmbientCapabilities"])
    expect(checks["AmbientCapabilities"]?.dependsOn).toEqual(["Tests"])
    expect(checks["AmbientCapabilities"]?.output).toEqual({ format: "json" })
  })
  it("lists every check that exists, separated by commas", () => {
    const table = OPTIONAL_CHECKS as Record<string, unknown>
    table["Other"] = OPTIONAL_CHECKS["AmbientCapabilities"]
    try {
      manifest({ "internal-package-contract": { checks: ["Nope"] } })
      expect(() => optionalChecks(dir)).toThrow(
        "Available: AgentSkill, AmbientCapabilities, Other.",
      )
    } finally {
      delete table["Other"]
    }
  })
  it("names the checks that exist when one does not", () => {
    for (const name of ["Nope", "toString", 3]) {
      manifest({ "internal-package-contract": { checks: [name] } })
      expect(() => optionalChecks(dir)).toThrow(
        `package.json turns on a check that does not exist: ${String(name)}. Available: AgentSkill, AmbientCapabilities.`,
      )
    }
  })
  it("puts the optional checks just before Mutation, which must run last", () => {
    expect(Object.keys(withOptionalChecks({ A: 1, Mutation: 2 }, { X: 3, Y: 4 }))).toEqual([
      "A",
      "X",
      "Y",
      "Mutation",
    ])
    expect(Object.keys(withOptionalChecks({ A: 1, B: 2 }, { X: 3 }))).toEqual(["A", "B", "X"])
    expect(withOptionalChecks({ A: 1 }, {})).toEqual({ A: 1 })
  })
})

describe("check-ambient-capabilities (script, against a real pack)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-ambient-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-ambient-capabilities.mjs")
  const put = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), text)
  }
  const manifest = (value: Record<string, unknown>) =>
    put("package.json", JSON.stringify({ name: "fixture-pkg", version: "1.0.0", ...value }))
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" })
    return JSON.parse(result.stdout) as Record<string, unknown>
  }

  it("exempts a private package", () => {
    manifest({ private: true })
    expect(run()).toEqual({ ok: true, state: "exempt" })
  })
  it("reports a configuration that cannot be read", () => {
    manifest({ "internal-package-contract": { ambientCapabilities: { fs: "bin" } } })
    expect(run()).toMatchObject({
      state: "misconfigured",
      problems: [expect.stringContaining("ambientCapabilities.fs")],
    })
  })
  it("packs the package and passes one that reaches nothing", () => {
    manifest({
      files: ["index.js"],
      "internal-package-contract": { ambientCapabilities: { env: [], child_process: [] } },
    })
    put("index.js", "export const a = 1\n")
    expect(run()).toMatchObject({ state: "clean", checked: 1, violations: [] })
  })
  it("finds what the packed package reaches, with the exemptions the manifest gives", () => {
    manifest({
      files: ["index.js", "cli.js"],
      bin: "cli.js",
      dependencies: { "cross-spawn": "^7" },
      "internal-package-contract": {
        ambientCapabilities: { fs: ["bin"], env: [], forbiddenDependencies: ["cross-spawn"] },
      },
    })
    put("index.js", 'import "node:fs"\n')
    put("cli.js", 'import "node:fs"\nprocess.env.A\n')
    const report = run()
    expect(report["state"]).toBe("violations")
    expect(report["violations"]).toEqual([
      { file: "cli.js", capability: "env", hit: "process.env" },
      { file: "index.js", capability: "fs", hit: "node:fs" },
      { file: "package.json", capability: "dependencies", hit: "cross-spawn" },
    ])
  })
  it("uses the defaults when nothing is configured", () => {
    manifest({ files: ["cli.js", "lib.js"], bin: "cli.js" })
    put("cli.js", 'import "node:fs"\n')
    put("lib.js", 'import "node:child_process"\n')
    expect(run()).toMatchObject({
      state: "violations",
      violations: [{ file: "lib.js", capability: "child_process", hit: "node:child_process" }],
    })
  })
  it("reads a tarball it is given, and says when there is none", () => {
    manifest({ files: ["index.js"] })
    put("index.js", "export const a = 1\n")
    const packed = crossSpawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], {
      cwd: dir,
      encoding: "utf8",
    })
    const name = packed.stdout.trim().split("\n").at(-1) ?? ""
    expect(run("--tarball", name)).toMatchObject({ state: "clean", checked: 1 })
    expect(run("--tarball", "missing.tgz")).toEqual({
      ok: true,
      state: "unpacked",
      message: expect.stringMatching(/^no tarball to check at .*missing\.tgz\.$/),
    })
  })
})

describe("inspectAmbient and the ambient tool", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-ambient-inspect-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), text)
  }
  const manifest = (value: object) =>
    put("package.json", JSON.stringify({ name: "fx", version: "1", ...value }))
  const sink = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
  }

  it("packs the package with npm, naming the file npm printed last", () => {
    manifest({ files: ["a.js"] })
    put("a.js", "export {}\n")
    const file = npmPack(dir, dir)
    expect(path.basename(file)).toBe("fx-1.tgz")
    expect(existsSync(file)).toBe(true)
  })
  it("packs into a temporary directory it removes afterwards, and checks what was packed", () => {
    manifest({})
    let into = ""
    const report = inspectAmbient({
      cwd: dir,
      pack: (_cwd: string, work: string) => {
        into = work
        return path.join(work, "missing.tgz")
      },
    })
    expect(report).toEqual({
      state: "unpacked",
      message: `no tarball to check at ${path.join(into, "missing.tgz")}.`,
    })
    expect(path.basename(into).startsWith("ipc-ambient-")).toBe(true)
    expect(existsSync(into)).toBe(false)
  })
  it("reads the dependencies of the tarball's manifest, not the working copy's", () => {
    const forbid = {
      "internal-package-contract": {
        ambientCapabilities: { forbiddenDependencies: ["cross-spawn"] },
      },
    }
    manifest({ files: ["a.js"], dependencies: { "cross-spawn": "1" } })
    put("a.js", "export {}\n")
    const withIt = npmPack(dir, dir)
    manifest({ files: ["a.js"], ...forbid })
    expect(inspectAmbient({ cwd: dir, tarball: withIt }).state).toBe("violations")
    rmSync(withIt)
    manifest({ files: ["a.js"] })
    const without = npmPack(dir, dir)
    manifest({ files: ["a.js"], dependencies: { "cross-spawn": "1" }, ...forbid })
    expect(inspectAmbient({ cwd: dir, tarball: without }).state).toBe("clean")
  })
  it("falls back to the working copy's manifest when the tarball has none", () => {
    manifest({
      dependencies: { "cross-spawn": "1" },
      "internal-package-contract": {
        ambientCapabilities: { forbiddenDependencies: ["cross-spawn"] },
      },
    })
    put("empty.tgz", "")
    writeFileSync(path.join(dir, "empty.tgz"), gzipSync(Buffer.alloc(1024)))
    expect(inspectAmbient({ cwd: dir, tarball: "empty.tgz" })).toMatchObject({
      state: "violations",
      violations: [{ file: "package.json", capability: "dependencies", hit: "cross-spawn" }],
    })
  })
  it("removes the temporary directory even when the packer already did", () => {
    manifest({})
    expect(
      inspectAmbient({
        cwd: dir,
        pack: (_cwd: string, work: string) => {
          rmSync(work, { recursive: true })
          return path.join(work, "x.tgz")
        },
      }).state,
    ).toBe("unpacked")
  })
  it("leaves no temporary directory behind when the package is private or misconfigured", () => {
    const before = readdirSync(tmpdir()).filter((n) => n.startsWith("ipc-ambient-")).length
    manifest({ private: true })
    expect(inspectAmbient({ cwd: dir })).toEqual({ state: "exempt" })
    manifest({ "internal-package-contract": { ambientCapabilities: 3 } })
    expect(inspectAmbient({ cwd: dir }).state).toBe("misconfigured")
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("ipc-ambient-")).length).toBe(before)
  })

  it("tells a build step what the package reaches", () => {
    const run = (report: object, args: string[] = []) => {
      const s = sink()
      let seen: unknown
      const code = ambientTool(args, dir, s.io, {
        inspect: (input: unknown) => {
          seen = input
          return report
        },
      })
      return { code, out: s.out.join(""), err: s.err.join(""), seen }
    }
    expect(run({ state: "exempt" })).toMatchObject({
      code: 0,
      out: "[ambient] this package is private, so nothing it ships is received.\n",
      seen: { cwd: dir, tarball: undefined },
    })
    expect(run({ state: "exempt" }, ["--other"]).seen).toEqual({ cwd: dir, tarball: undefined })
    expect(run({ state: "clean", checked: 3 }, ["--tarball", "x.tgz"])).toMatchObject({
      code: 0,
      out: "[ambient] none of the 3 shipped file(s) reaches what it must be handed.\n",
      seen: { cwd: dir, tarball: "x.tgz" },
    })
    expect(
      run({
        state: "violations",
        violations: [
          { file: "a.js", capability: "fs", hit: "node:fs" },
          { file: "b.js", capability: "env", hit: "process.env" },
        ],
      }),
    ).toMatchObject({
      code: 1,
      err: "[ambient] the package reaches what it must be handed:\n- a.js: fs (node:fs)\n- b.js: env (process.env)\n",
    })
    expect(run({ state: "misconfigured", problems: ["p", "q"] })).toMatchObject({
      code: 1,
      err: "[ambient] ambientCapabilities in package.json is not valid:\n- p\n- q\n",
    })
    expect(run({ state: "unpacked", message: "no tarball to check at /x." })).toMatchObject({
      code: 1,
      err: "[ambient] no tarball to check at /x.\n",
    })
  })
  it("runs for real against the working directory", () => {
    manifest({ files: ["a.js"] })
    put("a.js", 'import "node:child_process"\n')
    const s = sink()
    expect(ambientTool([], dir, s.io)).toBe(1)
    expect(s.err.join("")).toContain("- a.js: child_process (node:child_process)")
  })
})
