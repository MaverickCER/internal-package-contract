import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { baselineFolder, readFacts } from "../scripts/skill/facts.mjs"
import { inspectSkill, problemsOf } from "../scripts/skill/inspect.mjs"
import {
  DEFAULT_BUDGET,
  MAXIMUM_BUDGET,
  cell,
  linkTo,
  rawLink,
  renderApi,
  renderSkill,
  shortName,
  skillFolder,
  whole,
  wordsOf,
} from "../scripts/skill/render.mjs"
import { run } from "../scripts/skill/run.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-agent-skill-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (file: string, value: unknown): void => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(
    path.join(dir, file),
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  )
}
const factsOf = () => {
  const facts = readFacts(dir)
  if (facts === undefined) throw new Error("no manifest")
  return facts
}
const read = (file: string): string => readFileSync(path.join(dir, file)).toString()
const withIo = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

const baseline = (
  ...members: { name: string; kind: string; releaseTag: string; text: string }[]
) => ({
  members: [
    {
      kind: "EntryPoint",
      members: members.map(({ name, kind, releaseTag, text }) => ({
        name,
        kind,
        releaseTag,
        excerptTokens: [{ kind: "Content", text }],
      })),
    },
  ],
})

/** A small package with everything a skill is made of. */
const scaffold = (skill: object | null = {}): void => {
  put("package.json", {
    name: "@acme/widget",
    version: "1.2.3",
    description: "Makes widgets.",
    repository: { url: "git+https://github.com/acme/widget.git" },
    exports: {
      ".": "./dist/index.js",
      "./extra": "./dist/extra.js",
      "./package.json": "./package.json",
      "./schema/*": "./s/*",
    },
  })
  put("docs/surface.json", {
    entries: {
      ".": { tier: "Stable", purpose: "`makeWidget`, the widget types" },
      "./extra": { tier: "Beta", purpose: "extra helpers" },
    },
  })
  put(
    ".repo-contract/api-contract/index/baseline.api.json",
    baseline(
      {
        name: "makeWidget",
        kind: "Function",
        releaseTag: "Public",
        text: "export declare function makeWidget(size: number): Widget;",
      },
      {
        name: "Widget",
        kind: "Interface",
        releaseTag: "Public",
        text: "export interface Widget {\n  size: number;\n}",
      },
      {
        name: "internalThing",
        kind: "Function",
        releaseTag: "Internal",
        text: "export declare function internalThing(): void;",
      },
      {
        name: "betaThing",
        kind: "Function",
        releaseTag: "Beta",
        text: "export declare function betaThing(): void;",
      },
    ),
  )
  put(
    "examples/basic.ts",
    'import { makeWidget } from "@acme/widget"\n\nconst widget = makeWidget(3)\nconsole.log(widget)\n',
  )
  put("GUIDE.md", "# Guide\n\n## Sizes\n")
  if (skill !== null) put("docs/skill.json", skill)
}

const full = {
  when: "Load when making widgets.",
  purpose: "Widgets, made correctly.",
  notFor: "gadgets.",
  example: { file: "examples/basic.ts" },
  rules: ["Always pass a size.", "Never mutate a widget."],
  behavior: ["Making a widget is synchronous."],
  mistakes: [{ wrong: "`new Widget()`", right: "`makeWidget(size)`" }],
  verify: ["Run the type check.", "Run the tests."],
  references: [{ when: "Sizes in depth", path: "GUIDE.md#sizes" }],
}

