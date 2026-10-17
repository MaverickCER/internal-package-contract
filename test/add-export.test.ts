import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  planAddExport,
  stripJsonComments,
  validateExportName,
} from "../scripts/recipes/add-export.mjs"
import { planAddCheck } from "../scripts/recipes/add-check.mjs"
import { OPTIONAL_SETTINGS } from "../scripts/recipes/optional-settings.mjs"
import { run } from "../scripts/recipes/apply.mjs"

const template = path.resolve(import.meta.dirname, "../template/package")
// The scaffold's Markdown report configuration inherits its entry points from typedoc.json, so a recipe has
// nothing to add to it. A package that lists its own is the case worth exercising, so this stands in for it.
const OWN_ENTRY_POINTS = `{
  "$schema": "https://typedoc.org/schema.json",
  "extends": ["internal-package-contract/config/typedoc-markdown"],
  "entryPoints": ["src/index.ts"],
  "out": "docs/api-report",
  "readme": "none"
}
`
const read = (file: string) =>
  file === "typedoc.markdown.json"
    ? OWN_ENTRY_POINTS
    : readFileSync(path.join(template, file), "utf8").replaceAll("{{name}}", "demo-pkg")
const INPUTS = [
  "package.json",
  "tsup.config.ts",
  "scripts/emit-dts-shims.mjs",
  "typedoc.json",
  "typedoc.markdown.json",
  "knip.json",
]
const scaffold = (): Record<string, string | undefined> =>
  Object.fromEntries(INPUTS.map((file) => [file, read(file)]))
const plan = (
  name: string,
  change: (files: Record<string, string | undefined>) => void = () => {},
) => {
  const files = scaffold()
  change(files)
  return planAddExport({ name, files })
}
const written = (result: ReturnType<typeof planAddExport>, file: string) =>
  result.writes.find((write) => write.path === file)?.text

describe("validateExportName", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    for (const name of ["helpers", "eslint-plugin", "a1", "v2-api"]) {
      expect(validateExportName(name)).toBeUndefined()
    }
  })
  it("rejects anything else, saying why", () => {
    for (const name of ["", "Helpers", "1a", "a--b", "-a", "a-", "a_b", "a/b", "a.b"]) {
      expect(validateExportName(name)).toBe(
        `${JSON.stringify(name)} is not a usable export name: use lowercase letters, digits and single hyphens, starting with a letter.`,
      )
    }
    expect(validateExportName("index")).toBe(
      '"index" is reserved: "index" is the root entry and "package" would shadow package.json.',
    )
    expect(validateExportName("package")).toContain("is reserved")
  })
})

describe("stripJsonComments", () => {
  it("removes line and block comments and keeps everything else", () => {
    expect(stripJsonComments('{ "a": 1, // note\n "b": /* inline */ 2 }')).toBe(
      '{ "a": 1, \n "b":  2 }',
    )
    expect(stripJsonComments("// only\n{}")).toBe("\n{}")
  })
  it("leaves comment-like text inside a string alone, including an escaped quote before it", () => {
    expect(stripJsonComments('{"url": "https://x.test/a", "q": "say \\"//\\" now"}')).toBe(
      '{"url": "https://x.test/a", "q": "say \\"//\\" now"}',
    )
  })
  it("drops an unterminated block comment to the end", () => {
    expect(stripJsonComments("{} /* never closed")).toBe("{} ")
  })
  it("keeps a lone slash, and a slash pair that is not a comment inside a string", () => {
    expect(stripJsonComments('{"a": 1} / 2')).toBe('{"a": 1} / 2')
    expect(stripJsonComments('{"p": "a/*b*/c"}')).toBe('{"p": "a/*b*/c"}')
  })
  it("removes a block comment that spans lines, and each of several comments", () => {
    expect(stripJsonComments('{ /* a\n b */ "x": 1, /* c */ "y": 2 // d\n}')).toBe(
      '{  "x": 1,  "y": 2 \n}',
    )
  })
})

