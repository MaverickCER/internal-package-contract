import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { noMinify } from "../checks/no-minify.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

describe("noMinify (policy)", () => {
  it("runs the bundled script against dist by default and a custom dir when given", () => {
    const run = noMinify().run as readonly string[]
    expect(run[0]).toBe("node")
    expect(run[1]).toMatch(/scripts[\\/]check-no-minify\.mjs$/)
    expect(run[2]).toBe("dist")
    expect((noMinify("out").run as readonly string[])[2]).toBe("out")
  })

  it("asks for the script's output as JSON", () => {
    expect(noMinify().output).toEqual({ format: "json" })
  })

  it("fails on a config finding alone", async () => {
    const result = await noMinify().policy(
      makeContext(
        makeJsonResult({
          ok: true,
          dirExists: true,
          config: [{ file: "tsup.config.ts", line: 3, text: "minify: true" }],
          output: [],
        }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("- tsup.config.ts:3 requests minification: minify: true")
  })

  it("fails on an output finding alone", async () => {
    const result = await noMinify().policy(
      makeContext(
        makeJsonResult({
          ok: true,
          dirExists: true,
          config: [],
          output: [{ file: "index.js", reason: "a line is 9000 characters long (limit 5000)" }],
        }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("index.js")
  })

  it("passes when nothing was found in an existing build directory", async () => {
    const result = await noMinify().policy(
      makeContext(makeJsonResult({ ok: true, dirExists: true, config: [], output: [] })),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: 'No minification requested or found in "dist".',
    })
  })

  it("passes vacuously when there is no build directory", async () => {
    const result = await noMinify().policy(
      makeContext(makeJsonResult({ ok: true, dirExists: false })),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: 'No minification requested; "dist" does not exist, so nothing built is shipped.',
    })
  })

  it("fails listing config and output findings", async () => {
    const result = await noMinify().policy(
      makeContext(
        makeJsonResult({
          ok: true,
          dirExists: true,
          config: [
            { file: "tsup.config.ts", line: 12, text: "minify: true" },
            { file: "package.json", line: 0, text: "scripts.build: tsup --minify" },
          ],
          output: [{ file: "index.js", reason: "a line is 9000 characters long (limit 5000)" }],
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Minified code must not ship (Socket.dev flags it; 0 minification is permitted). Remove every `minify*` option and rebuild:",
        "- tsup.config.ts:12 requests minification: minify: true",
        "- package.json requests minification: scripts.build: tsup --minify",
        "- dist/index.js looks minified: a line is 9000 characters long (limit 5000)",
      ].join("\n"),
    })
  })

  it("fails closed on abnormal termination and unparseable output", async () => {
    const terminated = await noMinify().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(terminated.rationale).toBe(
      "check-no-minify did not run to completion (status: timed_out).",
    )
    const garbage = await noMinify().policy(
      makeContext(makeResult({ output: { format: "json", success: false, error: "x" } })),
    )
    expect(garbage.outcome).toBe("fail")
    expect(garbage.rationale).toContain("No minify: output could not be parsed as JSON.")
  })
})

describe("check-no-minify.mjs (real script)", () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "ipc-no-minify-"))
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  const script = (dir?: string): Record<string, unknown> => {
    const args = [path.resolve(__dirname, "../scripts/check-no-minify.mjs"), ...(dir ? [dir] : [])]
    const run = spawnSync("node", args, { cwd, encoding: "utf8" })
    expect(run.status).toBe(0)
    return JSON.parse(run.stdout) as Record<string, unknown>
  }
  const readable = Array.from(
    { length: 80 },
    (_, i) => `export const value${String(i)} = ${String(i)}`,
  ).join("\n")

  it("reports a missing build directory", () => {
    expect(script()).toEqual({ ok: true, dirExists: false, config: [], output: [] })
  })

  it("accepts readable code, ignores maps/declarations, and supports a custom dir", () => {
    mkdirSync(path.join(cwd, "out", "sub"), { recursive: true })
    writeFileSync(path.join(cwd, "out", "a.js"), readable)
    writeFileSync(path.join(cwd, "out", "sub", "b.mjs"), readable)
    writeFileSync(path.join(cwd, "out", "a.js.map"), "x".repeat(50_000))
    writeFileSync(path.join(cwd, "out", "a.d.ts"), "y".repeat(50_000))
    expect(script("out")).toEqual({ ok: true, dirExists: true, config: [], output: [] })
  })

  it("flags an extremely long line and a high mean line length, but not a small file", () => {
    mkdirSync(path.join(cwd, "dist"))
    writeFileSync(path.join(cwd, "dist", "long.js"), `${readable}\n${"a".repeat(5001)}`)
    writeFileSync(
      path.join(cwd, "dist", "dense.cjs"),
      `${"b".repeat(400)}\n${"c".repeat(400)}\n${"d".repeat(400)}`,
    )
    writeFileSync(path.join(cwd, "dist", "tiny.js"), "z".repeat(900))
    writeFileSync(path.join(cwd, "dist", "edge.js"), `${"e".repeat(5000)}`)
    const report = script()
    expect(report["output"]).toEqual([
      { file: "dense.cjs", reason: "average line length is 400 characters (limit 120)" },
      { file: "edge.js", reason: "average line length is 5000 characters (limit 120)" },
      { file: "long.js", reason: "a line is 5001 characters long (limit 5000)" },
    ])
  })

  it("flags minify options in a tsup config and package.json scripts, not `false`", () => {
    writeFileSync(
      path.join(cwd, "tsup.config.ts"),
      [
        "export default {",
        "  minify: false,",
        "  // minify: true  (commented out)",
        "  minifyWhitespace: true,",
        "  minifyIdentifiers = 1,",
        "  minifySyntax: false,",
        "  other: minifier,",
        "}",
      ].join("\n"),
    )
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({
        scripts: {
          a: "tsup --minify",
          b: "tsup --minify-whitespace",
          c: "tsup --minify=false",
          d: "tsup",
          e: 5,
          f: "esbuild --minify-syntax src",
        },
      }),
    )
    expect(script()["config"]).toEqual([
      { file: "tsup.config.ts", line: 4, text: "minifyWhitespace: true," },
      { file: "tsup.config.ts", line: 5, text: "minifyIdentifiers = 1," },
      { file: "package.json", line: 0, text: "scripts.a: tsup --minify" },
      { file: "package.json", line: 0, text: "scripts.b: tsup --minify-whitespace" },
      { file: "package.json", line: 0, text: "scripts.f: esbuild --minify-syntax src" },
    ])
  })

  it("tolerates a package.json with no scripts", () => {
    writeFileSync(path.join(cwd, "package.json"), "{}")
    expect(script()["config"]).toEqual([])
  })
})