describe("small helpers", () => {
  it("keeps the author's table cell whole, on one line, with its pipes escaped", () => {
    const long = `${"word ".repeat(80)}end`
    expect(whole(long)).toBe(long)
    expect(whole("  a \n  b|c  ")).toBe("a b\\|c")
  })

  it("names the skill for the package without its scope, and keeps it in its own folder", () => {
    expect(shortName("@acme/widget")).toBe("widget")
    expect(shortName("widget")).toBe("widget")
    expect(shortName("a@b/c")).toBe("a@b/c")
    expect(skillFolder("@acme/widget")).toBe("skills/widget")
  })

  it("counts words, and links a file on the default branch", () => {
    expect(wordsOf("")).toBe(0)
    expect(wordsOf("  one  two\nthree\t")).toBe(3)
    expect(wordsOf("one")).toBe(1)
    expect(wordsOf("a-b c_d")).toBe(2)
    expect(wordsOf(" \n\t ")).toBe(0)
    expect(linkTo("https://github.com/a/b", "x/y.md")).toBe(
      "https://github.com/a/b/blob/main/x/y.md",
    )
  })

  it("gives an agent the plain-text address of the manual, and a browsable one off GitHub", () => {
    expect(rawLink("https://github.com/acme/widget", "@acme/widget")).toBe(
      "https://raw.githubusercontent.com/acme/widget/main/skills/widget/SKILL.md",
    )
    expect(rawLink("https://example.com/acme/widget", "widget")).toBe(
      "https://example.com/acme/widget/blob/main/skills/widget/SKILL.md",
    )
    expect(rawLink("git+https://github.com/acme/widget", "widget")).toBe(
      "git+https://github.com/acme/widget/blob/main/skills/widget/SKILL.md",
    )
    expect(rawLink("https://github.com/acme", "widget")).toBe(
      "https://github.com/acme/blob/main/skills/widget/SKILL.md",
    )
    expect(rawLink("https://github.com/acme/widget/extra", "widget")).toBe(
      "https://github.com/acme/widget/extra/blob/main/skills/widget/SKILL.md",
    )
  })

  it("fits a cell on one line, with the table's separator escaped", () => {
    expect(cell("  a\n b  | c ")).toBe("a b \\| c")
    const fits = "x".repeat(80)
    expect(cell(fits)).toBe(fits)
    expect(cell("y".repeat(81))).toBe(`${"y".repeat(79)}…`)
  })

  it("shortens a long cell after a whole word, and drops the punctuation the cut leaves behind", () => {
    const words = cell("word ".repeat(30))
    expect(words).toBe(`${"word ".repeat(15).trimEnd()}…`)
    expect(words.length).toBeLessThanOrEqual(80)
    expect(cell(`${"w".repeat(70)}, ${"z".repeat(30)}`)).toBe(`${"w".repeat(70)}…`)
    expect(cell(`${"w".repeat(70)}; ${"z".repeat(30)}`)).toBe(`${"w".repeat(70)}…`)
    expect(cell(`${"w".repeat(70)}: ${"z".repeat(30)}`)).toBe(`${"w".repeat(70)}…`)
    expect(cell(`${"w".repeat(70)} - ${"z".repeat(30)}`)).toBe(`${"w".repeat(70)}…`)
    expect(cell(`${"w".repeat(70)} ${"z".repeat(30)}`)).toBe(`${"w".repeat(70)}…`)
    expect(cell(`${"a b ".repeat(18)}|${"z".repeat(30)}`)).toBe(`${"a b ".repeat(18).trimEnd()}…`)
    expect(
      cell(`${"y".repeat(76)} | zzzzzz`)
        .replaceAll("\\|", "")
        .includes("|"),
    ).toBe(false)
    expect(cell(`${"y".repeat(60)} a|b ${"z".repeat(40)}`)).toBe(`${"y".repeat(60)} a\\|b…`)
  })

  it("never cuts inside a code span, or leaves one open", () => {
    expect(cell(`ok \`${"a b ".repeat(30)}\``)).toBe("ok…")
    expect(cell(`${"x".repeat(60)} \`${"y".repeat(60)}\``)).toBe(`${"x".repeat(60)}…`)
    expect(
      cell(
        `\`createEnv\`, \`documentEnv\`, \`validateEnv\`, \`resetEnvCache\`, error types, \`isEnvContract\` and more`,
      ),
    ).toBe("`createEnv`, `documentEnv`, `validateEnv`, `resetEnvCache`, error types…")
    expect(cell(`${"x".repeat(30)} \`a\` ${"y".repeat(30)} \`${"b".repeat(30)}\``)).toBe(
      `${"x".repeat(30)} \`a\` ${"y".repeat(30)}…`,
    )
  })
})