describe("planAddExport -- a scaffolded package", () => {
  // Planned inside each test: mutation testing can only attribute a mutant to a test when the code runs during it.
  it("plans exactly the files a new entry point touches, edited first and created after", () => {
    const result = plan("helpers")
    expect(result.problems).toEqual([])
    expect(
      result.writes.map((write) => `${write.created ? "create" : "update"} ${write.path}`),
    ).toEqual([
      "update package.json",
      "update tsup.config.ts",
      "update scripts/emit-dts-shims.mjs",
      "update typedoc.json",
      "update typedoc.markdown.json",
      "update knip.json",
      "create src/helpers/index.ts",
      "create test/helpers.test.ts",
      "create .changeset/add-helpers-export.md",
    ])
  })
  it("adds the exports entry beside the root one, in the same shape, before package.json", () => {
    const result = plan("helpers")
    const manifest = JSON.parse(written(result, "package.json") ?? "{}")
    expect(Object.keys(manifest.exports)).toEqual([".", "./helpers", "./package.json"])
    expect(manifest.exports["./helpers"]).toEqual({
      import: { types: "./dist/helpers.d.ts", default: "./dist/helpers.js" },
      require: { types: "./dist/helpers.d.cts", default: "./dist/helpers.cjs" },
    })
    expect(written(result, "package.json")?.endsWith("}\n")).toBe(true)
  })
  it("adds the bundler entry, the declaration shim and the two documentation entry points", () => {
    const result = plan("helpers")
    expect(written(result, "tsup.config.ts")).toContain(
      'entry: { index: "src/index.ts", helpers: "src/helpers/index.ts" }',
    )
    expect(written(result, "scripts/emit-dts-shims.mjs")).toContain(
      'const ENTRIES = [{ name: "index", dtsPath: "./.dts/index.js" }, { name: "helpers", dtsPath: "./.dts/helpers/index.js" }]\n',
    )
    expect(written(result, "typedoc.json")).toContain(
      '"entryPoints": ["src/index.ts", "src/helpers/index.ts"]',
    )
    expect(written(result, "typedoc.markdown.json")).toContain(
      '"entryPoints": ["src/index.ts", "src/helpers/index.ts"]',
    )
    expect(written(result, "knip.json")).toContain('"src/helpers/index.ts!"')
  })
  it("changes nothing else in the files it edits", () => {
    const result = plan("helpers")
    const before = read("tsup.config.ts")
    const after = written(result, "tsup.config.ts") ?? ""
    expect(after.replace(', helpers: "src/helpers/index.ts"', "")).toBe(before)
    const knipBefore = read("knip.json")
    expect((written(result, "knip.json") ?? "").replace(', "src/helpers/index.ts!"', "")).toBe(
      knipBefore,
    )
  })
  it("writes a documented placeholder module, a test that passes, and a changeset that cannot be released as is", () => {
    const result = plan("helpers")
    expect(written(result, "src/helpers/index.ts")).toBe(`/**
 * The \`demo-pkg/helpers\` entry point.
 * @packageDocumentation
 */

/**
 * Placeholder so the new entry builds and its test passes; replace it with the real exports.
 * @returns the name of this entry point.
 * @public
 */
export function entryName(): string {
  return "helpers"
}
`)
    expect(written(result, "test/helpers.test.ts")).toContain(
      'import { entryName } from "../src/helpers/index.js"',
    )
    expect(written(result, "test/helpers.test.ts")).toContain('expect(entryName()).toBe("helpers")')
    expect(written(result, ".changeset/add-helpers-export.md")).toBe(
      '---\n"demo-pkg": unset\n---\n\nAdd the `demo-pkg/helpers` entry point. Replace `unset` above with `patch`, `minor` or `major`, and describe the change here.\n',
    )
  })
  it("quotes a hyphenated name as a bundler key", () => {
    const hyphen = plan("eslint-plugin")
    expect(written(hyphen, "tsup.config.ts")).toContain(
      '"eslint-plugin": "src/eslint-plugin/index.ts"',
    )
  })
  it("leaves the scaffold's own typedoc.markdown.json alone, since it inherits the entry points", () => {
    const own = readFileSync(path.join(template, "typedoc.markdown.json"), "utf8")
    const result = plan("helpers", (files) => (files["typedoc.markdown.json"] = own))
    expect(result.problems).toEqual([])
    expect(result.writes.some((write) => write.path === "typedoc.markdown.json")).toBe(false)
  })
  it("does not need typedoc.markdown.json", () => {
    const without = plan("helpers", (files) => delete files["typedoc.markdown.json"])
    expect(without.problems).toEqual([])
    expect(without.writes.some((write) => write.path === "typedoc.markdown.json")).toBe(false)
  })
})

