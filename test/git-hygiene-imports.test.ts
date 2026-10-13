import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  candidates,
  GENERATED,
  SOURCE_FILE,
  untrackedImports,
} from "../scripts/git-hygiene/imports.mjs"

const run = (files: Record<string, string>, tracked: string[], onDisk: string[]) =>
  untrackedImports({
    files,
    tracked: new Set(tracked),
    existsOnDisk: (file) => onDisk.includes(file) || tracked.includes(file),
  })

describe("candidates", () => {
  it("resolves against the importing file's folder, with and without the compiled extension", () => {
    const options = candidates("src/a/b.ts", "../c/d.js")
    expect(options[0]).toBe("src/c/d.js")
    expect(options).toContain("src/c/d.ts")
    expect(options).toContain("src/c/d.d.mts")
    expect(options).toContain("src/c/d.js.json")
    expect(options).toContain("src/c/d.js/index.ts")
    expect(candidates("a.ts", "./x")).toContain("x.mts")
    expect(candidates("a.ts", "./x")).toContain("x/index.mjs")
    expect(candidates("a.ts", "./x.mjs")).toContain("x.d.mts")
    expect(candidates("a.ts", "./x.cjs")).toContain("x.cts")
    expect(candidates("a.ts", "./x.jsx")).toContain("x.tsx")
    // Only a trailing compiled extension is swapped, never one in the middle of a name.
    expect(candidates("a.ts", "./a.js.d")).not.toContain("a.d.ts")
  })
})

describe("SOURCE_FILE", () => {
  it("is every script and module extension and nothing else", () => {
    for (const file of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.mjs", "a.cjs", "a.jsx"]) {
      expect(SOURCE_FILE.test(file)).toBe(true)
    }
    for (const file of ["a.json", "a.md", "a.tsx.map", "ts", "a.d.mts.txt"]) {
      expect(SOURCE_FILE.test(file)).toBe(false)
    }
  })
})

describe("untrackedImports and what a build produces", () => {
  it("does not count an import of a folder a build, test run or install fills in", () => {
    expect(GENERATED).toEqual([
      "node_modules/",
      "dist/",
      "coverage/",
      "reports/",
      ".stryker-tmp/",
      ".benchmark-local/",
    ])
    for (const folder of GENERATED) {
      expect(
        run({ "a.ts": `import x from "./${folder}x.js"` }, ["a.ts"], [`${folder}x.js`]),
      ).toEqual([])
    }
    // Only a folder at the root of that name is generated: a nested one with the same name is source.
    expect(run({ "a/b.ts": 'import x from "./dist/x.js"' }, ["a/b.ts"], ["a/dist/x.js"])).toEqual([
      { file: "a/b.ts", specifier: "./dist/x.js", target: "a/dist/x.js" },
    ])
    // A name that merely starts the same is not the folder.
    expect(
      run({ "a.ts": 'import x from "./distant/x.js"' }, ["a.ts"], ["distant/x.js"]),
    ).toHaveLength(1)
  })
})

describe("untrackedImports", () => {
  it("finds an import whose only target is on disk but not tracked, as the .gitignore bug did", () => {
    const found = run(
      { "scripts/run.mjs": 'import { scan } from "./coverage/scan.mjs"\n' },
      ["scripts/run.mjs"],
      ["scripts/coverage/scan.mjs"],
    )
    expect(found).toEqual([
      {
        file: "scripts/run.mjs",
        specifier: "./coverage/scan.mjs",
        target: "scripts/coverage/scan.mjs",
      },
    ])
  })

  it("accepts an import whose target is tracked, however it is written", () => {
    const text = [
      'import a from "./a.js"',
      'export { b } from "./b"',
      'const c = await import("./c.mjs")',
      'const d = require("./d")',
      'import "./e.mjs"',
      'import f from "./dir"',
      "import g from '../g.mjs'",
    ].join("\n")
    expect(
      run(
        { "src/x.ts": text },
        [
          "src/x.ts",
          "src/a.ts",
          "src/b.ts",
          "src/c.mts",
          "src/d.js",
          "src/e.mjs",
          "src/dir/index.ts",
          "g.mjs",
        ],
        [],
      ),
    ).toEqual([])
  })

  it("leaves an import that resolves to nothing to the type check, and ignores packages and absolute paths", () => {
    const text =
      'import a from "./missing"\nimport b from "lodash"\nimport c from "node:fs"\nimport d from "/abs/x"'
    expect(run({ "a.ts": text }, ["a.ts"], [])).toEqual([])
  })

  it("reports each offending import once per specifier and file, with the first target it finds", () => {
    const found = run(
      {
        "a.ts": 'import x from "./hidden"\nimport y from "./hidden2"',
        "b.ts": 'import x from "./hidden"',
      },
      ["a.ts", "b.ts"],
      ["hidden.ts", "hidden2.mjs"],
    )
    expect(found).toEqual([
      { file: "a.ts", specifier: "./hidden", target: "hidden.ts" },
      { file: "a.ts", specifier: "./hidden2", target: "hidden2.mjs" },
      { file: "b.ts", specifier: "./hidden", target: "hidden.ts" },
    ])
  })

  it("does not read a word that merely ends in from or import as an import", () => {
    expect(
      run(
        { "a.ts": 'const wasimport = "./hidden"\nconst xfrom = "./hidden"' },
        ["a.ts"],
        ["hidden.ts"],
      ),
    ).toEqual([])
  })
})

describe("the evidence gatherer, on the repository that failed CI", () => {
  it("sees that a .gitignore pattern hid the folder a tracked script imports from", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hygiene-"))
    try {
      const git = (...args: string[]) =>
        spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd: dir })
      git("init", "-q")
      writeFileSync(path.join(dir, ".gitignore"), "coverage/\n")
      mkdirSync(path.join(dir, "scripts", "coverage"), { recursive: true })
      writeFileSync(path.join(dir, "scripts", "coverage", "scan.mjs"), "export const scan = 1\n")
      writeFileSync(
        path.join(dir, "scripts", "run.mjs"),
        'import { scan } from "./coverage/scan.mjs"\n',
      )
      git("add", "-A")
      const evidence = (): { untrackedTargets: unknown[] } =>
        JSON.parse(
          spawnSync("node", [path.resolve("scripts/git-hygiene.mjs")], {
            cwd: dir,
            encoding: "utf8",
          }).stdout,
        ) as { untrackedTargets: unknown[] }
      expect(evidence().untrackedTargets).toEqual([
        {
          file: "scripts/run.mjs",
          specifier: "./coverage/scan.mjs",
          target: "scripts/coverage/scan.mjs",
        },
      ])
      writeFileSync(path.join(dir, ".gitignore"), "/coverage/\n")
      git("add", "-A")
      expect(evidence().untrackedTargets).toEqual([])
      // A folder is not a file: importing one that exists but holds nothing tracked is the resolver's to report.
      mkdirSync(path.join(dir, "empty"))
      writeFileSync(path.join(dir, "scripts", "dir.mjs"), 'import "../empty"\n')
      git("add", "-A")
      expect(evidence().untrackedTargets).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
