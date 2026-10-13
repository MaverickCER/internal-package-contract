import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  createAliasResolutionCache,
  loadTsconfigPaths,
  pathMappingOptions,
  resolveAliasImport,
  typescriptPath,
} from "../runtime/resolve-tsconfig-paths.js"
import type { BuildFileSystem } from "../runtime/build-fs.js"

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "ipc-resolve-tsconfig-paths-"))
const nodeBuildFs: BuildFileSystem = {
  readFile: (p, encoding) => fs.readFile(p, encoding),
  writeFile: (p, data, encoding) => fs.writeFile(p, data, encoding),
  mkdir: async (p, options) => {
    await fs.mkdir(p, options)
  },
  readdir: (p, options) => fs.readdir(p, options),
  stat: (p) => fs.stat(p),
  realpath: (p) => fs.realpath(p),
}

async function writeJson(relativePath: string, value: unknown): Promise<string> {
  const filePath = path.join(fixtureRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
  return filePath
}

async function writeFile(relativePath: string, content: string): Promise<string> {
  const filePath = path.join(fixtureRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
  return filePath
}

beforeAll(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true })

  // Scenario: default auto-detection finds `root/tsconfig.json`.
  await writeJson("default-autodetect/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  })
  await writeFile("default-autodetect/src/env.schema.ts", "export const a = 1;\n")

  // Scenario: no tsconfig.json at all -- default auto-detection must be silent.
  await fs.mkdir(path.join(fixtureRoot, "no-tsconfig"), { recursive: true })

  // Scenario: explicit override path.
  await writeJson("explicit-override/custom.tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  })

  // Scenario: malformed JSON. NOTE: a truncated-but-tolerated fixture like
  // `{ "compilerOptions": ` is silently accepted by `ts.readConfigFile()`
  // (parsed as if the dangling key were absent) and hits the "no paths"
  // path instead of `readResult.error` -- the same gotcha data-cap's
  // identical file already documented. This needs to be genuinely
  // unparseable JSON.
  await writeFile("malformed/tsconfig.json", "}}}} not json {{{{")

  // Scenario: tsconfig.json with neither `paths` nor `baseUrl`.
  await writeJson("no-paths/tsconfig.json", { compilerOptions: { target: "ES2020" } })

  // Scenario: `paths` is present but declares zero entries (distinct from
  // `paths` being entirely absent -- `paths !== undefined` alone doesn't
  // short-circuit here, `Object.keys(paths).length > 0` genuinely has to run).
  await writeJson("empty-paths/tsconfig.json", { compilerOptions: { paths: {} } })

  // Scenario: `paths` is genuinely non-empty, with NO `baseUrl` at all --
  // distinguishes `hasPaths` actually being computed `true` from a
  // (wrongly) hardcoded `false`: with no `baseUrl` to fall back on, only a
  // correctly-computed `hasPaths` makes `loadTsconfigPaths("demo-pkg", )` build a
  // resolution at all.
  await writeJson("paths-only-no-baseurl/tsconfig.json", {
    compilerOptions: { paths: { "@/*": ["src/*"] } },
  })

  // Scenario: `baseUrl` set with no `paths` at all.
  await writeJson("baseurl-only/tsconfig.json", { compilerOptions: { baseUrl: "." } })
  await writeFile("baseurl-only/src/env/schema.ts", "export const b = 1;\n")

  // Scenario: `extends` chain -- `paths` declared only in the base config.
  await writeJson("extends-chain/base.tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  })
  await writeJson("extends-chain/tsconfig.json", { extends: "./base.tsconfig.json" })
  await writeFile("extends-chain/src/env.schema.ts", "export const c = 1;\n")

  // Scenario: multiple fallback targets for one alias -- only the second exists.
  await writeJson("multi-fallback/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@env/*": ["generated/*", "src/*"] } },
  })
  await writeFile("multi-fallback/src/foo.ts", "export const d = 1;\n")

  // Scenario: a contrived alias resolving into node_modules -- must be discarded.
  await writeJson("node-modules-boundary/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@pkg/*": ["node_modules/@pkg/*"] } },
  })
  await writeFile("node-modules-boundary/node_modules/@pkg/foo.ts", "export const e = 1;\n")

  // Scenario: resolution caching.
  await writeJson("caching/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  })
  await writeFile("caching/src/foo.ts", "export const f = 1;\n")

  // Scenario: a cached resolution must survive the underlying file being
  // deleted after the first (real) resolution.
  await writeJson("cache-survives-deletion/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
  })
  await writeFile("cache-survives-deletion/src/foo.ts", "export const h = 1;\n")

  // Scenario: the resolved file's normalized path contains ".tsx" as a
  // DIRECTORY segment (`src.tsx/`), but its own real extension is ".js" --
  // distinguishes the anchored `/\.tsx?$/` from an anchor-less `/\.tsx?/`,
  // which would wrongly match the mid-path substring.
  await writeJson("tsx-anchor/tsconfig.json", {
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["src.tsx/*"] }, allowJs: true },
  })
  await writeFile("tsx-anchor/src.tsx/foo.js", "export const i = 1;\n")
})