describe("planAddExport -- the surface source", () => {
  const withSurface = (files: Record<string, string | undefined>) => {
    files["docs/surface.json"] = read("docs/surface.json")
  }
  it("describes the new entry point in docs/surface.json, as one the maintainer still has to answer", () => {
    const result = plan("helpers", withSurface)
    expect(result.problems).toEqual([])
    const surface = JSON.parse(written(result, "docs/surface.json") ?? "{}")
    expect(Object.keys(surface.entries)).toEqual([".", "./helpers"])
    expect(surface.entries["./helpers"]).toEqual({
      source: "src/helpers/",
      environment: "isomorphic",
      tier: "Experimental",
      purpose: "TODO: say what a reader gets from this entry point.",
    })
    expect(
      result.writes.map((write) => write.path).filter((file) => file === "docs/surface.json"),
    ).toHaveLength(1)
  })
  it("leaves a package with no surface source alone", () => {
    expect(plan("helpers").writes.some((write) => write.path === "docs/surface.json")).toBe(false)
  })
  it("refuses an entry point the surface source already describes", () => {
    const result = plan("helpers", (files) => {
      files["docs/surface.json"] = JSON.stringify({ entries: { "./helpers": {} } })
    })
    expect(result.problems).toEqual(['docs/surface.json already describes "./helpers".'])
    expect(result.writes).toEqual([])
  })
  it("refuses a surface source it cannot add to", () => {
    for (const [text, message] of [
      ["{ nope", "docs/surface.json is not valid JSON, so the new entry cannot be added to it."],
      ["{}", 'docs/surface.json has no "entries" object to add the new entry point to.'],
      [
        '{"entries": []}',
        'docs/surface.json has no "entries" object to add the new entry point to.',
      ],
      [
        '{"entries": null}',
        'docs/surface.json has no "entries" object to add the new entry point to.',
      ],
    ] as const) {
      expect(
        plan("helpers", (files) => {
          files["docs/surface.json"] = text
        }).problems,
      ).toEqual([message])
    }
  })
})

