import { spawnSync } from "node:child_process"
import { gzipSync } from "node:zlib"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { packedConsumerCheck } from "../checks/packed-consumer.js"
import {
  classifyFailure,
  entryPoints,
  missingFromTarball,
  missingPackage,
  promisedFiles,
  tarballFiles,
  targetFiles,
} from "../scripts/packed-consumer/plan.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

describe("targetFiles", () => {
  it("collects every file through conditions and fallback arrays", () => {
    expect(targetFiles("./a.js")).toEqual(["./a.js"])
    expect(targetFiles({ import: "./a.mjs", require: { default: "./a.cjs" } })).toEqual([
      "./a.mjs",
      "./a.cjs",
    ])
    expect(targetFiles(["./x.js", { node: "./y.js" }])).toEqual(["./x.js", "./y.js"])
    expect(targetFiles(null)).toEqual([])
    expect(targetFiles(5)).toEqual([])
  })
})

describe("entryPoints", () => {
  it("names the package for the root and name/sub for a subpath", () => {
    const manifest = { name: "@o/p", exports: { ".": "./i.js", "./helpers": "./h.js" } }
    expect(entryPoints(manifest)).toEqual([
      { specifier: "@o/p", require: false, json: false },
      { specifier: "@o/p/helpers", require: false, json: false },
    ])
  })
  it("requires only entries that name a require condition, at any depth", () => {
    expect(
      entryPoints({ name: "p", exports: { ".": { import: "./i.mjs", require: "./i.cjs" } } })[0]
        ?.require,
    ).toBe(true)
    expect(
      entryPoints({
        name: "p",
        exports: { ".": { node: { import: "./i.mjs", require: "./i.cjs" } } },
      })[0]?.require,
    ).toBe(true)
    expect(entryPoints({ name: "p", exports: { ".": { import: "./i.mjs" } } })[0]?.require).toBe(
      false,
    )
    expect(entryPoints({ name: "p", exports: { ".": ["./a.js"] } })[0]?.require).toBe(false)
  })
  it("treats a bare string or a conditions object as the root export", () => {
    expect(entryPoints({ name: "p", exports: "./i.js" })).toEqual([
      { specifier: "p", require: false, json: false },
    ])
    expect(entryPoints({ name: "p", exports: { import: "./i.mjs", require: "./i.cjs" } })).toEqual([
      { specifier: "p", require: true, json: false },
    ])
    expect(entryPoints({ name: "p", exports: ["./i.js"] })).toHaveLength(1)
  })
  it("flags an entry whose every file is JSON, and not one that is only partly JSON", () => {
    expect(entryPoints({ name: "p", exports: { "./s": "./s.json" } })[0]?.json).toBe(true)
    expect(
      entryPoints({ name: "p", exports: { "./s": { types: "./s.d.ts", default: "./s.json" } } })[0]
        ?.json,
    ).toBe(false)
  })
  it("skips package.json, wildcard patterns and null targets", () => {
    expect(
      entryPoints({
        name: "p",
        exports: {
          ".": "./i.js",
          "./package.json": "./package.json",
          "./x/*": "./x/*.js",
          "./no": null,
        },
      }).map((entry) => entry.specifier),
    ).toEqual(["p"])
  })
  it("falls back to main, and to nothing", () => {
    expect(entryPoints({ name: "p", main: "./i.js" })).toEqual([
      { specifier: "p", require: true, json: false },
    ])
    expect(entryPoints({ name: "p", main: "./d.json" })[0]?.json).toBe(true)
    expect(entryPoints({ name: "p" })).toEqual([])
    expect(entryPoints({ name: "p", exports: null })).toEqual([])
  })
})

