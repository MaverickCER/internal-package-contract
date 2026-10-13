import { describe, expect, it } from "vitest"
import {
  entryPointRows,
  publishedEntries,
  specifier,
  toTable,
} from "../scripts/generate/entry-points.mjs"

const pkg = {
  name: "@o/demo",
  exports: {
    ".": "./a.js",
    "./build": "./b.js",
    "./schema/*": "./s/*",
    "./package.json": "./package.json",
  },
}
const entry = (over: Record<string, unknown> = {}) => ({
  source: "src/x/",
  environment: "isomorphic",
  tier: "Stable",
  purpose: "does x",
  ...over,
})
const surface = (entries: Record<string, unknown>) => ({ entries })

describe("publishedEntries / specifier", () => {
  it("lists what a reader can import, without package.json and wildcard patterns", () => {
    expect(publishedEntries(pkg.exports)).toEqual([".", "./build"])
  })
  it("writes the import specifier for the root and for a subpath", () => {
    expect(specifier("@o/demo", ".")).toBe("@o/demo")
    expect(specifier("@o/demo", "./build")).toBe("@o/demo/build")
  })
})

describe("entryPointRows -- a surface that is not an object with entries", () => {
  const message = ['docs/surface.json needs an "entries" object.']
  it("says what is wrong, and builds no rows, for null, a non-object, no entries or a list of entries", () => {
    for (const bad of [null, "text", 3, {}, { entries: null }, { entries: [] }, { entries: "x" }]) {
      expect(entryPointRows(pkg, bad)).toEqual({ problems: message, rows: [] })
    }
  })
})

describe("entryPointRows", () => {
  it("builds a header and one row per entry point, in export order", () => {
    const { problems, rows } = entryPointRows(
      pkg,
      surface({ "./build": entry({ purpose: "build" }), ".": entry() }),
    )
    expect(problems).toEqual([])
    expect(rows).toEqual([
      ["Export", "Source", "Environment", "Tier", "Purpose"],
      ["`@o/demo`", "`src/x/`", "isomorphic", "Stable", "does x"],
      ["`@o/demo/build`", "`src/x/`", "isomorphic", "Stable", "build"],
    ])
  })
  it("names an exported entry point the source does not describe, and a described one not exported", () => {
    const { problems } = entryPointRows(pkg, surface({ ".": entry(), "./gone": entry() }))
    expect(problems).toEqual([
      'docs/surface.json has no entry for "./build", which package.json exports.',
      'docs/surface.json lists "./gone", which package.json does not export.',
    ])
  })
  it("names the fields an entry lacks, treating blank and non-string values as lacking", () => {
    const { problems, rows } = entryPointRows(
      pkg,
      surface({ ".": entry({ source: "  ", purpose: 3 }), "./build": entry() }),
    )
    expect(problems).toEqual(['docs/surface.json entry "." needs source, purpose.'])
    expect(rows).toHaveLength(2)
  })
  it("rejects a tier that is not one of the three", () => {
    const { problems } = entryPointRows(
      pkg,
      surface({ ".": entry({ tier: "Beta" }), "./build": entry() }),
    )
    expect(problems).toEqual([
      'docs/surface.json entry "." has tier "Beta"; use Stable, Experimental, Internal.',
    ])
  })
  it("asks for an entries object when the source is not shaped like one", () => {
    for (const bad of [null, "x", {}, { entries: null }, { entries: [] }, { entries: "x" }]) {
      expect(entryPointRows(pkg, bad).problems).toEqual([
        'docs/surface.json needs an "entries" object.',
      ])
    }
  })
  it("treats a package with no exports as having nothing to describe", () => {
    expect(entryPointRows({ name: "x" }, surface({})).rows).toEqual([
      ["Export", "Source", "Environment", "Tier", "Purpose"],
    ])
  })
})

describe("toTable", () => {
  it("writes a Markdown table, escaping a pipe inside a cell", () => {
    expect(
      toTable([
        ["A", "B"],
        ["x | y", "z"],
      ]),
    ).toBe("| A | B |\n| --- | --- |\n| x \\| y | z |")
  })
})