describe("planAddExport -- refusals", () => {
  const problems = (name: string, change: (files: Record<string, string | undefined>) => void) =>
    plan(name, change).problems
  it("refuses a bad name before looking at anything", () => {
    expect(plan("Bad Name")).toEqual({
      writes: [],
      problems: [expect.stringContaining("is not a usable export name")],
    })
  })
  it("refuses when package.json is missing, invalid or nameless", () => {
    expect(problems("helpers", (f) => delete f["package.json"])).toEqual([
      "package.json does not exist.",
    ])
    expect(plan("helpers", (f) => (f["package.json"] = "{"))).toEqual({
      writes: [],
      problems: ["package.json is not valid JSON, so the new entry cannot be added to it."],
    })
    expect(
      problems("helpers", (f) => (f["package.json"] = JSON.stringify({ exports: { ".": {} } }))),
    ).toContain("package.json has no `name`.")
  })
  it("refuses an export it already has, or files it would overwrite", () => {
    expect(
      problems("helpers", (f) => {
        const manifest = JSON.parse(f["package.json"] ?? "{}")
        manifest.exports["./helpers"] = "./x.js"
        f["package.json"] = JSON.stringify(manifest)
      }),
    ).toEqual(['package.json already exports "./helpers".'])
    expect(problems("helpers", (f) => (f["src/helpers/index.ts"] = "x"))).toEqual([
      "src/helpers/index.ts already exists.",
    ])
    expect(problems("helpers", (f) => (f["test/helpers.test.ts"] = "x"))).toEqual([
      "test/helpers.test.ts already exists.",
    ])
    expect(problems("helpers", (f) => (f[".changeset/add-helpers-export.md"] = "x"))).toEqual([
      ".changeset/add-helpers-export.md already exists.",
    ])
  })
  it("refuses a root export that is null", () => {
    expect(
      problems(
        "helpers",
        (f) => (f["package.json"] = JSON.stringify({ name: "p", exports: { ".": null } })),
      ),
    ).toEqual(['package.json has no object `exports["."]` to copy the entry shape from.'])
  })
  it("refuses a package with no object root export to copy the shape from", () => {
    const message = 'package.json has no object `exports["."]` to copy the entry shape from.'
    expect(problems("helpers", (f) => (f["package.json"] = JSON.stringify({ name: "p" })))).toEqual(
      [message],
    )
    expect(
      problems(
        "helpers",
        (f) => (f["package.json"] = JSON.stringify({ name: "p", exports: { ".": "./i.js" } })),
      ),
    ).toEqual([message])
    expect(
      problems(
        "helpers",
        (f) => (f["package.json"] = JSON.stringify({ name: "p", exports: { ".": ["./i.js"] } })),
      ),
    ).toEqual([message])
  })
  it("refuses a missing file it has to edit", () => {
    for (const file of [
      "tsup.config.ts",
      "scripts/emit-dts-shims.mjs",
      "typedoc.json",
      "knip.json",
    ]) {
      expect(problems("helpers", (f) => delete f[file])).toEqual([
        `${file} does not exist, and the new entry has to be added to it.`,
      ])
    }
  })
  it("refuses a bundler config with no entry object, or with several builds", () => {
    expect(problems("helpers", (f) => (f["tsup.config.ts"] = "export default {}"))).toEqual([
      "tsup.config.ts has no `entry: { ... }` object to add the new entry to.",
    ])
    expect(
      problems(
        "helpers",
        (f) => (f["tsup.config.ts"] = 'a({ entry: { a: "x" } })\nb({ entry: { b: "y" } })'),
      ),
    ).toEqual([
      "tsup.config.ts has 2 `entry` blocks (several builds), and which one gets the new entry is a decision, so wire it by hand.",
    ])
  })
  it("refuses a shim list it cannot find", () => {
    expect(
      problems("helpers", (f) => (f["scripts/emit-dts-shims.mjs"] = "const ENTRIES = 1")),
    ).toEqual([
      "scripts/emit-dts-shims.mjs has no `const ENTRIES = [ ... ]` list to add the new entry to.",
    ])
  })
  it("refuses documentation and dead-code lists that are not lists or not JSON", () => {
    expect(problems("helpers", (f) => (f["typedoc.json"] = "{}"))).toEqual([
      'typedoc.json has no `entryPoints` list to add "src/helpers/index.ts" to.',
    ])
    expect(problems("helpers", (f) => (f["knip.json"] = '{"entry": "x"}'))).toEqual([
      'knip.json has no `entry` list to add "src/helpers/index.ts!" to.',
    ])
    expect(problems("helpers", (f) => (f["typedoc.markdown.json"] = "{"))).toEqual([
      "typedoc.markdown.json is not valid JSON, so the new entry cannot be added to it.",
    ])
  })
  it("leaves a configuration that extends another alone, since it inherits the entry points", () => {
    const result = plan(
      "helpers",
      (f) => (f["typedoc.markdown.json"] = '{ "extends": ["./typedoc.json"] }'),
    )
    expect(result.problems).toEqual([])
    expect(result.writes.some((write) => write.path === "typedoc.markdown.json")).toBe(false)
  })
  it("reads configuration that carries comments, and edits it in place", () => {
    const commented =
      '{\n  // entries\n  "entry": ["src/index.ts!", "scripts/*.mjs"] /* end */\n}\n'
    const result = plan("helpers", (f) => (f["knip.json"] = commented))
    expect(result.problems).toEqual([])
    expect(written(result, "knip.json")).toBe(
      '{\n  // entries\n  "entry": ["src/index.ts!", "scripts/*.mjs", "src/helpers/index.ts!"] /* end */\n}\n',
    )
  })
  it("finds an entry object however it is spaced, and counts every build block", () => {
    const spaced = plan(
      "helpers",
      (f) => (f["tsup.config.ts"] = 'defineConfig({ entry:\n    { index: "src/index.ts" } })'),
    )
    expect(written(spaced, "tsup.config.ts")).toBe(
      'defineConfig({ entry: { index: "src/index.ts", helpers: "src/helpers/index.ts" } })',
    )
    const many = plan(
      "helpers",
      (f) => (f["tsup.config.ts"] = 'a({ entry:  { a: "x" } })\nb({ entry:\n { b: "y" } })'),
    )
    expect(many.problems).toEqual([
      "tsup.config.ts has 2 `entry` blocks (several builds), and which one gets the new entry is a decision, so wire it by hand.",
    ])
  })
  it("adds after a trailing comma or into an empty entry list without a stray comma", () => {
    const trailing = plan(
      "helpers",
      (f) => (f["tsup.config.ts"] = 'defineConfig({ entry: { index: "src/index.ts", } })'),
    )
    expect(written(trailing, "tsup.config.ts")).toBe(
      'defineConfig({ entry: { index: "src/index.ts", helpers: "src/helpers/index.ts" } })',
    )
    const empty = plan("helpers", (f) => (f["tsup.config.ts"] = "defineConfig({ entry: {} })"))
    expect(written(empty, "tsup.config.ts")).toBe(
      'defineConfig({ entry: { helpers: "src/helpers/index.ts" } })',
    )
    const shims = plan(
      "helpers",
      (f) =>
        (f["scripts/emit-dts-shims.mjs"] =
          'const ENTRIES = [\n  { name: "index", dtsPath: "./i.js" },\n]\n'),
    )
    expect(written(shims, "scripts/emit-dts-shims.mjs")).toBe(
      'const ENTRIES = [{ name: "index", dtsPath: "./i.js" }, { name: "helpers", dtsPath: "./.dts/helpers/index.js" }]\n',
    )
    const emptyShims = plan(
      "helpers",
      (f) => (f["scripts/emit-dts-shims.mjs"] = "const ENTRIES = []\n"),
    )
    expect(written(emptyShims, "scripts/emit-dts-shims.mjs")).toBe(
      'const ENTRIES = [{ name: "helpers", dtsPath: "./.dts/helpers/index.js" }]\n',
    )
  })
  it("starts a list that is empty", () => {
    const result = plan("helpers", (f) => (f["knip.json"] = '{ "entry": [] }'))
    expect(written(result, "knip.json")).toBe('{ "entry": ["src/helpers/index.ts!"] }')
  })
  it("reports every problem at once, and writes nothing", () => {
    const result = plan("helpers", (f) => {
      delete f["tsup.config.ts"]
      f["typedoc.json"] = "{}"
    })
    expect(result.writes).toEqual([])
    expect(result.problems).toHaveLength(2)
  })
})