describe("promisedFiles and missingFromTarball", () => {
  it("lists export targets and bin files without ./, patterns or directories, sorted and unique", () => {
    expect(
      promisedFiles({
        exports: {
          ".": { import: "./dist/i.js", types: "./dist/i.d.ts" },
          "./x/*": "./dist/x/*.js",
          "./d": "./dist/d/",
        },
        bin: { tool: "./bin/tool.mjs", other: "bin/tool.mjs" },
      }),
    ).toEqual(["bin/tool.mjs", "dist/i.d.ts", "dist/i.js"])
    expect(promisedFiles({ exports: "./i.js", bin: "./b.js" })).toEqual(["b.js", "i.js"])
    expect(promisedFiles({ main: "./m.js" })).toEqual(["m.js"])
    expect(promisedFiles({})).toEqual([])
  })
  it("reports what the tarball lacks", () => {
    expect(missingFromTarball(["a.js", "b.js"], ["a.js", "c.js"])).toEqual(["b.js"])
    expect(missingFromTarball(["a.js"], ["a.js"])).toEqual([])
  })
})

describe("missingPackage and classifyFailure", () => {
  it("reads the package a failed import could not find, scoped or not, with or without a subpath", () => {
    expect(missingPackage("Error: Cannot find module 'eslint/use-at-your-own-risk'")).toBe("eslint")
    expect(missingPackage("Cannot find package '@typescript-eslint/utils' imported from x")).toBe(
      "@typescript-eslint/utils",
    )
    expect(missingPackage("Cannot find module '@scope/pkg/deep/file.js'")).toBe("@scope/pkg")
    expect(missingPackage("SyntaxError: nope")).toBeUndefined()
  })
  it("skips a failure caused by a declared peer, whether listed as a peer or only in its metadata", () => {
    const output = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'eslint' imported from /x"
    expect(classifyFailure(output, { peerDependencies: { eslint: "^9" } })).toEqual({
      kind: "peer",
      peer: "eslint",
    })
    expect(
      classifyFailure(output, { peerDependenciesMeta: { eslint: { optional: true } } }),
    ).toEqual({
      kind: "peer",
      peer: "eslint",
    })
  })
  it("calls a missing package that is not a declared peer broken, naming the error line", () => {
    const output =
      "node:internal/x:1\n\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad' imported from /x\n at y"
    expect(classifyFailure(output, { peerDependencies: { eslint: "^9" } })).toEqual({
      kind: "broken",
      reason: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad' imported from /x",
    })
    expect(classifyFailure(output, {}).kind).toBe("broken")
  })
  it("falls back to the first line, then to a placeholder, when no error is named", () => {
    expect(classifyFailure("\n  first line\nsecond", {})).toEqual({
      kind: "broken",
      reason: "first line",
    })
    expect(classifyFailure("", {})).toEqual({ kind: "broken", reason: "no output" })
    expect(classifyFailure("TypeError: bad thing happened", {})).toEqual({
      kind: "broken",
      reason: "TypeError: bad thing happened",
    })
  })
})

const judge = (value: unknown) =>
  packedConsumerCheck({ cwd: tmpdir() }).policy(makeContext(makeJsonResult(value)))

describe("packedConsumerCheck (policy)", () => {
  it("runs the bundled script and asks for JSON", () => {
    const check = packedConsumerCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-packed-consumer\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a private package and one with nothing to import", async () => {
    expect((await judge({ ok: true, state: "exempt" })).rationale).toBe(
      "PackedConsumer: this package is private, so there is nothing to publish.",
    )
    expect((await judge({ ok: true, state: "none" })).rationale).toBe(
      "PackedConsumer: package.json declares no entry point for a consumer to import.",
    )
  })
  it("passes a verified package, listing what was skipped", async () => {
    expect(
      await judge({ ok: true, state: "verified", checked: 3, problems: [], skipped: [] }),
    ).toEqual({
      outcome: "pass",
      rationale:
        "PackedConsumer: the packed tarball installs into a clean project and all 3 entry point(s) import.",
    })
    const withSkip = await judge({
      ok: true,
      state: "verified",
      checked: 2,
      skipped: ["p/x (import) needs the peer dependency eslint."],
    })
    expect(withSkip.rationale).toBe(
      "PackedConsumer: the packed tarball installs into a clean project and all 2 entry point(s) import.\\n- skipped: p/x (import) needs the peer dependency eslint.".replace(
        "\\n",
        "\n",
      ),
    )
  })
  it("fails with every problem", async () => {
    expect(await judge({ ok: true, state: "problem", problems: ["a", "b"] })).toEqual({
      outcome: "fail",
      rationale:
        "PackedConsumer: the package that would be published does not work for a consumer (2 problem(s)):\n- a\n- b",
    })
    expect((await judge({ ok: true, state: "problem" })).rationale).toContain("(0 problem(s)):")
  })
  it("is not evaluated, not failed, when the install could not run", async () => {
    const result = await judge({ ok: true, state: "install-failed", message: "npm ERR! network" })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("PackedConsumer")
    expect(result.rationale).toContain(
      "the packed tarball could not be installed into a clean project",
    )
    expect(result.rationale).toContain("npm ERR! network")
  })
  it("fails closed on output that is not the envelope or a run that did not finish", async () => {
    const bad = await packedConsumerCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("PackedConsumer: output could not be parsed as JSON.\noops")
    const stuck = await packedConsumerCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stuck.rationale).toBe(
      "check-packed-consumer did not run to completion (status: timed_out).",
    )
  })
})