describe("baselineFolder", () => {
  it("is the folder an entry point's API is recorded in", () => {
    expect(baselineFolder(".", undefined)).toBe("index")
    expect(baselineFolder(".", { ".": "src/core/index.ts" })).toBe("core")
    expect(baselineFolder("./runtime", undefined)).toBe("runtime")
    expect(baselineFolder("./runtime/cache", undefined)).toBe("runtime/cache")
    expect(baselineFolder("./eslint-plugin", { ".": "src/core/index.ts" })).toBe("eslint-plugin")
    expect(baselineFolder("./runtime/cache", { "./runtime/cache": "src/runtime/cache.ts" })).toBe(
      "runtime/cache",
    )
    expect(baselineFolder("./x", { "./x": "./src/a/index.tsx" })).toBe("a")
    expect(baselineFolder("./x", { "./x": "src/a/b.tsx" })).toBe("a/b")
    expect(baselineFolder(".", { ".": "src/index.ts" })).toBe("index")
    expect(baselineFolder(".", { ".": "src/main.mts" })).toBe("main.mts")
    expect(baselineFolder("./y", { "./y": "lib/y.ts" })).toBe("lib/y")
    // Each rewrite applies on its own: a leading ./ or / before src/, an index file in a folder, a .ts or .tsx file.
    expect(baselineFolder("./z", { "./z": "/src/q/index.ts" })).toBe("q")
    expect(baselineFolder("./z", { "./z": "./src/q/r.ts" })).toBe("q/r")
    expect(baselineFolder("./z", { "./z": "src/q/index.tsx" })).toBe("q")
    expect(baselineFolder("./z", { "./z": "src/q/r.tsx" })).toBe("q/r")
    expect(baselineFolder("./z", { "./z": "src/qindex.ts" })).toBe("qindex")
    expect(baselineFolder("./z", { "./z": "src/q/xindex.ts" })).toBe("q/xindex")
    expect(baselineFolder("./z", { "./z": "src/q.js" })).toBe("q.js")
    expect(baselineFolder("./z", { "./z": "xsrc/q.ts" })).toBe("xsrc/q")
    expect(baselineFolder("./z", { "./z": "src/.ts" })).toBe("index")
    expect(baselineFolder("./z", { "./z": "src/index.ts" })).toBe("index")
    // Only a trailing extension goes.
    expect(baselineFolder("./z", { "./z": "src/q/index.ts.bak" })).toBe("q/index.ts.bak")
    expect(baselineFolder("./z", { "./z": "src/q.ts.bak" })).toBe("q.ts.bak")
  })
})