describe("add (run)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-add-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  const seed = () => {
    for (const file of INPUTS) put(file, read(file))
  }
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: dir,
      encoding: "utf8",
    })
  const sink = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
  }
  const add = (args: string[], format?: (paths: string[]) => void) => {
    const s = sink()
    const code = run(args, dir, s.io, format === undefined ? { format: () => {} } : { format })
    return { code, out: s.out.join(""), err: s.err.join("") }
  }
  const USAGE =
    "Usage: internal-package-contract add export <name> [--dry-run]\n       internal-package-contract add check <Name> [--dry-run]\n"

  it("rejects an unknown recipe, a missing name and an unknown flag", () => {
    expect(add(["nope", "x"])).toEqual({
      code: 2,
      out: "",
      err: `[add] unknown recipe: nope. Available: export, check.\n${USAGE}`,
    })
    expect(add([]).err).toBe(
      `[add] unknown recipe: (none given). Available: export, check.\n${USAGE}`,
    )
    expect(add(["export"]).err).toBe(`[add] expected: add export <name> [--dry-run]\n${USAGE}`)
    expect(add(["export", "x", "--nope"]).err).toBe(
      `[add] expected: add export <name> [--dry-run]\n${USAGE}`,
    )
  })
  it("prints every problem and writes nothing when a file is not what it expects", () => {
    seed()
    put("tsup.config.ts", "export default {}")
    const result = add(["export", "helpers"])
    expect(result.code).toBe(1)
    expect(result.err).toBe(
      "[add] nothing was written:\n- tsup.config.ts has no `entry: { ... }` object to add the new entry to.\n",
    )
    expect(existsSync(path.join(dir, "src/helpers/index.ts"))).toBe(false)
  })
  it("previews with --dry-run and changes nothing", () => {
    seed()
    const result = add(["export", "helpers", "--dry-run"])
    expect(result.code).toBe(0)
    expect(result.out).toBe(
      [
        "Would write:",
        "  update  package.json",
        "  update  tsup.config.ts",
        "  update  scripts/emit-dts-shims.mjs",
        "  update  typedoc.json",
        "  update  typedoc.markdown.json",
        "  update  knip.json",
        "  create  src/helpers/index.ts",
        "  create  test/helpers.test.ts",
        "  create  .changeset/add-helpers-export.md",
        "",
      ].join("\n"),
    )
    expect(existsSync(path.join(dir, "src/helpers/index.ts"))).toBe(false)
    expect(readFileSync(path.join(dir, "tsup.config.ts"), "utf8")).toBe(read("tsup.config.ts"))
  })
  it("says nothing about the surface file when the package has none, and sends the author to it when it has one", () => {
    seed()
    const plain = add(["export", "helpers"])
    expect(plain.out.endsWith("and `internal-package-contract update-baseline`.\n")).toBe(true)
    expect(plain.out).not.toContain("surface.json")
    rmSync(path.join(dir, "src"), { recursive: true, force: true })
    rmSync(path.join(dir, "test"), { recursive: true, force: true })
    rmSync(path.join(dir, ".changeset"), { recursive: true, force: true })
    seed()
    put("docs/surface.json", read("docs/surface.json"))
    const withSurface = add(["export", "helpers"])
    expect(
      withSurface.out.endsWith(
        "update-baseline`.\nThen describe the entry point in docs/surface.json (its tier is yours to set) and run `internal-package-contract generate` to refresh the tables that list the entry points.\n",
      ),
    ).toBe(true)
  })
  it("writes the files, then formats exactly what it wrote and says what to do next", () => {
    seed()
    const formatted: string[][] = []
    const result = add(["export", "helpers"], (paths) => formatted.push(paths))
    expect(result.code).toBe(0)
    expect(result.out).toContain("Writing:\n  update  package.json\n")
    expect(result.out).toContain(
      "\nNext: write the export in src/helpers/index.ts, set the bump in .changeset/add-helpers-export.md, then run `npm run docs:api:report` and `internal-package-contract update-baseline`.\n",
    )
    expect(formatted).toEqual([
      [
        "package.json",
        "tsup.config.ts",
        "scripts/emit-dts-shims.mjs",
        "typedoc.json",
        "typedoc.markdown.json",
        "knip.json",
        "src/helpers/index.ts",
        "test/helpers.test.ts",
        ".changeset/add-helpers-export.md",
      ],
    ])
    expect(readFileSync(path.join(dir, "src/helpers/index.ts"), "utf8")).toContain(
      "export function entryName()",
    )
    expect(
      JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).exports["./helpers"],
    ).toBeDefined()
  })
  it("refuses to run over uncommitted changes to a file it would edit", () => {
    seed()
    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "seed")
    put("package.json", `${read("package.json")}\n`)
    const result = add(["export", "helpers"])
    expect(result.code).toBe(1)
    expect(result.err).toBe(
      "[add] nothing was written: these files have uncommitted changes, which a failed run could not tell apart from its own. Commit or stash them first:\n- package.json\n",
    )
    expect(existsSync(path.join(dir, "src/helpers/index.ts"))).toBe(false)
  })
  it("runs over a clean tree, and over a directory that is not a git repository", () => {
    seed()
    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "seed")
    expect(add(["export", "helpers"]).code).toBe(0)
    const plain = mkdtempSync(path.join(tmpdir(), "ipc-add-plain-"))
    try {
      for (const file of INPUTS) {
        mkdirSync(path.dirname(path.join(plain, file)), { recursive: true })
        writeFileSync(path.join(plain, file), read(file))
      }
      const s = sink()
      expect(run(["export", "helpers"], plain, s.io, { format: () => {} })).toBe(0)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
  it("puts every file back when a write fails part way", () => {
    seed()
    writeFileSync(path.join(dir, "src"), "a file where the source directory should be")
    const before = Object.fromEntries(
      INPUTS.map((file) => [file, readFileSync(path.join(dir, file), "utf8")]),
    )
    const result = add(["export", "helpers"])
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/^\[add\] a write failed, and every file was put back: /)
    for (const file of INPUTS) expect(readFileSync(path.join(dir, file), "utf8")).toBe(before[file])
    expect(existsSync(path.join(dir, "test/helpers.test.ts"))).toBe(false)
    expect(existsSync(path.join(dir, ".changeset/add-helpers-export.md"))).toBe(false)
  })
  it("is reachable as `internal-package-contract add export`, and formats with the package's Prettier when it has one", () => {
    seed()
    const bin = path.resolve(import.meta.dirname, "../bin/contract.mjs")
    const result = spawnSync(process.execPath, [bin, "add", "export", "helpers", "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Would write:")
  })
  it("lists several problems one per line", () => {
    seed()
    put("tsup.config.ts", "export default {}")
    put("knip.json", "{}")
    expect(add(["export", "helpers"]).err).toBe(
      '[add] nothing was written:\n- tsup.config.ts has no `entry: { ... }` object to add the new entry to.\n- knip.json has no `entry` list to add "src/helpers/index.ts!" to.\n',
    )
  })
  it("lists several uncommitted files one per line", () => {
    seed()
    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "seed")
    put("package.json", `${read("package.json")}\n`)
    put("knip.json", `${read("knip.json")}\n`)
    expect(add(["export", "helpers"]).err).toBe(
      "[add] nothing was written: these files have uncommitted changes, which a failed run could not tell apart from its own. Commit or stash them first:\n- knip.json\n- package.json\n",
    )
  })
  it("removes a file it created, and restores the ones it edited, when a later write fails", () => {
    seed()
    writeFileSync(path.join(dir, "test"), "a file where the test directory should be")
    const result = add(["export", "helpers"])
    expect(result.code).toBe(1)
    expect(existsSync(path.join(dir, "src/helpers/index.ts"))).toBe(false)
    for (const file of INPUTS) expect(readFileSync(path.join(dir, file), "utf8")).toBe(read(file))
  })
  it("formats with the package's own Prettier by default, naming exactly what it wrote", () => {
    seed()
    const calls: unknown[][] = []
    const s = sink()
    const code = run(["export", "helpers"], dir, s.io, {
      spawn: (...args: unknown[]) => calls.push(args),
    })
    expect(code).toBe(0)
    expect(calls).toEqual([
      [
        "npx",
        [
          "--no-install",
          "prettier",
          "--write",
          "package.json",
          "tsup.config.ts",
          "scripts/emit-dts-shims.mjs",
          "typedoc.json",
          "typedoc.markdown.json",
          "knip.json",
          "src/helpers/index.ts",
          "test/helpers.test.ts",
          ".changeset/add-helpers-export.md",
        ],
        { cwd: dir, stdio: "ignore" },
      ],
    ])
  })
})