describe("check-packed-consumer (script, against a real pack and install)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-packed-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-packed-consumer.mjs")
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  const manifest = (value: Record<string, unknown>) =>
    put("package.json", JSON.stringify({ name: "fixture-pkg", version: "1.0.0", ...value }))
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_fetch_retries: "0",
        npm_config_fetch_retry_mintimeout: "100",
        npm_config_fetch_retry_maxtimeout: "100",
      },
    })
    return { status: result.status, report: JSON.parse(result.stdout) as Record<string, unknown> }
  }
  const dual = () => {
    manifest({
      type: "module",
      exports: {
        ".": { import: "./index.js", require: "./index.cjs" },
        "./data": "./data.json",
      },
      files: ["index.js", "index.cjs", "data.json"],
    })
    put("index.js", "export const x = 1\n")
    put("index.cjs", "exports.x = 1\n")
    put("data.json", '{"a":1}')
  }

  it("exempts a private package and a package with no entry points", () => {
    manifest({ private: true })
    expect(run().report).toEqual({ ok: true, state: "exempt" })
    manifest({})
    expect(run().report).toEqual({ ok: true, state: "none" })
  })
  it("verifies a package whose entry points all import, including a JSON export", () => {
    dual()
    const { report, status } = run()
    expect(report).toEqual({ ok: true, state: "verified", checked: 2, problems: [], skipped: [] })
    expect(status).toBe(0)
  })
  it("fails an entry point that throws when imported, and exits non-zero only under --strict", () => {
    dual()
    put("index.js", 'throw new Error("boom at import")\n')
    const loose = run()
    expect(loose.report["state"]).toBe("problem")
    expect(loose.report["problems"]).toEqual(["fixture-pkg (import) failed: Error: boom at import"])
    expect(loose.status).toBe(0)
    expect(run("--strict").status).toBe(1)
  })
  it("fails a CommonJS entry that cannot be required", () => {
    dual()
    put("index.cjs", 'throw new Error("cjs boom")\n')
    expect(run().report["problems"]).toEqual(["fixture-pkg (require) failed: Error: cjs boom"])
  })
  it("reports a file the manifest promises that the tarball lacks", () => {
    dual()
    manifest({
      type: "module",
      exports: { ".": "./index.js", "./gone": "./gone.js" },
      files: ["index.js"],
    })
    const problems = run().report["problems"] as string[]
    expect(problems).toContain("gone.js is promised by package.json but is not in the tarball.")
  })
  it("skips an entry that needs a declared peer dependency", () => {
    dual()
    manifest({
      type: "module",
      exports: { ".": "./index.js", "./plugin": "./plugin.js" },
      files: ["index.js", "plugin.js"],
      peerDependencies: { "not-installed-peer": "^1" },
      peerDependenciesMeta: { "not-installed-peer": { optional: true } },
    })
    put("plugin.js", 'import "not-installed-peer"\n')
    const { report } = run()
    expect(report["state"]).toBe("verified")
    expect(report["skipped"]).toEqual([
      "fixture-pkg/plugin (import) needs the peer dependency not-installed-peer.",
    ])
  })
  it("checks the tarball it is given instead of packing one", () => {
    dual()
    const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], {
      cwd: dir,
      encoding: "utf8",
      // Windows cannot start npm.cmd without a shell.
      shell: process.platform === "win32",
    })
    const tarball = packed.stdout.trim().split("\n").at(-1) ?? ""
    put("index.js", 'throw new Error("changed after packing")\n')
    expect(run("--tarball", path.join(dir, tarball)).report["state"]).toBe("verified")
    expect(run("--tarball", path.join(dir, "absent.tgz")).report).toMatchObject({
      state: "problem",
      problems: [`no tarball to check at ${path.join(dir, "absent.tgz")}.`],
    })
  })
  it("says the install failed when a dependency cannot be fetched", () => {
    dual()
    manifest({
      type: "module",
      exports: { ".": "./index.js" },
      files: ["index.js"],
      dependencies: { "ipc-test-package-that-does-not-exist-9f3a": "1.0.0" },
    })
    const { report } = run()
    expect(report["state"]).toBe("install-failed")
    expect(typeof report["message"]).toBe("string")
  })
})

