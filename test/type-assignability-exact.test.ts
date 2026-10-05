import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { ApiPackage, Excerpt } from "@microsoft/api-extractor-model"
import { ApiFunction } from "@microsoft/api-extractor-model"
import {
  loadApiModel,
  runApiExtractorForTarget,
} from "../scripts/api-contract/extractor-adapter.js"
import {
  buildItemIndex,
  buildReferenceIndex,
  checkAssignability,
  containsWholeWord,
  freeTypeParameterNamesFor,
} from "../scripts/api-contract/type-assignability.js"
import type { AssignabilityDirection } from "../scripts/api-contract/type-assignability.js"

const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)

const BASELINE = `/** @public */
export interface Shape {
  id: string
}
/** @public */
export function f(a: Shape): Shape {
  return a
}
/** @public */
export function g(a: Shape | Shape[]): void {
  void a
}
/** @public */
export function h(a: Promise<Shape>): void {
  void a
}
/** @public */
export function u(a: string): void {
  void a
}
/** @public */
export class Box<T> {
  /** @public */
  put<U>(value: T, extra: U): void {
    void value
    void extra
  }
}
/** @public */
export namespace NS {
  /** @public */
  export const k: number = 1
}
`

const CURRENT = BASELINE.replace("  id: string\n", "  id: string\n  size: number\n").replace(
  "export function u(a: string)",
  "export function u(a: number)",
)

interface Side {
  readonly root: string
  readonly pkg: ApiPackage
  readonly dts: string
  readonly apiJsonPath: string
}

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function build(source: string): Side {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-assignability-"))
  roots.push(root)
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
  write("src/index.ts", source)
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
  const result = runApiExtractorForTarget(root, {
    name: "index",
    mainEntryPointFilePath: "dist/.dts/index.d.ts",
  })
  expect(result.succeeded).toBe(true)
  return {
    root,
    pkg: loadApiModel(result.apiJsonFilePath).pkg,
    dts: readFileSync(result.dtsRollupFilePath, "utf8"),
    apiJsonPath: result.apiJsonFilePath,
  }
}

let baseline: Side
let current: Side
beforeAll(() => {
  baseline = build(BASELINE)
  current = build(CURRENT)
}, 120_000)

const parameterExcerpt = (side: Side, name: string, index = 0): Excerpt => {
  const item = buildItemIndex(side.pkg).get(`fx!${name}:function(1)`)
  if (!(item instanceof ApiFunction)) throw new Error(`no function ${name}`)
  const excerpt = item.parameters[index]?.parameterTypeExcerpt
  if (!excerpt) throw new Error("no excerpt")
  return excerpt
}
const returnExcerpt = (side: Side, name: string): Excerpt => {
  const item = buildItemIndex(side.pkg).get(`fx!${name}:function(1)`)
  if (!(item instanceof ApiFunction)) throw new Error(`no function ${name}`)
  return item.returnTypeExcerpt
}

function check(
  oldExcerpt: Excerpt,
  newExcerpt: Excerpt,
  direction: AssignabilityDirection,
  free: readonly string[] = [],
  sides: { old?: Side; current?: Side } = {},
) {
  const oldSide = sides.old ?? baseline
  const newSide = sides.current ?? current
  return checkAssignability(
    {
      baselineDts: oldSide.dts,
      currentDts: newSide.dts,
      baselineRefIndex: buildReferenceIndex(oldSide.pkg),
      currentRefIndex: buildReferenceIndex(newSide.pkg),
      oldExcerpt,
      newExcerpt,
      freeTypeParameterNames: new Set(free),
    },
    direction,
  )
}

describe("buildReferenceIndex()", () => {
  it("maps every item, nested ones included, to the top-level export it lives under", () => {
    const index = Object.fromEntries(buildReferenceIndex(baseline.pkg))
    expect(index).toMatchObject({
      "fx!Shape:interface": "Shape",
      "fx!Shape#id:member": "Shape",
      "fx!f:function(1)": "f",
      "fx!Box:class": "Box",
      "fx!Box#put:member(1)": "Box",
      "fx!NS:namespace": "NS",
      "fx!NS.k:var": "NS",
    })
    expect(Object.keys(index)).not.toContain("fx!")
    expect(Object.values(index).every((name) => typeof name === "string" && name.length > 0)).toBe(
      true,
    )
  })
})

describe("buildItemIndex()", () => {
  it("indexes every item by canonical reference, containers and their members alike", () => {
    const index = buildItemIndex(baseline.pkg)
    for (const reference of [
      "fx!Shape:interface",
      "fx!Shape#id:member",
      "fx!Box#put:member(1)",
      "fx!NS.k:var",
    ])
      expect(index.get(reference)?.canonicalReference.toString(), reference).toBe(reference)
    expect(index.has("fx!")).toBe(true)
  })
})

describe("freeTypeParameterNamesFor()", () => {
  it("collects the item's own type parameters and every enclosing item's", () => {
    const index = buildItemIndex(baseline.pkg)
    const method = index.get("fx!Box#put:member(1)")
    const klass = index.get("fx!Box:class")
    if (!method || !klass) throw new Error("missing items")
    expect([...freeTypeParameterNamesFor(method)].sort()).toEqual(["T", "U"])
    expect([...freeTypeParameterNamesFor(klass)]).toEqual(["T"])
    const shape = index.get("fx!Shape:interface")
    if (!shape) throw new Error("missing shape")
    expect([...freeTypeParameterNamesFor(shape)]).toEqual([])
  })
})