describe("readFacts", () => {
  it("is nothing for a folder with no manifest, or one that is not JSON", () => {
    expect(readFacts(dir)).toBeUndefined()
    put("package.json", "not json")
    expect(readFacts(dir)).toBeUndefined()
  })

  it("reads the package, its entry points with their purposes, and only the API a consumer can use", () => {
    scaffold(full)
    const facts = readFacts(dir)
    expect(facts).toMatchObject({
      name: "@acme/widget",
      version: "1.2.3",
      description: "Makes widgets.",
      repository: "https://github.com/acme/widget",
      skill: full,
    })
    expect(facts?.entries.map((entry: { specifier: string }) => entry.specifier)).toEqual([
      "@acme/widget",
      "@acme/widget/extra",
    ])
    expect(facts?.entries[0]).toEqual({
      specifier: "@acme/widget",
      purpose: "`makeWidget`, the widget types",
      tier: "Stable",
      api: [
        {
          name: "makeWidget",
          kind: "Function",
          tag: "Public",
          signature: "function makeWidget(size: number): Widget",
        },
        {
          name: "Widget",
          kind: "Interface",
          tag: "Public",
          signature: "interface Widget { size: number; }",
        },
        {
          name: "betaThing",
          kind: "Function",
          tag: "Beta",
          signature: "function betaThing(): void",
        },
      ],
    })
    expect(facts?.entries[1]).toEqual({
      specifier: "@acme/widget/extra",
      purpose: "extra helpers",
      tier: "Beta",
      api: [],
    })
  })

  it("makes the repository address browsable: no git+ in front, no .git behind, and nothing else touched", () => {
    const repositoryOf = (url: string): string | undefined => {
      put("package.json", { name: "w", version: "1.0.0", repository: { url }, exports: {} })
      return readFacts(dir)?.repository
    }
    expect(repositoryOf("git+https://github.com/a/b.git")).toBe("https://github.com/a/b")
    expect(repositoryOf("https://github.com/a/b")).toBe("https://github.com/a/b")
    expect(repositoryOf("https://github.com/a/git+b.git")).toBe("https://github.com/a/git+b")
    expect(repositoryOf("https://github.com/a/x.github.io")).toBe(
      "https://github.com/a/x.github.io",
    )
    expect(repositoryOf("https://github.com/a/b.gitx")).toBe("https://github.com/a/b.gitx")
  })

  it("lists the entry points of a manifest by subpath, and nothing from an exports that is not a map of them", () => {
    put("package.json", { name: "w", version: "1.0.0", exports: "./index.js" })
    expect(readFacts(dir)?.entries).toEqual([])
    put("package.json", {
      name: "w",
      version: "1.0.0",
      exports: { import: "./a.mjs", require: "./a.cjs" },
    })
    expect(readFacts(dir)?.entries).toEqual([])
    put("package.json", {
      name: "w",
      version: "1.0.0",
      exports: { "./b": "./b.js", "./c/*": "./c/*.js", "./package.json": "./package.json" },
    })
    expect(readFacts(dir)?.entries.map((entry: { specifier: string }) => entry.specifier)).toEqual([
      "w/b",
    ])
  })

  it("reads each export's declaration from every token it is made of, without its leading export or declare", () => {
    put("package.json", { name: "w", version: "1.0.0", exports: { ".": "./a.js" } })
    const tokens = (...texts: string[]) => ({
      members: [
        {
          kind: "EntryPoint",
          members: [
            {
              name: "a",
              kind: "Function",
              releaseTag: "Public",
              excerptTokens: texts.map((text) => ({ kind: "Content", text })),
            },
          ],
        },
      ],
    })
    const signatureOf = (...texts: string[]): string | undefined => {
      put(".repo-contract/api-contract/index/baseline.api.json", tokens(...texts))
      return readFacts(dir)?.entries[0]?.api[0]?.signature
    }
    expect(signatureOf("export declare function a(", "x: number", "): void;")).toBe(
      "function a(x: number): void",
    )
    expect(signatureOf("export function a(): void;")).toBe("function a(): void")
    expect(signatureOf("declare function a(): void;")).toBe("declare function a(): void")
    expect(signatureOf('function a(kind: "export "): void;')).toBe(
      'function a(kind: "export "): void',
    )
    expect(signatureOf("  function   a(\n  x:  number\n):  void ;  ")).toBe(
      "function a( x: number ): void",
    )
    expect(signatureOf("export declare const a: 1;;")).toBe("const a: 1;")
    // A doc comment inside a declaration is prose, not signature, and would open a code span in the reference.
    expect(signatureOf("type a = /** one */ string | /** two\n lines */ number;")).toBe(
      "type a = string | number",
    )
    expect(signatureOf("type a = /** one */ keep /** two */ ;")).toBe("type a = keep")
  })

  it("has no API for an entry point whose baseline is missing, empty, or has no members", () => {
    put("package.json", { name: "w", version: "1.0.0", exports: { ".": "./a.js" } })
    expect(readFacts(dir)?.entries[0]?.api).toEqual([])
    for (const model of [{}, { members: [] }, { members: [{}] }, { members: [{ members: [] }] }]) {
      put(".repo-contract/api-contract/index/baseline.api.json", model)
      expect(readFacts(dir)?.entries[0]?.api).toEqual([])
    }
    put(".repo-contract/api-contract/index/baseline.api.json", "not json")
    expect(readFacts(dir)?.entries[0]?.api).toEqual([])
  })

  it("takes the repository from the site file when the manifest has none, and goes without one", () => {
    put("package.json", { name: "w", version: "1.0.0", exports: {} })
    put("docs/site.json", { repoUrl: "https://github.com/a/w" })
    expect(readFacts(dir)?.repository).toBe("https://github.com/a/w")
    rmSync(path.join(dir, "docs/site.json"))
    expect(readFacts(dir)).toMatchObject({
      repository: "",
      description: "",
      skill: undefined,
      entries: [],
    })
  })

  it("leaves out an entry point with no purpose from the table by keeping it empty, and uses the package alias for the API folder", () => {
    put("package.json", {
      name: "w",
      version: "1.0.0",
      exports: { ".": "./a.js" },
      "internal-package-contract": { apiTargets: { ".": "src/core/index.ts" } },
    })
    put(
      ".repo-contract/api-contract/core/baseline.api.json",
      baseline({ name: "f", kind: "Function", releaseTag: "Public", text: "function f(): void;" }),
    )
    expect(readFacts(dir)?.entries[0]).toMatchObject({
      purpose: "",
      tier: "",
      api: [{ name: "f" }],
    })
  })
})