const reasonOf = (output: string) => {
  const verdict = classifyFailure(output, {})
  return verdict.kind === "broken" ? verdict.reason : undefined
}

describe("plan -- conditions, maps and paths", () => {
  it("finds a require condition inside a fallback array", () => {
    expect(
      entryPoints({ name: "p", exports: { ".": [{ require: "./i.cjs" }, "./i.js"] } })[0]?.require,
    ).toBe(true)
    expect(entryPoints({ name: "p", exports: { ".": ["./i.js"] } })[0]?.require).toBe(false)
    expect(entryPoints({ name: "p", exports: { ".": "./i.js" } })[0]?.require).toBe(false)
    expect(
      entryPoints({ name: "p", exports: { ".": null, "./a": "./a.js" } }).map((e) => e.specifier),
    ).toEqual(["p/a"])
  })
  it("treats an object with any dotted key as a subpath map, and one without as conditions", () => {
    expect(
      entryPoints({ name: "p", exports: { ".": "./i.js", import: "./x.js" } }).map(
        (e) => e.specifier,
      ),
    ).toEqual(["p", "p/port"])
    expect(
      entryPoints({ name: "p", exports: { import: "./i.mjs" } }).map((e) => e.specifier),
    ).toEqual(["p"])
    expect(
      entryPoints({ name: "p", exports: ["./i.js", "./j.js"] }).map((e) => e.specifier),
    ).toEqual(["p"])
    expect(entryPoints({ name: "p", exports: "./i.js" }).map((e) => e.specifier)).toEqual(["p"])
  })
  it("recognises a subpath map that has no root entry", () => {
    expect(
      entryPoints({ name: "p", exports: { "./only": "./o.js" } }).map((e) => e.specifier),
    ).toEqual(["p/only"])
  })
  it("searches fallback arrays and nested objects for a condition, and nothing else", () => {
    expect(
      entryPoints({
        name: "p",
        exports: { ".": ["./a.js", { default: { require: "./c.cjs" } }] },
      })[0]?.require,
    ).toBe(true)
    expect(entryPoints({ name: "p", exports: { ".": { default: "./a.js" } } })[0]?.require).toBe(
      false,
    )
    expect(entryPoints({ name: "p", exports: { ".": "require" } })[0]?.require).toBe(false)
    expect(entryPoints({ name: "p", exports: { ".": ["require"] } })[0]?.require).toBe(false)
  })
  it("strips only a leading ./ from a promised file", () => {
    expect(promisedFiles({ exports: "./dist/./x.js" })).toEqual(["dist/./x.js"])
    expect(promisedFiles({ exports: "a./b.js" })).toEqual(["a./b.js"])
  })
  it("reads an error name anywhere in a line, and prefers the line that names one", () => {
    expect(classifyFailure("note\n  at x\nRangeError: too big", {})).toEqual({
      kind: "broken",
      reason: "RangeError: too big",
    })
    expect(reasonOf("some Error: here")).toBe("some Error: here")
    expect(reasonOf("first\nsecond")).toBe("first")
  })
  it("ignores blank lines when choosing the reason", () => {
    expect(reasonOf("\n\n   \nreal line")).toBe("real line")
  })
  it("does not treat a package that merely shares a peer's prefix as that peer", () => {
    expect(
      classifyFailure("Cannot find package 'eslint-plugin-x' imported", {
        peerDependencies: { eslint: "^9" },
      }).kind,
    ).toBe("broken")
  })
})

