import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ApiPackage } from "@microsoft/api-extractor-model"
import {
  loadApiModel,
  runApiExtractorForTarget,
} from "../scripts/api-contract/extractor-adapter.js"
import { normalizeApiPackage } from "../scripts/api-contract/model-normalizer.js"
import type { ReleaseTagLevel } from "../scripts/api-contract/model-normalizer.js"

const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)

const SOURCE = `/** @public */
export interface Base {
  id: string
}
/** @public */
export interface Marker {
  mark(): void
}
/** @public */
export interface Extended<T> extends Base {
  value?: T
  readonly tag: string
}
/** @public */
export interface Both extends Base, Marker {}
/** @public */
export class Root {
  root = true
}
/** @public */
export class Widget<T, U = T> extends Root implements Base, Marker {
  id = "w"
  maybe?: string
  readonly frozen: U | undefined = undefined
  constructor(public first: T, second?: number) {
    super()
    void second
  }
  mark(): void {}
  /** @deprecated use mark */
  old(): void {}
  run(input: string): string
  run(input: number, flag?: boolean): number
  run(input: string | number, flag?: boolean): string | number {
    void flag
    return input
  }
}
/** @public */
export class Plain {}
/** @public */
export enum Level {
  Unset,
  Low = 1,
  High = "high",
}
/** @public */
export type Handler<T> = (event: T) => void
/** @public */
export const LIMIT: number = 10
/** @public */
export let counter: string = ""
/** @public */
export namespace NS {
  /** @public */
  export function inner(a: string): void {
    void a
  }
  /** @public */
  export const k: 1 = 1
}
/** @public */
export function usesPrivate(): Private {
  return { x: 1 }
}
interface Private {
  x: number
}
/** @beta */
export function betaFn(): void {}
/** @alpha */
export function alphaFn(): void {}
/** @internal */
export function _internalFn(): void {}
export function untagged(): void {}
`

let root: string
let pkg: ApiPackage

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-normalizer-"))
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  write("package.json", JSON.stringify({ name: "fx", version: "1.0.0", type: "module" }))
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "dist/.dts",
        rootDir: "src",
        skipLibCheck: true,
      },
      include: ["src"],
    }),
  )
  write("src/index.ts", SOURCE)
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
  const result = runApiExtractorForTarget(root, {
    name: "index",
    mainEntryPointFilePath: "dist/.dts/index.d.ts",
  })
  expect(result.succeeded).toBe(true)
  pkg = loadApiModel(result.apiJsonFilePath).pkg
}, 120_000)

afterAll(() => rmSync(root, { recursive: true, force: true }))

const normalized = (threshold: ReleaseTagLevel) =>
  `${JSON.stringify([...normalizeApiPackage(pkg, threshold).values()], null, 2)}\n`

/** Walks every object in a parsed `.api.json`. */
function visitAll(node: unknown, visit: (object: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) visitAll(child, visit)
  } else if (typeof node === "object" && node !== null) {
    visit(node as Record<string, unknown>)
    for (const child of Object.values(node)) visitAll(child, visit)
  }
}

describe("normalizeApiPackage() over a hand-edited Doc Model", () => {
  it("drops an item that is not exported, and ignores empty excerpts", () => {
    const edited = JSON.parse(
      readFileSync(path.join(root, ".repo-contract/api-contract/index/current.api.json"), "utf8"),
    ) as unknown
    const empty = { startIndex: 0, endIndex: 0 }
    visitAll(edited, (object) => {
      if (object["name"] === "betaFn") object["canonicalReference"] = "fx!~betaFn:function(1)"
      if (object["kind"] === "Class" && object["name"] === "Widget") {
        object["implementsTokenRanges"] = [...(object["implementsTokenRanges"] as unknown[]), empty]
      }
      if (object["kind"] === "Interface" && object["name"] === "Extended") {
        object["extendsTokenRanges"] = [...(object["extendsTokenRanges"] as unknown[]), empty]
      }
      if (object["parameterName"] === "second") object["parameterTypeTokenRange"] = empty
      if (object["kind"] === "Content" && object["text"] === "boolean")
        object["text"] = "  boolean\n "
      if (object["kind"] === "Namespace") object["fileUrlPath"] = "src/ns.ts"
      if (object["kind"] === "Function" && object["name"] === "inner")
        object["fileUrlPath"] = "src/inner.ts"
      if (object["kind"] === "Variable" && object["name"] === "k") delete object["fileUrlPath"]
    })
    const file = path.join(root, "edited.api.json")
    writeFileSync(file, JSON.stringify(edited))
    const members = normalizeApiPackage(loadApiModel(file).pkg, "internal")

    expect([...members.values()].some((m) => m.scopedName === "betaFn()")).toBe(false)
    expect([...members.values()].some((m) => m.scopedName === "alphaFn()")).toBe(true)
    expect(members.get("fx!Widget:class")?.implementsExcerptTexts).toEqual(["Base", "Marker"])
    expect(members.get("fx!Extended:interface")?.extendsExcerptTexts).toEqual(["Base"])
    const run = [...members.values()].find(
      (m) => m.scopedName === "Widget.run()" && m.overloadIndex === 2,
    )
    expect(run?.parameters?.[1]).toEqual({
      name: "flag",
      isOptional: true,
      typeExcerptText: "boolean",
    })
    expect(members.get("fx!NS.inner:function(1)")?.fileUrlPath).toBe("src/inner.ts")
    expect([...members.values()].find((m) => m.scopedName === "NS.k")?.fileUrlPath).toBe(
      "src/ns.ts",
    )
    expect(members.get("fx!Widget:constructor(1)")?.parameters).toEqual([
      { name: "first", isOptional: false, typeExcerptText: "T" },
      { name: "second", isOptional: true, typeExcerptText: "" },
    ])
  })
})

describe("normalizeApiPackage()", () => {
  for (const threshold of ["public", "beta", "alpha", "internal"] as const) {
    it(`flattens every member at or above @${threshold}`, async () => {
      await expect(normalized(threshold)).toMatchFileSnapshot(
        `__snapshots__/model-normalizer-${threshold}.snap`,
      )
    })
  }

  it("admits more as the threshold widens, and never the containers themselves", () => {
    const counts = (["public", "beta", "alpha", "internal"] as const).map(
      (threshold) => normalizeApiPackage(pkg, threshold).size,
    )
    expect(counts[0]).toBeLessThan(counts[1] ?? 0)
    expect(counts[1]).toBeLessThan(counts[2] ?? 0)
    expect(counts[2]).toBeLessThan(counts[3] ?? 0)
    const kinds = new Set([...normalizeApiPackage(pkg, "internal").values()].map((m) => m.kind))
    for (const container of ["Model", "Package", "EntryPoint"])
      expect(kinds.has(container)).toBe(false)
  })
})