describe("renderSkill and renderApi, exactly", () => {
  it("is exactly this for a package with everything", () => {
    scaffold(full)
    const facts = factsOf()
    expect(
      renderSkill(facts, {
        code: "const w = makeWidget(3)",
        file: "examples/basic.ts",
        language: "ts",
      }),
    ).toMatchSnapshot()
    expect(renderApi(facts)).toMatchSnapshot()
  })

  it("is exactly this for a package that has told it nothing", () => {
    put("package.json", {
      name: "plain",
      version: "0.1.0",
      description: "Plain.",
      repository: { url: "https://github.com/a/plain" },
      exports: { ".": "./i.js" },
    })
    put("docs/skill.json", {})
    expect(renderSkill(factsOf(), undefined)).toMatchSnapshot()
  })

  it("lists only entry points that record an API, and names what is not public by tag", () => {
    scaffold(full)
    const text = renderApi(factsOf())
    expect(text).toContain("## `@acme/widget`")
    expect(text).not.toContain("## `@acme/widget/extra`")
    expect(text).not.toContain("internalThing")
    expect(text).toContain("- `betaThing` (function, beta): `function betaThing(): void`")
    expect(text).toContain("- `makeWidget` (function): `function makeWidget(size: number): Widget`")
  })

  it("says an import in the author's own words, whole, and lists one the surface does not describe", () => {
    scaffold({
      ...full,
      imports: {
        "@acme/widget": `${"Makes widgets, and says so at length. ".repeat(4)}| end`,
        "@acme/widget/extra": "The extras.",
      },
    })
    const text = renderSkill(factsOf(), undefined)
    expect(text).toContain(
      `| \`@acme/widget\` | ${"Makes widgets, and says so at length. ".repeat(4)}\\| end |`,
    )
    expect(text).toContain("| `@acme/widget/extra` | The extras. |")
    expect(text).not.toContain("…")
  })

  it("leaves out a section that has nothing in it, and an empty list", () => {
    scaffold({ rules: [], mistakes: [], references: [] })
    const text = renderSkill(factsOf(), undefined)
    for (const heading of ["## Use it", "## Rules", "## Rely on", "## Common mistakes"])
      expect(text).not.toContain(heading)
    expect(text).toContain("## Verify")
    expect(text).toContain("1. Run the project's type check and tests.")
  })

  it("uses the package description when it has no purpose and no `when`", () => {
    scaffold({})
    const text = renderSkill(factsOf(), undefined)
    expect(text).toContain("description: Use when working with @acme/widget: Makes widgets.")
    expect(text).toContain("\nMakes widgets.\n")
    expect(text).not.toContain("Not for:")
  })
})