describe("planAddCheck", () => {
  const manifest = (extra: object = {}, indent: string | number = 2, tail = "\n") =>
    `${JSON.stringify({ name: "p", version: "1.0.0", ...extra }, null, indent)}${tail}`
  const DEFAULTS = {
    child_process: [],
    env: [],
    fs: ["bin"],
    forbiddenDependencies: [],
  }
  it("names the check and writes its settings out, keeping the file's indentation and ending", () => {
    for (const [indent, tail] of [
      [2, "\n"],
      ["\t", "\n"],
      [4, ""],
    ] as const) {
      const result = planAddCheck({
        name: "AmbientCapabilities",
        packageJson: manifest({}, indent, tail),
      })
      expect(result.problems).toEqual([])
      expect(result.text).toBe(
        manifest(
          {
            "internal-package-contract": {
              checks: ["AmbientCapabilities"],
              ambientCapabilities: DEFAULTS,
            },
          },
          indent,
          tail,
        ),
      )
    }
  })
  it("lists every check that exists, separated by commas", () => {
    const table = OPTIONAL_SETTINGS as Record<string, object>
    table["Other"] = {}
    try {
      expect(planAddCheck({ name: "Nope", packageJson: "{}" }).problems).toEqual([
        "unknown check: Nope. Available: AgentSkill, AmbientCapabilities, Other.",
      ])
    } finally {
      delete table["Other"]
    }
  })
  it("writes two spaces to a file with no indentation to follow", () => {
    expect(
      planAddCheck({ name: "AmbientCapabilities", packageJson: '{"name": "p"}' }).text,
    ).toMatch(/^\{\n {2}"name": "p",\n {2}"internal-package-contract"/)
  })
  it("keeps what the package already wrote, and its other settings", () => {
    const own = {
      copies: ["glob"],
      checks: ["Other"],
      ambientCapabilities: { env: [] },
    }
    const result = planAddCheck({
      name: "AmbientCapabilities",
      packageJson: manifest({ "internal-package-contract": own }),
    })
    expect(JSON.parse(result.text ?? "")["internal-package-contract"]).toEqual({
      copies: ["glob"],
      checks: ["AmbientCapabilities", "Other"],
      ambientCapabilities: { env: [] },
    })
  })
  it("changes nothing when the check is already on", () => {
    const text = manifest({ "internal-package-contract": { checks: ["AmbientCapabilities"] } })
    expect(planAddCheck({ name: "AmbientCapabilities", packageJson: text })).toEqual({
      problems: [],
      text,
      already: true,
    })
  })
  it("says what is wrong", () => {
    const plan = (name: string, packageJson: string | undefined) =>
      planAddCheck({ name, packageJson }).problems
    expect(plan("Nope", manifest())).toEqual([
      "unknown check: Nope. Available: AgentSkill, AmbientCapabilities.",
    ])
    expect(plan("toString", manifest())).toHaveLength(1)
    expect(plan("AmbientCapabilities", undefined)).toEqual(["package.json does not exist here."])
    expect(plan("AmbientCapabilities", "{")).toEqual(["package.json is not valid JSON."])
    for (const bad of [[], 3]) {
      expect(plan("AmbientCapabilities", manifest({ "internal-package-contract": bad }))).toEqual([
        '"internal-package-contract" in package.json must be an object.',
      ])
    }
    expect(
      plan("AmbientCapabilities", manifest({ "internal-package-contract": { checks: "x" } })),
    ).toEqual(['"internal-package-contract"."checks" must be a list of check names.'])
  })
})

describe("add check (run)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-add-check-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (text: string) => writeFileSync(path.join(dir, "package.json"), text)
  const read = () => readFileSync(path.join(dir, "package.json"), "utf8")
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: dir,
      encoding: "utf8",
    })
  const add = (args: string[], formatted: string[][] = []) => {
    const out: string[] = []
    const err: string[] = []
    const code = run(
      args,
      dir,
      { out: (t) => out.push(t), err: (t) => err.push(t) },
      {
        format: (paths) => formatted.push(paths),
      },
    )
    return { code, out: out.join(""), err: err.join("") }
  }
  const USAGE =
    "Usage: internal-package-contract add export <name> [--dry-run]\n       internal-package-contract add check <Name> [--dry-run]\n"

  it("asks for a name, and rejects an unknown flag", () => {
    expect(add(["check"])).toEqual({
      code: 2,
      out: "",
      err: `[add] expected: add check <Name> [--dry-run]\n${USAGE}`,
    })
    expect(add(["check", "AmbientCapabilities", "--nope"]).code).toBe(2)
  })
  it("says what is wrong and writes nothing", () => {
    expect(add(["check", "AmbientCapabilities"])).toEqual({
      code: 1,
      out: "",
      err: "[add] nothing was written:\n- package.json does not exist here.\n",
    })
    put("{}")
    expect(add(["check", "Nope"]).err).toBe(
      "[add] nothing was written:\n- unknown check: Nope. Available: AgentSkill, AmbientCapabilities.\n",
    )
    expect(read()).toBe("{}")
  })
  it("previews with --dry-run and changes nothing", () => {
    put("{}\n")
    expect(add(["check", "AmbientCapabilities", "--dry-run"])).toEqual({
      code: 0,
      out: "Would write:\n  update  package.json\n",
      err: "",
    })
    expect(read()).toBe("{}\n")
  })
  it("turns the check on, formats the file, and says what to do next", () => {
    put("{}\n")
    const formatted: string[][] = []
    const result = add(["check", "AmbientCapabilities"], formatted)
    expect(result.code).toBe(0)
    expect(result.out).toBe(
      'Writing:\n  update  package.json\n\nNext: read the settings written under "internal-package-contract" in package.json and change what differs for this package, then run `npm run contract`.\n',
    )
    expect(JSON.parse(read())["internal-package-contract"].checks).toEqual(["AmbientCapabilities"])
    expect(formatted).toEqual([["package.json"]])
  })
  it("says so when the check is already on, without formatting anything", () => {
    put(JSON.stringify({ "internal-package-contract": { checks: ["AmbientCapabilities"] } }))
    const formatted: string[][] = []
    expect(add(["check", "AmbientCapabilities"], formatted)).toEqual({
      code: 0,
      out: "AmbientCapabilities is already turned on in package.json.\n",
      err: "",
    })
    expect(formatted).toEqual([])
  })
  it("is not stopped by uncommitted changes to other files", () => {
    put("{}\n")
    git("init", "-q")
    git("add", ".")
    git("commit", "-qm", "init")
    writeFileSync(path.join(dir, "other.txt"), "x")
    expect(add(["check", "AmbientCapabilities"]).code).toBe(0)
  })
  it("formats with the package's own Prettier by default", () => {
    put("{}\n")
    const calls: unknown[][] = []
    const code = run(
      ["check", "AmbientCapabilities"],
      dir,
      { out: () => {}, err: () => {} },
      { spawn: ((...args: unknown[]) => calls.push(args)) as never },
    )
    expect(code).toBe(0)
    expect(calls).toEqual([
      [
        "npx",
        ["--no-install", "prettier", "--write", "package.json"],
        { cwd: dir, stdio: "ignore" },
      ],
    ])
  })
  it("refuses when package.json has uncommitted changes", () => {
    put("{}\n")
    git("init", "-q")
    git("add", ".")
    git("commit", "-qm", "init")
    put('{ "name": "x" }\n')
    const result = add(["check", "AmbientCapabilities"])
    expect(result.code).toBe(1)
    expect(result.err).toBe(
      "[add] nothing was written: package.json has uncommitted changes, which a failed run could not tell apart from its own. Commit or stash them first.\n",
    )
    expect(read()).toBe('{ "name": "x" }\n')
  })
})