describe("containsWholeWord()", () => {
  it("is false for the empty word however the haystack is spaced", () => {
    expect(containsWholeWord("a  b", "")).toBe(false)
    expect(containsWholeWord("", "")).toBe(false)
  })

  it("never matches a word longer than the text, and matches a whole text", () => {
    expect(containsWholeWord("ab", "abc")).toBe(false)
    expect(containsWholeWord("abc", "abc")).toBe(true)
    expect(containsWholeWord("", "a")).toBe(false)
  })

  it("matches a word wherever its own edges are non-word characters", () => {
    expect(containsWholeWord("a$$$", "$$")).toBe(true)
    expect(containsWholeWord("a$$", "$$")).toBe(false)
    expect(containsWholeWord("x T", "T")).toBe(true)
    expect(containsWholeWord("T x", "T")).toBe(true)
    expect(containsWholeWord("xT", "T")).toBe(false)
    expect(containsWholeWord("Tx", "T")).toBe(false)
    expect(containsWholeWord("1T", "T")).toBe(false)
    expect(containsWholeWord("_T", "T")).toBe(false)
  })
})

describe("checkAssignability()", () => {
  it("judges a changed referenced type by the real compiler, in the direction asked", () => {
    const old = parameterExcerpt(baseline, "f")
    const next = parameterExcerpt(current, "f")
    expect(check(old, next, "contravariant")).toBe("breaking")
    expect(check(old, next, "covariant")).toBe("compatible")
    expect(check(old, next, "invariant")).toBe("breaking")
    expect(check(next, old, "invariant")).toBe("breaking")
    expect(check(old, old, "invariant", [], { current: baseline })).toBe("compatible")
  })

  it("asks both directions for an invariant position, stopping at the first that fails", () => {
    const old = returnExcerpt(baseline, "f")
    const next = returnExcerpt(current, "f")
    expect(check(old, next, "covariant")).toBe("compatible")
    expect(check(old, next, "contravariant")).toBe("breaking")
    expect(check(old, next, "invariant")).toBe("breaking")
  })

  it("resolves a reference that appears more than once in one excerpt", () => {
    const old = parameterExcerpt(baseline, "g")
    const next = parameterExcerpt(current, "g")
    expect(check(old, next, "contravariant")).toBe("breaking")
    expect(check(old, next, "covariant")).toBe("compatible")
  })

  it("compares plain content tokens", () => {
    const old = parameterExcerpt(baseline, "u")
    const next = parameterExcerpt(current, "u")
    expect(check(old, next, "contravariant")).toBe("breaking")
    expect(check(old, old, "invariant", [], { current: baseline })).toBe("compatible")
  })

  it("is unknown for a reference it cannot resolve to something importable", () => {
    const old = parameterExcerpt(baseline, "h")
    expect(check(old, old, "covariant", [], { current: baseline })).toBe("unknown")
  })

  it("is unknown when an excerpt names a type parameter in scope, however many are in scope", () => {
    const old = parameterExcerpt(baseline, "u")
    const next = parameterExcerpt(current, "u")
    expect(check(old, next, "contravariant", ["string"])).toBe("unknown")
    expect(check(old, next, "contravariant", ["x", "number"])).toBe("unknown")
    expect(check(old, next, "contravariant", ["x", "y"])).toBe("breaking")
    expect(check(old, next, "contravariant", ["strings"])).toBe("breaking")
  })

  it("is unknown when a reconstructed type is not valid syntax", () => {
    const edited = JSON.parse(readFileSync(baseline.apiJsonPath, "utf8")) as unknown
    const visit = (node: unknown, apply: (object: Record<string, unknown>) => void): void => {
      if (Array.isArray(node)) for (const child of node) visit(child, apply)
      else if (typeof node === "object" && node !== null) {
        apply(node as Record<string, unknown>)
        for (const child of Object.values(node)) visit(child, apply)
      }
    }
    visit(edited, (object) => {
      if (object["kind"] === "Content" && object["text"] === "string") object["text"] = "string |"
    })
    const file = path.join(baseline.root, "edited.api.json")
    writeFileSync(file, JSON.stringify(edited))
    const broken: Side = { ...baseline, pkg: loadApiModel(file).pkg }
    const bad = parameterExcerpt(broken, "u")
    const good = parameterExcerpt(baseline, "u")
    expect(check(bad, good, "covariant", [], { old: broken, current: baseline })).toBe("unknown")
  })

  it("is unknown for a reference with no canonical reference, or one the declarations do not export", () => {
    const edit = (change: (object: Record<string, unknown>) => void) => {
      const edited = JSON.parse(readFileSync(baseline.apiJsonPath, "utf8")) as unknown
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) for (const child of node) visit(child)
        else if (typeof node === "object" && node !== null) {
          change(node as Record<string, unknown>)
          for (const child of Object.values(node)) visit(child)
        }
      }
      visit(edited)
      const file = path.join(baseline.root, `edited-${String(Math.random()).slice(2)}.api.json`)
      writeFileSync(file, JSON.stringify(edited))
      return loadApiModel(file).pkg
    }
    const unreferenced = edit((object) => {
      if (object["kind"] === "Reference" && object["text"] === "Shape")
        delete object["canonicalReference"]
    })
    const sideA: Side = { ...baseline, pkg: unreferenced }
    const withoutRef = parameterExcerpt(sideA, "f")
    expect(check(withoutRef, withoutRef, "covariant", [], { old: sideA, current: sideA })).toBe(
      "unknown",
    )

    const missing: Side = {
      ...baseline,
      dts: baseline.dts.replace("interface Shape", "interface Renamed"),
    }
    const old = parameterExcerpt(baseline, "f")
    expect(check(old, old, "covariant", [], { old: missing, current: missing })).toBe("unknown")
  })
})
