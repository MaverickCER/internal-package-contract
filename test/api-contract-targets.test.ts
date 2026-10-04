import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  compareExportsToEntryPoints,
  exportedApiSubpaths,
  readTargets,
  subpathForEntryPoint,
  targetNameFromEntryPoint,
} from "../scripts/api-contract/targets.js"

const typed = (name: string) => ({
  import: { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` },
  require: { types: `./dist/${name}.d.cts`, default: `./dist/${name}.cjs` },
})

describe("exportedApiSubpaths()", () => {
  it("lists every subpath that exposes types, and nothing that is just a file or a pattern", () => {
    expect(
      exportedApiSubpaths({
        ".": typed("index"),
        "./build": typed("build"),
        "./schema": "./schemas/report.schema.json",
        "./schema/*": "./schemas/*.schema.json",
        "./package.json": "./package.json",
        "./pattern/*": { types: "./dist/*.d.ts" },
        "./untyped": { default: "./dist/untyped.js" },
        "./direct": { types: "./dist/direct.d.ts" },
      }),
    ).toEqual([".", "./build", "./direct"])
  })

  it("is empty for a package with no exports map (or a non-object one)", () => {
    expect(exportedApiSubpaths(undefined)).toEqual([])
    expect(exportedApiSubpaths(null)).toEqual([])
    expect(exportedApiSubpaths("./index.js")).toEqual([])
  })
})

describe("subpathForEntryPoint() / targetNameFromEntryPoint()", () => {
  it("names the root, a directory entry and a file entry", () => {
    expect(subpathForEntryPoint("src/index.ts")).toBe(".")
    expect(subpathForEntryPoint("./src/build/index.ts")).toBe("./build")
    expect(subpathForEntryPoint("src/runtime/cache.ts")).toBe("./runtime/cache")
    expect(targetNameFromEntryPoint("src/index.ts")).toBe("index")
  })
})

describe("compareExportsToEntryPoints()", () => {
  it("is clean when every export has an entry point and every entry point is exported", () => {
    expect(
      compareExportsToEntryPoints(["src/index.ts", "src/build/index.ts"], [".", "./build"]),
    ).toEqual({
      unguarded: [],
      unexported: [],
    })
  })

  it("names the exports no entry point guards, and the entry points nothing exports", () => {
    expect(
      compareExportsToEntryPoints(
        ["src/build/index.ts", "src/internal/index.ts"],
        [".", "./build", "./node"],
      ),
    ).toEqual({ unguarded: [".", "./node"], unexported: ["src/internal/index.ts"] })
  })

  it("lets an alias say which entry point serves a subpath named differently", () => {
    expect(
      compareExportsToEntryPoints(["src/runtime/index.ts"], ["."], { ".": "src/runtime/index.ts" }),
    ).toEqual({ unguarded: [], unexported: [] })
  })
})

describe("readTargets()", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ipc-targets-"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const write = (name: string, value: unknown) =>
    writeFileSync(path.join(root, name), typeof value === "string" ? value : JSON.stringify(value))

  it("derives one target per typedoc entry point, mapped to the built declaration shims", async () => {
    write("typedoc.json", { entryPoints: ["src/index.ts", "src/build/index.ts"] })
    write("package.json", {
      name: "p",
      exports: { ".": typed("index"), "./build": typed("build") },
    })
    expect(await readTargets(root)).toEqual([
      { name: "index", mainEntryPointFilePath: "dist/.dts/index.d.ts" },
      { name: "build", mainEntryPointFilePath: "dist/.dts/build/index.d.ts" },
    ])
  })

  it("refuses a package whose export no target guards, naming what to add", async () => {
    write("typedoc.json", { entryPoints: ["src/index.ts"] })
    write("package.json", { name: "p", exports: { ".": typed("index"), "./node": typed("node") } })
    await expect(readTargets(root)).rejects.toThrow(
      /package\.json exports "\.\/node", but no typedoc\.json entry point documents it/,
    )
  })

  it("refuses a documented entry point that nothing exports", async () => {
    write("typedoc.json", { entryPoints: ["src/index.ts", "src/internal/index.ts"] })
    write("package.json", { name: "p", exports: { ".": typed("index") } })
    await expect(readTargets(root)).rejects.toThrow(/documents "src\/internal\/index\.ts"/)
  })

  it("accepts an alias from package.json for an entry point not named after its subpath", async () => {
    write("typedoc.json", { entryPoints: ["src/runtime/index.ts"] })
    write("package.json", {
      name: "p",
      exports: { ".": typed("index") },
      "internal-package-contract": { apiTargets: { ".": "src/runtime/index.ts" } },
    })
    expect(await readTargets(root)).toHaveLength(1)
  })

  it("does not require an exports map, or a readable package.json", async () => {
    write("typedoc.json", { entryPoints: ["src/index.ts"] })
    expect(await readTargets(root)).toHaveLength(1)
    write("package.json", { name: "p" })
    expect(await readTargets(root)).toHaveLength(1)
  })

  it("reports a missing, unparseable or empty typedoc.json", async () => {
    await expect(readTargets(root)).rejects.toThrow(/Could not read .*typedoc\.json/)
    write("typedoc.json", "{ not json")
    await expect(readTargets(root)).rejects.toThrow(/is not valid JSON/)
    write("typedoc.json", { entryPoints: [] })
    await expect(readTargets(root)).rejects.toThrow(/non-empty "entryPoints"/)
    write("typedoc.json", { entryPoints: ["src/a.ts", 3] })
    await expect(readTargets(root)).rejects.toThrow(/non-empty "entryPoints"/)
  })
})