describe("problemsOf", () => {
  const exists = (file: string) => file === "GUIDE.md"
  const wrongs = (skill: object) => problemsOf(skill, exists)

  it("has nothing to say about a skill that is right", () => {
    expect(wrongs({})).toEqual([])
    expect(wrongs(full)).toEqual([])
  })

  it("wants text where text is meant", () => {
    for (const field of ["when", "purpose", "notFor"]) {
      expect(wrongs({ [field]: 3 })).toEqual([`docs/skill.json: "${field}" must be text.`])
    }
  })

  it("keeps `when` short, because it is read to decide whether to load the skill", () => {
    expect(wrongs({ when: "x".repeat(300) })).toEqual([])
    expect(wrongs({ when: "x".repeat(301) })).toEqual([
      'docs/skill.json: "when" is 301 characters; it is read to decide whether to load the skill, so keep it under 300.',
    ])
  })

  it("wants lists of text where lists are meant", () => {
    for (const field of ["rules", "behavior", "verify"]) {
      expect(wrongs({ [field]: "one" })).toEqual([
        `docs/skill.json: "${field}" must be a list of text.`,
      ])
      expect(wrongs({ [field]: ["a", 1] })).toEqual([
        `docs/skill.json: "${field}" must be a list of text.`,
      ])
      expect(wrongs({ [field]: [] })).toEqual([])
    }
  })

  it("refuses a table cell that would have to be cut, and an imports list that is not words", () => {
    const long = "x".repeat(201)
    expect(wrongs({ mistakes: [{ wrong: "a", right: "x".repeat(200) }] })).toEqual([])
    for (const row of [
      { wrong: long, right: "b" },
      { wrong: "a", right: long },
    ]) {
      expect(wrongs({ mistakes: [row] })).toEqual([
        'docs/skill.json: "mistakes" has a cell of 201 characters, over 200: it would be cut mid-sentence, so shorten it.',
      ])
    }
    expect(wrongs({ imports: { a: "b", c: "x".repeat(200) } })).toEqual([])
    for (const bad of [
      "x",
      null,
      ["a"],
      { a: 1 },
      { a: long },
      { a: ["x"] },
      { a: "ok", b: 1 },
      { a: "ok", b: long },
    ]) {
      expect(wrongs({ imports: bad })).toEqual([
        'docs/skill.json: "imports" must map an import to its words, each at most 200 characters.',
      ])
    }
  })

  it("wants each mistake and reference to be a pair of text", () => {
    expect(wrongs({ mistakes: [{ wrong: "a", right: "b" }] })).toEqual([])
    for (const bad of [
      "x",
      [{ wrong: "a" }],
      [{ wrong: "a", right: 1 }],
      [null],
      [{ right: "b" }],
    ]) {
      expect(wrongs({ mistakes: bad })).toEqual([
        'docs/skill.json: "mistakes" must be a list of { "wrong", "right" }.',
      ])
    }
    for (const bad of ["x", [{ when: "a" }], [{ when: "a", path: 1 }], [null]]) {
      expect(wrongs({ references: bad })).toEqual([
        'docs/skill.json: "references" must be a list of { "when", "path" }.',
      ])
    }
  })

  it("rejects a list in which any one entry is not a pair of text, and an entry that is not an object at all", () => {
    expect(wrongs({ mistakes: [{ wrong: "a", right: "b" }, { wrong: "a" }] })).toHaveLength(1)
    expect(wrongs({ references: [{ when: "a", path: "GUIDE.md" }, { when: "b" }] })).toHaveLength(1)
    for (const bad of [undefined, null, 3, "text", true]) {
      expect(wrongs({ mistakes: [bad] })).toHaveLength(1)
      expect(wrongs({ references: [bad] })).toHaveLength(1)
    }
  })

  it("wants each reference to point at something in the package, ignoring an anchor or a query", () => {
    expect(
      wrongs({
        references: [
          { when: "a", path: "GUIDE.md#anchor" },
          { when: "b", path: "GUIDE.md?x=1" },
        ],
      }),
    ).toEqual([])
    expect(wrongs({ references: [{ when: "a", path: "MISSING.md#x" }] })).toEqual([
      'docs/skill.json: "references" names `MISSING.md#x`, which is not in the package.',
    ])
  })

  it("keeps the budget a whole number of words between 100 and the largest allowed", () => {
    for (const ok of [100, 600, MAXIMUM_BUDGET]) expect(wrongs({ budget: ok })).toEqual([])
    for (const bad of [99, MAXIMUM_BUDGET + 1, 600.5, "600"]) {
      expect(wrongs({ budget: bad })).toEqual([
        `docs/skill.json: "budget" must be a whole number of words from 100 to ${String(MAXIMUM_BUDGET)}.`,
      ])
    }
  })
})

