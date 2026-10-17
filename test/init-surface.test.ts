import { describe, expect, it } from "vitest"
import { draftSurface, findApiTable, guessSource, seedFromTable } from "../scripts/init/surface.mjs"

const has =
  (...paths: string[]) =>
  (relative: string) =>
    paths.includes(relative)

describe("guessSource -- the root", () => {
  it("is src/ for the root even when everything exists", () => {
    expect(guessSource(".", () => true)).toBe("src/")
  })
})

describe("guessSource", () => {
  it("takes the root entry's source to be src/", () => {
    expect(guessSource(".", has())).toBe("src/")
  })
  it("prefers a folder, then a file, then falls back to src/", () => {
    expect(guessSource("./build", has("src/build", "src/build.ts"))).toBe("src/build/")
    expect(guessSource("./build", has("src/build.ts"))).toBe("src/build.ts")
    expect(guessSource("./build", has())).toBe("src/")
  })
  it("keeps a nested entry point's whole path", () => {
    expect(guessSource("./runtime/cache", has("src/runtime/cache.ts"))).toBe("src/runtime/cache.ts")
  })
})

describe("draftSurface", () => {
  const pkg = {
    version: "1.2.0",
    exports: {
      ".": "./a.js",
      "./build": "./b.js",
      "./schema/*": "./s/*",
      "./package.json": "./package.json",
    },
  }
  it("drafts one entry per published entry point and leaves what a person must say as TODOs", () => {
    expect(draftSurface(pkg, has("src/build"))).toEqual({
      entries: {
        ".": {
          source: "src/",
          environment: "TODO: say where this entry point can run.",
          tier: "Stable",
          purpose: "TODO: say what a reader gets from this entry point.",
        },
        "./build": {
          source: "src/build/",
          environment: "TODO: say where this entry point can run.",
          tier: "Stable",
          purpose: "TODO: say what a reader gets from this entry point.",
        },
      },
    })
  })
  it("starts a package that was never released as Experimental", () => {
    expect(draftSurface({ ...pkg, version: "0.0.0" }, has()).entries["."]?.tier).toBe(
      "Experimental",
    )
    expect(draftSurface({ exports: pkg.exports }, has()).entries["."]?.tier).toBe("Experimental")
  })
  it("drafts nothing for a package with no exports", () => {
    expect(draftSurface({ version: "1.0.0" }, has())).toEqual({ entries: {} })
  })
})

const TABLE = [
  "| Export | Source | Environment | Purpose |",
  "| --- | --- | --- | --- |",
  "| `@o/demo` | `src/core/` | isomorphic | the runtime |",
  "| `@o/demo/build` | `src/build/` | Node-only | tooling \\| more |",
].join("\n")

describe("findApiTable -- the shape of a table", () => {
  const rows = (text: string) => findApiTable(text)?.rows
  it("takes a header and separator that are indented or padded, and rows without a closing pipe", () => {
    expect(rows("  | Export | Source |\n  |---|---|  \n  | `a` | `b`\n| `c` | d")).toEqual([
      ["`a`", "`b`"],
      ["`c`", "d"],
    ])
  })
  it("does not take a separator that has something before or after the pipes", () => {
    expect(findApiTable("| Export |\nx |---|")).toBeUndefined()
    expect(findApiTable("| Export |\n|---| x")).toBeUndefined()
    expect(findApiTable("| Export |\n x|---|")).toBeUndefined()
  })
  it("takes a table whose header is on the very last line as no table, and one that ends the document", () => {
    expect(findApiTable("text\n| Export |")).toBeUndefined()
    expect(findApiTable("| Export |\n|---|\n| `a` |")?.end).toBe(3)
  })
  it("ends the table at the first line that does not start with a pipe, even an indented one that does", () => {
    const table = findApiTable("| Export |\n|---|\n  | `a` |\nprose | `b` |\n| `c` |")
    expect(table?.rows).toEqual([["`a`"]])
    expect(table?.end).toBe(3)
  })
  it("does not take a line that merely contains a pipe for a header", () => {
    expect(findApiTable("a | Export |\n|---|\n| x |")).toBeUndefined()
  })
})

describe("findApiTable", () => {
  it("finds a table with an Export column, and the lines it spans", () => {
    const table = findApiTable(`# Doc\n\nprose\n\n${TABLE}\n\nafter\n`)
    expect(table?.start).toBe(4)
    expect(table?.end).toBe(8)
    expect(table?.headers).toEqual(["export", "source", "environment", "purpose"])
    expect(table?.rows).toEqual([
      ["`@o/demo`", "`src/core/`", "isomorphic", "the runtime"],
      ["`@o/demo/build`", "`src/build/`", "Node-only", "tooling \\| more"],
    ])
  })
  it("ignores a table with no Export column, and a header with no separator under it", () => {
    expect(findApiTable("| A | B |\n| - | - |\n| 1 | 2 |")).toBeUndefined()
    expect(findApiTable("| Export | Source |\nnot a separator")).toBeUndefined()
    expect(findApiTable("no table here")).toBeUndefined()
  })
  it("takes the first table that has the column when an earlier one does not", () => {
    expect(findApiTable(`| A |\n| - |\n| 1 |\n\n${TABLE}`)?.start).toBe(4)
  })
})