afterAll(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true })
})

function root(name: string): string {
  return path.join(fixtureRoot, name)
}

describe("typescriptPath", () => {
  it("writes a path with / for the compiler, whatever separator the platform uses", () => {
    expect(typescriptPath("C:\\Users\\me\\app\\tsconfig.json", "\\")).toBe(
      "C:/Users/me/app/tsconfig.json",
    )
    expect(typescriptPath("/home/me/app/tsconfig.json", "/")).toBe("/home/me/app/tsconfig.json")
    // Only the platform's own separator is one; a backslash in a name on another platform is part of the name.
    expect(typescriptPath("/home/a\\b/tsconfig.json", "/")).toBe("/home/a\\b/tsconfig.json")
  })
})

describe("loadTsconfigPaths", () => {
  it("auto-detects root/tsconfig.json by default", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("default-autodetect"),
      undefined,
      nodeBuildFs,
    )
    expect(warning).toBeUndefined()
    expect(resolution).toBeDefined()
    expect(resolution?.configFile).toBe(path.join(root("default-autodetect"), "tsconfig.json"))
  })

  it("is silent when no tsconfig.json exists and no explicit path was given", async () => {
    const result = await loadTsconfigPaths("demo-pkg", root("no-tsconfig"), undefined, nodeBuildFs)
    expect(result).toStrictEqual({ resolution: undefined, warning: undefined })
  })

  it("resolves an explicit override path relative to root", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("explicit-override"),
      "custom.tsconfig.json",
      nodeBuildFs,
    )
    expect(warning).toBeUndefined()
    expect(resolution).toBeDefined()
    expect(resolution?.configFile).toBe(
      path.join(root("explicit-override"), "custom.tsconfig.json"),
    )
  })

  it("warns when an explicit override path doesn't exist", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("no-tsconfig"),
      "missing.json",
      nodeBuildFs,
    )
    expect(resolution).toBeUndefined()
    expect(warning).toBeDefined()
    expect(warning?.message).toContain("missing.json")
  })

  it("disables alias resolution entirely when tsconfig: false", async () => {
    const result = await loadTsconfigPaths(
      "demo-pkg",
      root("default-autodetect"),
      false,
      nodeBuildFs,
    )
    expect(result).toStrictEqual({ resolution: undefined, warning: undefined })
  })

  it("warns on malformed JSON, with the exact configFile path and a real parse-error detail in the message", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("malformed"),
      undefined,
      nodeBuildFs,
    )
    expect(resolution).toBeUndefined()
    expect(warning?.message).toContain("Could not parse")
    expect(warning?.message).toContain(path.join(root("malformed"), "tsconfig.json"))
  })

  it("is a no-op, without warning, when the tsconfig declares neither paths nor baseUrl", async () => {
    const result = await loadTsconfigPaths("demo-pkg", root("no-paths"), undefined, nodeBuildFs)
    expect(result).toStrictEqual({ resolution: undefined, warning: undefined })
  })

  it("is a no-op when paths is present but declares no entries at all, and no baseUrl either", async () => {
    const result = await loadTsconfigPaths("demo-pkg", root("empty-paths"), undefined, nodeBuildFs)
    expect(result).toStrictEqual({ resolution: undefined, warning: undefined })
  })

  it("builds a resolution for a genuinely non-empty paths, even with no baseUrl at all", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("paths-only-no-baseurl"),
      undefined,
      nodeBuildFs,
    )
    expect(warning).toBeUndefined()
    expect(resolution).toBeDefined()
    expect(resolution?.compilerOptions.paths).toBeDefined()
  })

  it("builds a resolution for a baseUrl-only tsconfig with no paths at all", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("baseurl-only"),
      undefined,
      nodeBuildFs,
    )
    expect(warning).toBeUndefined()
    expect(resolution).toBeDefined()
    const options = resolution?.compilerOptions
    expect(options && pathMappingOptions(options).baseUrl).toBeDefined()
  })

  it("resolves paths declared only through an extends chain", async () => {
    const { resolution, warning } = await loadTsconfigPaths(
      "demo-pkg",
      root("extends-chain"),
      undefined,
      nodeBuildFs,
    )
    expect(warning).toBeUndefined()
    expect(resolution).toBeDefined()
    expect(resolution?.compilerOptions.paths).toBeDefined()
  })
})