describe("inspectSkill", () => {
  it("says there is nothing to write from when there is no skill file, or no manifest", () => {
    expect(inspectSkill(dir)).toEqual({
      state: "none",
      problems: ["there is no docs/skill.json, so there is nothing to write the skill from"],
      notes: [],
      stale: [],
      words: 0,
      budget: DEFAULT_BUDGET,
      files: {},
    })
    expect(inspectSkill(dir).problems[0]).toBe(
      "there is no docs/skill.json, so there is nothing to write the skill from",
    )
    scaffold(null)
    expect(inspectSkill(dir).state).toBe("none")
  })

  it("lists the files it would write, with the words the manual has, and which are missing", () => {
    scaffold(full)
    const report = inspectSkill(dir)
    expect(report.state).toBe("checked")
    expect(report.problems).toEqual([])
    expect(Object.keys(report.files).sort()).toEqual([
      "skills/widget/SKILL.md",
      "skills/widget/references/api.md",
    ])
    expect(report.stale.sort()).toEqual([
      "skills/widget/SKILL.md",
      "skills/widget/references/api.md",
    ])
    expect(report.budget).toBe(DEFAULT_BUDGET)
    expect(report.words).toBe(
      wordsOf(report.files["skills/widget/SKILL.md"]?.replace(/^---[\s\S]*?\n---\n/, "") ?? ""),
    )
  })

  it("is current once the files are what it would write, stale when one differs, and writes no API file for a package with none", () => {
    scaffold(full)
    for (const [file, text] of Object.entries(inspectSkill(dir).files)) put(file, text)
    expect(inspectSkill(dir).stale).toEqual([])
    put("skills/widget/SKILL.md", `${read("skills/widget/SKILL.md")}edited\n`)
    expect(inspectSkill(dir).stale).toEqual(["skills/widget/SKILL.md"])
    rmSync(path.join(dir, ".repo-contract"), { recursive: true })
    expect(Object.keys(inspectSkill(dir).files)).toEqual(["skills/widget/SKILL.md"])
  })

  it("takes the example from the file named, whole or by lines", () => {
    scaffold({ ...full, example: { file: "examples/basic.ts", lines: [3, 4] } })
    expect(inspectSkill(dir).files["skills/widget/SKILL.md"]).toContain(
      "```ts\nconst widget = makeWidget(3)\nconsole.log(widget)\n```",
    )
    scaffold({ ...full, example: { file: "examples/basic.ts" } })
    expect(inspectSkill(dir).files["skills/widget/SKILL.md"]).toContain(
      'import { makeWidget } from "@acme/widget"\n\nconst widget',
    )
    scaffold({ ...full, example: { file: "examples/basic.ts", lines: [4, 4] } })
    expect(inspectSkill(dir).files["skills/widget/SKILL.md"]).toContain(
      "```ts\nconsole.log(widget)\n```",
    )
    scaffold({ ...full, example: { file: "examples/basic.ts", lines: [1, 1] } })
    expect(inspectSkill(dir).files["skills/widget/SKILL.md"]).toContain(
      '```ts\nimport { makeWidget } from "@acme/widget"\n```',
    )
  })

  it("refuses a references list with one bad row among good ones", () => {
    scaffold({
      ...full,
      references: [{ when: "you need more", path: "examples/basic.ts" }, { when: "x" }],
    })
    expect(inspectSkill(dir).problems).toEqual([
      'docs/skill.json: "references" must be a list of { "when", "path" }.',
    ])
  })

  it("refuses an example that is not there, whose lines are not there, or that is too long to load every time", () => {
    scaffold({ ...full, example: { file: "examples/missing.ts" } })
    expect(inspectSkill(dir)).toEqual({
      state: "invalid",
      problems: [
        'docs/skill.json: "example" names `examples/missing.ts`, which is not in the package.',
      ],
      notes: [],
      stale: [],
      words: 0,
      budget: DEFAULT_BUDGET,
      files: {},
    })
    scaffold({ ...full, example: { file: 7 } })
    expect(inspectSkill(dir).problems).toEqual([
      'docs/skill.json: "example" names `7`, which is not in the package.',
    ])
    for (const lines of [
      [0, 2],
      [3, 9],
      [4, 3],
      [5, 6],
    ]) {
      scaffold({ ...full, example: { file: "examples/basic.ts", lines } })
      expect(inspectSkill(dir).problems).toEqual([
        `docs/skill.json: "example" lines ${String(lines[0])} to ${String(lines[1])} are not in \`examples/basic.ts\` (4 lines): give them as [from, to].`,
      ])
    }
    for (const lines of [[4], "x", [1.5, 2], [1, "2"], [], null]) {
      scaffold({ ...full, example: { file: "examples/basic.ts", lines } })
      expect(inspectSkill(dir).problems).toHaveLength(1)
      expect(inspectSkill(dir).problems[0]).toContain("give them as [from, to].")
    }
    put("examples/long.ts", `${"const x = 1\n".repeat(41)}`)
    scaffold({ ...full, example: { file: "examples/long.ts" } })
    expect(inspectSkill(dir).problems).toEqual([
      'docs/skill.json: "example" is 41 lines; keep it to 40, or choose the lines that matter.',
    ])
    put("examples/long.ts", `${"const x = 1\n".repeat(40)}`)
    expect(inspectSkill(dir).problems).toEqual([])
    put("examples/long.ts", `${"const x = 1\n".repeat(60)}`)
    scaffold({ ...full, example: { file: "examples/long.ts", lines: [11, 50] } })
    expect(inspectSkill(dir).problems).toEqual([])
    scaffold({ ...full, example: { file: "examples/long.ts", lines: [10, 50] } })
    expect(inspectSkill(dir).problems).toEqual([
      'docs/skill.json: "example" is 41 lines; keep it to 40, or choose the lines that matter.',
    ])
  })

  it("says what is missing that a skill is better for, without failing it", () => {
    scaffold({})
    expect(inspectSkill(dir).notes).toEqual([
      "there is no example, which is the part an agent copies from",
      "there are no rules: say what an agent must not do, and what to do instead",
    ])
    scaffold({ example: { file: "examples/basic.ts" }, rules: ["a rule"] })
    expect(inspectSkill(dir).notes).toEqual([])
    expect(inspectSkill(dir).problems).toEqual([])
  })

  it("fails a manual over its budget, by how many words, and takes the package's own budget", () => {
    scaffold({ ...full, rules: ["word ".repeat(700).trim()] })
    const over = inspectSkill(dir)
    expect(over.state).toBe("checked")
    expect(over.problems).toHaveLength(1)
    expect(over.problems[0]).toMatch(
      /^the manual is \d+ words, over its budget of 600: move detail into a reference and link it, or cut it\.$/,
    )
    scaffold({ ...full, rules: ["word ".repeat(700).trim()], budget: 1000 })
    expect(inspectSkill(dir).problems).toEqual([])
    scaffold({ ...full, budget: 100 })
    expect(inspectSkill(dir).budget).toBe(100)
    expect(inspectSkill(dir).problems[0]).toContain("over its budget of 100")
  })

  it("counts the manual without its frontmatter, and a manual exactly at its budget passes", () => {
    scaffold(full)
    const { words } = inspectSkill(dir)
    scaffold({ ...full, budget: words })
    expect(inspectSkill(dir).problems).toEqual([])
    scaffold({ ...full, budget: Math.max(100, words - 1) })
    expect(inspectSkill(dir).problems).toEqual(
      words - 1 >= 100 ? [expect.stringContaining("over its budget")] : [],
    )
  })
})