describe("seedFromTable", () => {
  const draft = () =>
    draftSurface(
      { version: "1.0.0", exports: { ".": "x", "./build": "y", "./more": "z" } },
      () => false,
    )
  it("copies each row into the entry point it names, leaving the rest as drafted", () => {
    const surface = draft()
    const table = findApiTable(TABLE)!
    expect(seedFromTable(surface, table, "@o/demo")).toBe(2)
    expect(surface.entries["."]).toEqual({
      source: "src/core/",
      environment: "isomorphic",
      tier: "Stable",
      purpose: "the runtime",
    })
    expect(surface.entries["./build"]?.purpose).toBe("tooling \\| more")
    expect(surface.entries["./more"]?.purpose).toBe(
      "TODO: say what a reader gets from this entry point.",
    )
  })
  it("skips a row naming something the package does not export, and a blank cell", () => {
    const surface = draft()
    const table = {
      headers: ["export", "source", "purpose"],
      rows: [
        ["`@o/demo/gone`", "`a/`", "x"],
        ["`@o/demo`", "", "set"],
        ["`other`", "`b/`", "y"],
      ],
    }
    expect(seedFromTable(surface, table, "@o/demo")).toBe(1)
    expect(surface.entries["."]?.source).toBe("src/")
    expect(surface.entries["."]?.purpose).toBe("set")
  })
  it("reads the runtime column as the environment, and a stability column as the tier", () => {
    const surface = draft()
    seedFromTable(
      surface,
      {
        headers: ["export", "runtime", "stability"],
        rows: [["`@o/demo`", "browser", "Experimental"]],
      },
      "@o/demo",
    )
    expect(surface.entries["."]?.environment).toBe("browser")
    expect(surface.entries["."]?.tier).toBe("Experimental")
  })
  it("reads each column under each of the names a hand-written table gives it", () => {
    for (const [header, field, value] of [
      ["tier", "tier", "Experimental"],
      ["stability", "tier", "Experimental"],
      ["environment", "environment", "browser"],
      ["runtime", "environment", "browser"],
      ["purpose", "purpose", "does it"],
      ["what it is for", "purpose", "does it"],
      ["description", "purpose", "does it"],
      ["source", "source", "lib/"],
    ] as const) {
      const surface = draft()
      seedFromTable(
        surface,
        { headers: ["export", header], rows: [["`@o/demo`", value]] },
        "@o/demo",
      )
      expect(surface.entries["."]?.[field], header).toBe(value)
    }
  })
  it("removes any number of backticks around the export and the source, and only those at the ends", () => {
    const surface = draft()
    seedFromTable(
      surface,
      {
        headers: ["export", "source"],
        rows: [
          ["``@o/demo``", "``src/a``"],
          ["`@o/demo/build", "x`"],
          ["@o/demo/more``", "`a`b`"],
        ],
      },
      "@o/demo",
    )
    expect(surface.entries["."]?.source).toBe("src/a")
    expect(surface.entries["./build"]?.source).toBe("x")
    expect(surface.entries["./more"]?.source).toBe("a`b")
  })
  it("copes with a row shorter than the header, leaving what it cannot read as drafted", () => {
    const surface = draft()
    expect(
      seedFromTable(
        surface,
        {
          headers: ["export", "source", "purpose"],
          rows: [[], ["`@o/demo`"], ["`@o/demo/build`", "`x/`"]],
        },
        "@o/demo",
      ),
    ).toBe(2)
    expect(surface.entries["./build"]?.source).toBe("x/")
    expect(surface.entries["./build"]?.purpose).toBe(
      "TODO: say what a reader gets from this entry point.",
    )
    expect(surface.entries["."]?.source).toBe("src/")
  })
  it("keeps the backticks in a purpose, and takes them off only the source", () => {
    const surface = draft()
    seedFromTable(
      surface,
      {
        headers: ["export", "source", "purpose"],
        rows: [["`@o/demo`", "`src/`", "reads a `file`"]],
      },
      "@o/demo",
    )
    expect(surface.entries["."]?.purpose).toBe("reads a `file`")
    expect(surface.entries["."]?.source).toBe("src/")
  })
  it("leaves an entry as drafted for every column the table does not have", () => {
    const surface = draft()
    seedFromTable(
      surface,
      { headers: ["export", "purpose"], rows: [["`@o/demo`", "says it"]] },
      "@o/demo",
    )
    expect(surface.entries["."]).toEqual({
      source: "src/",
      environment: "TODO: say where this entry point can run.",
      tier: "Stable",
      purpose: "says it",
    })
  })
  it("seeds nothing from a table with no recognisable columns beyond the export", () => {
    const surface = draft()
    expect(seedFromTable(surface, { headers: ["export"], rows: [["`@o/demo`"]] }, "@o/demo")).toBe(
      1,
    )
    expect(surface.entries["."]?.source).toBe("src/")
  })
})