describe("resolveAliasImport", () => {
  it("resolves a bare specifier via `paths`", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("default-autodetect"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("default-autodetect"), "consumer.ts")
    const resolved = resolveAliasImport("@/env.schema.js", importingFile, resolution!, cache)
    expect(resolved).toBe(path.join(root("default-autodetect"), "src/env.schema.ts"))
  })

  it("resolves a bare specifier via `baseUrl` alone, with no `paths` configured", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("baseurl-only"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("baseurl-only"), "consumer.ts")
    const resolved = resolveAliasImport("src/env/schema.js", importingFile, resolution!, cache)
    expect(resolved).toBe(path.join(root("baseurl-only"), "src/env/schema.ts"))
  })

  it("resolves the first existing target among multiple fallback paths for one alias", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("multi-fallback"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("multi-fallback"), "consumer.ts")
    const resolved = resolveAliasImport("@env/foo.js", importingFile, resolution!, cache)
    // "generated/foo.ts" doesn't exist; "src/foo.ts" does -- ts.resolveModuleName()
    // must fall through to the second target, exactly like tsc itself would.
    expect(resolved).toBe(path.join(root("multi-fallback"), "src/foo.ts"))
  })

  it("discards a resolution that lands inside node_modules -- that's ADR 0014's mechanism, not this one's", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("node-modules-boundary"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("node-modules-boundary"), "consumer.ts")
    const resolved = resolveAliasImport("@pkg/foo.js", importingFile, resolution!, cache)
    expect(resolved).toBeUndefined()
  })

  it("returns undefined for a specifier that doesn't resolve to any real file", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("default-autodetect"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("default-autodetect"), "consumer.ts")
    const resolved = resolveAliasImport("@/does-not-exist.js", importingFile, resolution!, cache)
    expect(resolved).toBeUndefined()
  })

  it("memoizes repeated resolution of the same (importingFile, specifier) pair", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("caching"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("caching"), "consumer.ts")

    const first = resolveAliasImport("@/foo.js", importingFile, resolution!, cache)
    expect(cache.resolutions.size).toBe(1)

    const second = resolveAliasImport("@/foo.js", importingFile, resolution!, cache)
    // Same (importingFile, specifier) pair -- served from cache, no new entry.
    expect(cache.resolutions.size).toBe(1)
    expect(first).toBe(second)

    resolveAliasImport("@/does-not-exist.js", importingFile, resolution!, cache)
    // A distinct specifier is a distinct cache key, including the `undefined` miss.
    expect(cache.resolutions.size).toBe(2)
  })

  it("a cached resolution survives the underlying file being deleted afterward", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("cache-survives-deletion"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("cache-survives-deletion"), "consumer.ts")

    const first = resolveAliasImport("@/foo.js", importingFile, resolution!, cache)
    expect(first).toBe(path.join(root("cache-survives-deletion"), "src/foo.ts"))

    await fs.rm(path.join(root("cache-survives-deletion"), "src/foo.ts"))

    const second = resolveAliasImport("@/foo.js", importingFile, resolution!, cache)
    expect(second).toBe(first)
  })

  it("rejects a resolved file whose real extension is .js, even though its directory is literally named 'src.tsx'", async () => {
    const { resolution } = await loadTsconfigPaths(
      "demo-pkg",
      root("tsx-anchor"),
      undefined,
      nodeBuildFs,
    )
    const cache = createAliasResolutionCache()
    const importingFile = path.join(root("tsx-anchor"), "consumer.ts")
    const resolved = resolveAliasImport("@/foo.js", importingFile, resolution!, cache)
    expect(resolved).toBeUndefined()
  })
})

describe("when no usable compiler resolved", () => {
  it("names the consuming package, and only once a tsconfig exists to read", async () => {
    vi.resetModules()
    vi.doMock("../runtime/typescript.js", () => ({ ts: {} }))
    try {
      const unusable = await import("../runtime/resolve-tsconfig-paths.js")
      await expect(
        unusable.loadTsconfigPaths("demo-pkg", root("default-autodetect"), undefined, nodeBuildFs),
      ).rejects.toThrow(/^demo-pkg's build-time scanner/)
      await expect(
        unusable.loadTsconfigPaths("demo-pkg", root("no-tsconfig"), undefined, nodeBuildFs),
      ).resolves.toEqual({ resolution: undefined, warning: undefined })
    } finally {
      vi.doUnmock("../runtime/typescript.js")
      vi.resetModules()
    }
  })
})
