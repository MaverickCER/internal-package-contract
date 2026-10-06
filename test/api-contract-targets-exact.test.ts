import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  exportedApiSubpaths,
  readTargets,
  subpathForEntryPoint,
  targetNameFromEntryPoint,
} from "../scripts/api-contract/targets.js"

describe("exportedApiSubpaths in detail", () => {
  it("finds types at any depth under a subpath, and only a string `types`", () => {
    expect(
      exportedApiSubpaths({
        "./deep": { node: { import: { types: "./a.d.ts" } } },
        "./shallow": { types: "./b.d.ts" },
        "./objectTypes": { types: { nested: 1 } },
        "./numberTypes": { types: 5 },
        "./other": { import: "./c.js", require: "./c.cjs" },
        "./stringOnly": "./d.d.ts",
        "./nullish": null,
      }),
    ).toEqual(["./deep", "./shallow"])
  })

  it("keeps only keys that start with a dot and contain no star", () => {
    expect(
      exportedApiSubpaths({
        types: { types: "./x.d.ts" },
        main: { types: "./x.d.ts" },
        "./a*b": { types: "./x.d.ts" },
        "./ok": { types: "./x.d.ts" },
        ".": { types: "./x.d.ts" },
      }),
    ).toEqual(["./ok", "."])
  })

  it("returns nothing for an exports map that is a string, an array or missing", () => {
    expect(exportedApiSubpaths("./x.js")).toEqual([])
    expect(exportedApiSubpaths(undefined)).toEqual([])
    expect(exportedApiSubpaths(null)).toEqual([])
    expect(exportedApiSubpaths(5)).toEqual([])
  })
})

describe("target names", () => {
  it.each([
    ["src/index.ts", "index", "."],
    ["./src/index.ts", "index", "."],
    ["/src/index.ts", "index", "."],
    ["src/index.tsx", "index", "."],
    ["src/build/index.ts", "build", "./build"],
    ["./src/build/index.tsx", "build", "./build"],
    ["src/build.ts", "build", "./build"],
    ["src/runtime/cache.ts", "runtime/cache", "./runtime/cache"],
    ["src/a/b/index.ts", "a/b", "./a/b"],
    ["lib/src/x.ts", "lib/src/x", "./lib/src/x"],
    ["index.ts", "index", "."],
    ["src/.ts", "index", "."],
    ["src/a.ts.ts", "a.ts", "./a.ts"],
    ["src/x/index.tsx.bak", "x/index.tsx.bak", "./x/index.tsx.bak"],
    ["src/a.tsx", "a", "./a"],
    ["srcx/a.ts", "srcx/a", "./srcx/a"],
  ])("%s is the target %s and the subpath %s", (entry, name, subpath) => {
    expect(targetNameFromEntryPoint(entry)).toBe(name)
    expect(subpathForEntryPoint(entry)).toBe(subpath)
  })
})

describe("readTargets in detail", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ipc-targets-exact-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const write = (name: string, value: unknown) =>
    writeFileSync(path.join(root, name), typeof value === "string" ? value : JSON.stringify(value))
  const typed = (n: string) => ({ import: { types: `./dist/${n}.d.ts` } })

  it("maps each entry point to its built declaration, dropping only a leading src and a final extension", async () => {
    write("typedoc.json", {
      entryPoints: [
        "src/index.ts",
        "./src/a/index.tsx",
        "/src/b.ts",
        "lib/src/c.ts",
        "src/d.ts.ts",
      ],
    })
    expect(await readTargets(root)).toEqual([
      { name: "index", mainEntryPointFilePath: "dist/.dts/index.d.ts" },
      { name: "a", mainEntryPointFilePath: "dist/.dts/a/index.d.ts" },
      { name: "b", mainEntryPointFilePath: "dist/.dts/b.d.ts" },
      { name: "lib/src/c", mainEntryPointFilePath: "lib/src/c.d.ts" },
      { name: "d.ts", mainEntryPointFilePath: "dist/.dts/d.ts.d.ts" },
    ])
  })

  it("keeps the underlying error as the cause of a read or parse failure", async () => {
    const missing = await readTargets(root).catch((e: Error) => e)
    expect((missing as Error).cause).toBeInstanceOf(Error)
    expect((missing as Error).message).toBe(
      `Could not read ${path.join(root, "typedoc.json")} -- the api-contract check derives its target entry points from typedoc.json's own "entryPoints".`,
    )
    write("typedoc.json", "{ nope")
    const broken = await readTargets(root).catch((e: Error) => e)
    expect((broken as Error).cause).toBeInstanceOf(SyntaxError)
    expect((broken as Error).message).toBe(`${path.join(root, "typedoc.json")} is not valid JSON.`)
  })

  it("rejects entryPoints that are missing, not an array, or not all strings, with the exact message", async () => {
    const message = `${path.join(root, "typedoc.json")} must declare a non-empty "entryPoints" array of strings.`
    for (const config of [
      {},
      { entryPoints: "src/index.ts" },
      { entryPoints: [] },
      { entryPoints: [1] },
    ]) {
      write("typedoc.json", config)
      await expect(readTargets(root)).rejects.toThrow(message)
    }
  })

  it("explains every disagreement between exports and entry points, one line each", async () => {
    write("typedoc.json", { entryPoints: ["src/internal/index.ts"] })
    write("package.json", {
      exports: { ".": typed("index"), "./build": typed("build"), "./a/b": typed("ab") },
    })
    const error = await readTargets(root).catch((e: Error) => e)
    expect((error as Error).message).toBe(
      [
        "The package's public exports and the API contract's targets disagree:",
        `- package.json exports ".", but no typedoc.json entry point documents it (add one, e.g. "src/index.ts"), so its API is not guarded by the api-contract check.`,
        `- package.json exports "./build", but no typedoc.json entry point documents it (add one, e.g. "src/build/index.ts"), so its API is not guarded by the api-contract check.`,
        `- package.json exports "./a/b", but no typedoc.json entry point documents it (add one, e.g. "src/a/b/index.ts"), so its API is not guarded by the api-contract check.`,
        `- typedoc.json documents "src/internal/index.ts", which no package.json export serves (export it, or map it with package.json "internal-package-contract": { "apiTargets": { "<subpath>": "src/internal/index.ts" } }).`,
      ].join("\n"),
    )
  })

  it("passes when the exports map is empty of typed subpaths, and when package.json is unreadable", async () => {
    write("typedoc.json", { entryPoints: ["src/index.ts"] })
    write("package.json", { exports: { "./schema": "./s.json" } })
    expect(await readTargets(root)).toHaveLength(1)
    write("package.json", "{ nope")
    expect(await readTargets(root)).toHaveLength(1)
  })

  it("reads a unicode config as text", async () => {
    write("typedoc.json", { entryPoints: ["src/é.ts"] })
    expect((await readTargets(root))[0]?.name).toBe("é")
  })
})