describe("packedConsumerCheck (policy) -- exact results", () => {
  it("passes exempt and none with a pass outcome", async () => {
    expect(await judge({ ok: true, state: "exempt" })).toEqual({
      outcome: "pass",
      rationale: "PackedConsumer: this package is private, so there is nothing to publish.",
    })
    expect(await judge({ ok: true, state: "none" })).toEqual({
      outcome: "pass",
      rationale: "PackedConsumer: package.json declares no entry point for a consumer to import.",
    })
  })
  it("reads omitted fields as empty", async () => {
    expect((await judge({ ok: true, state: "verified" })).rationale).toBe(
      "PackedConsumer: the packed tarball installs into a clean project and all 0 entry point(s) import.",
    )
    expect((await judge({ ok: true, state: "problem" })).rationale).toBe(
      "PackedConsumer: the package that would be published does not work for a consumer (0 problem(s)):",
    )
    expect(
      (await judge({ ok: true, state: "install-failed" })).rationale.endsWith(
        "clean project, so its entry points were not imported:\n",
      ),
    ).toBe(true)
  })
  it("accepts a failed install a complete environment record covers, read from the supplied directory", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ipc-packed-env-"))
    try {
      mkdirSync(path.join(dir, ".repo-contract", "exceptions"), { recursive: true })
      const record = {
        id: "environment:PackedConsumer:install",
        version: 2,
        justification: "The registry is unreachable from this sandbox.",
        check: "PackedConsumer",
        code: "install",
        ruleBroken: "r",
        attempted: "a",
        constraint: "c",
        whyPreferable: "w",
        residualRisk: "x",
        revisitWhen: "v",
        expires: "",
      }
      writeFileSync(
        path.join(dir, ".repo-contract", "exceptions", "environment.json"),
        JSON.stringify({ exceptions: [record] }),
      )
      const accepted = await packedConsumerCheck({ cwd: dir }).policy(
        makeContext(makeJsonResult({ ok: true, state: "install-failed", message: "offline" })),
      )
      const unaccepted = await packedConsumerCheck({ cwd: tmpdir() }).policy(
        makeContext(makeJsonResult({ ok: true, state: "install-failed", message: "offline" })),
      )
      expect(accepted.outcome).toBe("warn")
      expect(accepted.rationale).not.toBe(unaccepted.rationale)
      expect(accepted.rationale).toContain("environment:PackedConsumer:install")
      expect(accepted.rationale).not.toContain("add or complete")
      expect(unaccepted.rationale).toContain("add or complete")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** One tar entry: a 512-byte ustar header followed by the data, padded to a whole block. */
function entry(name: string, body = "", options: { type?: string; prefix?: string } = {}): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, "utf8")
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, "latin1")
  header.write(options.type ?? "0", 156, "latin1")
  if (options.prefix !== undefined) header.write(options.prefix, 345, "utf8")
  const data = Buffer.from(body, "utf8")
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)])
}
const tarball = (...entries: Buffer[]) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))