describe("run", () => {
  it("writes the files that are stale and gives the address to hand an agent", () => {
    scaffold(full)
    const { out, err, io } = withIo()
    expect(run([], dir, io)).toBe(0)
    expect(err).toEqual([])
    expect(out.filter((line) => line.startsWith("[skill] wrote")).sort()).toEqual([
      "[skill] wrote skills/widget/SKILL.md\n",
      "[skill] wrote skills/widget/references/api.md\n",
    ])
    expect(out.at(-1)).toMatch(
      /^\[skill\] \d+ of 600 words\. Give an agent: https:\/\/raw\.githubusercontent\.com\/acme\/widget\/main\/skills\/widget\/SKILL\.md\n$/,
    )
    expect(read("skills/widget/SKILL.md")).toContain("# @acme/widget")
    const again = withIo()
    expect(run([], dir, again.io)).toBe(0)
    expect(again.out.some((line) => line.includes("wrote"))).toBe(false)
  })

  it("says what is missing from the skill as notes, writes nothing and fails when there are problems", () => {
    scaffold({ example: { file: "nope.ts" } })
    const { out, err, io } = withIo()
    expect(run([], dir, io)).toBe(1)
    expect(err.join("")).toBe(
      '[skill] - docs/skill.json: "example" names `nope.ts`, which is not in the package.\n',
    )
    expect(out.join("")).toContain("[skill] note: there are no rules")
  })

  it("lists every problem, one to a line", () => {
    scaffold({ when: 1, purpose: 2 })
    const { err, io } = withIo()
    expect(run([], dir, io)).toBe(1)
    expect(err.join("")).toBe(
      '[skill] - docs/skill.json: "when" must be text.\n- docs/skill.json: "purpose" must be text.\n',
    )
  })

  it("with --check writes nothing, and says what is stale or that it is current", () => {
    scaffold(full)
    const stale = withIo()
    expect(run(["--check"], dir, stale.io)).toBe(1)
    expect(stale.err.join("")).toBe(
      "[skill] stale: skills/widget/SKILL.md, skills/widget/references/api.md. Run `npx internal-package-contract skill` and commit the result.\n",
    )
    run([], dir, withIo().io)
    const current = withIo()
    expect(run(["--check"], dir, current.io)).toBe(0)
    expect(current.out.at(-1)).toMatch(/^\[skill\] current: \d+ of 600 words\.\n$/)
  })

  it("refuses an argument it does not know, or an extra one", () => {
    const unknown = withIo()
    expect(run(["--nope"], dir, unknown.io)).toBe(1)
    expect(unknown.err.join("")).toContain("skill: unknown argument --nope.")
    const extra = withIo()
    expect(run(["--check", "more"], dir, extra.io)).toBe(1)
    expect(extra.err.join("")).toContain("skill: unknown argument more.")
  })
})