describe("tarballFiles", () => {
  it("lists each file without the leading package/ directory", () => {
    expect(
      tarballFiles(
        tarball(
          entry("package/package.json", "{}"),
          entry("package/dist/index.js", "x".repeat(600)),
        ),
      ),
    ).toEqual(["package.json", "dist/index.js"])
  })
  it("joins a ustar prefix to the name", () => {
    expect(tarballFiles(tarball(entry("index.js", "", { prefix: "package/dist/deep" })))).toEqual([
      "dist/deep/index.js",
    ])
  })
  it("uses the path from a pax extended header for the next file only", () => {
    const record = "path=package/dist/very/long/name.js"
    const extended = entry("pax", `${String(record.length + 4)} ${record}\n`, { type: "x" })
    expect(
      tarballFiles(tarball(extended, entry("short", "data"), entry("package/after.js"))),
    ).toEqual(["dist/very/long/name.js", "after.js"])
  })
  it("skips directories and other entry types", () => {
    expect(
      tarballFiles(tarball(entry("package/dist/", "", { type: "5" }), entry("package/a.js"))),
    ).toEqual(["a.js"])
  })
  it("treats a NUL type as a regular file, and an empty archive as no files", () => {
    expect(tarballFiles(tarball(entry("package/a.js", "", { type: "\0" })))).toEqual(["a.js"])
    expect(tarballFiles(gzipSync(Buffer.alloc(1024)))).toEqual([])
    expect(tarballFiles(gzipSync(Buffer.alloc(0)))).toEqual([])
  })
  it("reads a final entry that has only its header and no end marker after it", () => {
    expect(tarballFiles(gzipSync(entry("package/a.js")))).toEqual(["a.js"])
  })
  it("ends a name at the first NUL even when text follows it", () => {
    expect(tarballFiles(tarball(entry("package/a.js\0 junk")))).toEqual(["a.js"])
  })
  it("keeps a package/ that is not the leading directory", () => {
    expect(tarballFiles(tarball(entry("package/dist/package/a.js")))).toEqual(["dist/package/a.js"])
  })
  it("reads an extended header that is not the first entry", () => {
    const record = "path=package/dist/late.js"
    const extended = entry("pax", `${String(record.length + 4)} ${record}\n`, { type: "x" })
    expect(
      tarballFiles(tarball(entry("package/first.js", "abc"), extended, entry("short"))),
    ).toEqual(["first.js", "dist/late.js"])
  })
  it("strips package/ only at the start of a path", () => {
    expect(tarballFiles(tarball(entry("dist/package/a.js")))).toEqual(["dist/package/a.js"])
  })
  it("ignores an extended header that names no path", () => {
    const extended = entry("pax", "14 comment=none\n", { type: "x" })
    expect(tarballFiles(tarball(extended, entry("package/a.js")))).toEqual(["a.js"])
  })
  it("does not loop on an entry whose size is not a number", () => {
    const broken = entry("package/a.js")
    broken.write("zzzzzzzzzzz\0", 124, "latin1")
    expect(tarballFiles(tarball(broken))).toEqual(["a.js"])
  })
  it("ends cleanly on an archive cut off in the middle of a header", () => {
    const whole = gzipSync(Buffer.concat([entry("package/a.js"), Buffer.alloc(100, 1)]))
    expect(tarballFiles(whole)).toEqual(["a.js"])
  })
  it("stops at the end-of-archive marker", () => {
    expect(
      tarballFiles(
        gzipSync(
          Buffer.concat([entry("package/a.js"), Buffer.alloc(1024), entry("package/ignored.js")]),
        ),
      ),
    ).toEqual(["a.js"])
  })
  it("reads what npm itself packed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ipc-tarball-"))
    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "t", version: "1.0.0", files: ["a.js", "lib"] }),
      )
      writeFileSync(path.join(dir, "a.js"), "1")
      mkdirSync(path.join(dir, "lib"))
      writeFileSync(path.join(dir, "lib", "b.js"), "2")
      const packed = spawnSync(
        "npm",
        ["pack", "--json", "--ignore-scripts", "--pack-destination", dir],
        {
          cwd: dir,
          encoding: "utf8",
          shell: process.platform === "win32",
        },
      )
      const [report] = JSON.parse(packed.stdout) as {
        filename: string
        files: { path: string }[]
      }[]
      const listed = tarballFiles(readFileSync(path.join(dir, report?.filename ?? "")))
      expect(listed.sort()).toEqual((report?.files ?? []).map((file) => file.path).sort())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
