import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  collectSurface,
  defaultRunBin,
  listedCommands,
} from "../scripts/surface-contract/collect.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "surface-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), text)
}
const pkg = (extra: object): void =>
  write("package.json", JSON.stringify({ name: "@o/demo", version: "0.1.0", ...extra }))
const fake =
  (files: Record<string, { exitCode: number | null; stdout: string }>) => (file: string) =>
    files[path.relative(root, file).split(path.sep).join("/")] ?? { exitCode: null, stdout: "" }

describe("collectSurface: nothing exposed", () => {
  it("returns an empty surface for a library with no bin, schema or action", async () => {
    pkg({ exports: { ".": { import: { types: "./dist/index.d.ts" } } } })
    expect(await collectSurface(root, { runBin: fake({}) })).toEqual({
      cli: {},
      schemas: {},
      action: null,
      workflows: {},
    })
  })
})

describe("collectSurface: CLIs", () => {
  it("runs every bin declared as an object and normalizes line endings and trailing spaces", async () => {
    write("dist/a.js", "")
    write("dist/b.js", "")
    pkg({ bin: { a: "./dist/a.js", b: "dist/b.js" } })
    const surface = await collectSurface(root, {
      runBin: fake({
        "dist/a.js": { exitCode: 0, stdout: "Usage: a  \r\n  --x   \r\n\r\n" },
        "dist/b.js": { exitCode: 1, stdout: "bad" },
      }),
    })
    expect(surface.cli).toEqual({
      a: { exitCode: 0, help: "Usage: a\n  --x", commands: {} },
      b: { exitCode: 1, help: "bad", commands: {} },
    })
  })
  it("runs `<command> --help` for every command the help lists, with or without the bin's name", async () => {
    write("cli.js", "")
    pkg({ bin: { tool: "cli.js" } })
    const calls: string[][] = []
    const surface = await collectSurface(root, {
      runBin: (_file, _cwd, args = ["--help"]) => {
        calls.push([...args])
        return args.length === 1
          ? {
              exitCode: 0,
              stdout:
                "Usage: tool <command>\n\nCommands:\n  tool init     Scaffold\n  sync          Copy files\n  --json        not a command\n  (none)        not a command\n   deeper       not a command\n  one space    not a command\n  Upper         not a command\n  init          listed twice",
            }
          : { exitCode: args[0] === "sync" ? 2 : 0, stdout: `help for ${String(args[0])}  \r\n` }
      },
    })
    expect(calls).toEqual([["--help"], ["init", "--help"], ["sync", "--help"]])
    expect(surface.cli["tool"]?.commands).toEqual({
      init: { exitCode: 0, help: "help for init" },
      sync: { exitCode: 2, help: "help for sync" },
    })
  })
  it("lists each command once, sorted, whatever order the help prints them in", () => {
    expect(
      listedCommands("Commands:\n  zeta  Do z.\n  alpha  Do a.\n  zeta  Again.\n", "demo"),
    ).toEqual(["alpha", "zeta"])
  })
  it("treats the bin's name literally when it contains regular-expression characters", async () => {
    write("cli.js", "")
    pkg({ bin: { "a.b": "cli.js" } })
    const surface = await collectSurface(root, {
      runBin: (_file, _cwd, args = ["--help"]) =>
        args.length === 1
          ? { exitCode: 0, stdout: "Commands:\n  a.b run    Go\n  aXb skip   No" }
          : { exitCode: 0, stdout: "h" },
    })
    expect(Object.keys(surface.cli["a.b"]?.commands ?? {})).toEqual(["run"])
  })
  it("names a string bin after the unscoped package name", async () => {
    write("bin.js", "")
    pkg({ bin: "bin.js" })
    const surface = await collectSurface(root, {
      runBin: fake({ "bin.js": { exitCode: 0, stdout: "h" } }),
    })
    expect(Object.keys(surface.cli)).toEqual(["demo"])
  })
  it("refuses a bin whose file does not exist, saying to build first", async () => {
    pkg({ bin: { a: "./dist/a.js" } })
    await expect(collectSurface(root, { runBin: fake({}) })).rejects.toThrow(
      /bin "a".*dist\/a\.js.*does not exist.*build/s,
    )
  })
  it("runs the real file with --help through defaultRunBin", () => {
    write(
      "cli.mjs",
      'process.stdout.write(process.argv.slice(2).join(" ") + "|" + process.env.NO_COLOR + "|" + process.env.FORCE_COLOR); process.exitCode = 3',
    )
    expect(defaultRunBin(path.join(root, "cli.mjs"), root)).toEqual({
      exitCode: 3,
      stdout: "--help|1|0",
    })
    expect(defaultRunBin(path.join(root, "cli.mjs"), root, ["init", "--help"])).toEqual({
      exitCode: 3,
      stdout: "init --help|1|0",
    })
  })
  it("falls back to stderr when the CLI prints its help there", () => {
    write("cli.mjs", 'process.stderr.write("on stderr")')
    expect(defaultRunBin(path.join(root, "cli.mjs"), root)).toEqual({
      exitCode: 0,
      stdout: "on stderr",
    })
  })
})

describe("collectSurface: schemas", () => {
  it("reads exported JSON files and expands a wildcard export, ignoring package.json and conditions", async () => {
    write("schemas/one.schema.json", '{"type":"object"}')
    write("schemas/two.schema.json", '{"type":"string"}')
    write("schemas/notes.txt", "x")
    write("schemas/main.json", '{"type":"number"}')
    pkg({
      exports: {
        ".": { import: "./dist/index.js" },
        "./schema": "./schemas/main.json",
        "./schema/*": "./schemas/*.schema.json",
        "./package.json": "./package.json",
        "./other": "./dist/other.js",
      },
    })
    const surface = await collectSurface(root, { runBin: fake({}) })
    expect(surface.schemas).toEqual({
      "./schema": { type: "number" },
      "./schema/one": { type: "object" },
      "./schema/two": { type: "string" },
    })
  })
  it("reads an exported JSON document that carries comments and trailing commas, as a shared tsconfig does", async () => {
    write(
      "tsconfig.json",
      '// shared\n{\n  /* strict */ "compilerOptions": { "strict": true, },\n}\n',
    )
    pkg({ exports: { "./tsconfig": "./tsconfig.json" } })
    expect((await collectSurface(root, { runBin: fake({}) })).schemas).toEqual({
      "./tsconfig": { compilerOptions: { strict: true } },
    })
  })
  it("fails, naming the file, on JSON that cannot be read at all", async () => {
    write("bad.json", "{ nope")
    pkg({ exports: { "./bad": "./bad.json" } })
    await expect(collectSurface(root, { runBin: fake({}) })).rejects.toThrow(/bad\.json/)
  })
  it("fails clearly when an exported schema file is missing", async () => {
    pkg({ exports: { "./schema": "./schemas/missing.json" } })
    await expect(collectSurface(root, { runBin: fake({}) })).rejects.toThrow(
      /schemas[\\/]missing\.json/,
    )
  })
  it("skips a wildcard whose directory does not exist", async () => {
    pkg({ exports: { "./s/*": "./nowhere/*.json" } })
    expect((await collectSurface(root, { runBin: fake({}) })).schemas).toEqual({})
  })
  it("ignores a wildcard whose star is not in the file name", async () => {
    write("a/x/f.json", "{}")
    pkg({ exports: { "./s/*": "./a/*/f.json" } })
    expect((await collectSurface(root, { runBin: fake({}) })).schemas).toEqual({})
  })
})

describe("collectSurface: edge cases", () => {
  it("names a string bin after an unscoped package too, and after the part following a long scope", async () => {
    write("bin.js", "")
    write("package.json", JSON.stringify({ name: "plain", version: "1.0.0", bin: "bin.js" }))
    expect(
      Object.keys(
        (await collectSurface(root, { runBin: fake({ "bin.js": { exitCode: 0, stdout: "h" } }) }))
          .cli,
      ),
    ).toEqual(["plain"])
    write(
      "package.json",
      JSON.stringify({ name: "@longscope/tool", version: "1.0.0", bin: "bin.js" }),
    )
    expect(
      Object.keys(
        (await collectSurface(root, { runBin: fake({ "bin.js": { exitCode: 0, stdout: "h" } }) }))
          .cli,
      ),
    ).toEqual(["tool"])
  })
  it("matches a wildcard file name on both its prefix and its suffix", async () => {
    for (const name of [
      "m-one.s.json",
      "one.s.json",
      "m-two.json",
      "xm-three.s.json",
      "m-.s.json",
    ]) {
      write(`schemas/${name}`, "{}")
    }
    pkg({ exports: { "./s/*": "./schemas/m-*.s.json" } })
    expect(Object.keys((await collectSurface(root, { runBin: fake({}) })).schemas)).toEqual(
      ["./s/", "./s/one"].sort(),
    )
  })
  it("replaces every star in a wildcard key, not only the first", async () => {
    write("schemas/one.json", "{}")
    pkg({ exports: { "./s/*/v/*": "./schemas/*.json" } })
    expect(Object.keys((await collectSurface(root, { runBin: fake({}) })).schemas)).toEqual([
      "./s/one/v/one",
    ])
  })
  it("ignores a wildcard export whose target has no star in the file name, and a star key with a plain target", async () => {
    write("a/f.json", "{}")
    pkg({ exports: { "./s/*": "./a/f.json" } })
    expect((await collectSurface(root, { runBin: fake({}) })).schemas).toEqual({})
  })
  it("reports an unreadable JSON file by its path", async () => {
    write("bad.json", "{ nope")
    pkg({ exports: { "./bad": "./bad.json" } })
    await expect(collectSurface(root, { runBin: fake({}) })).rejects.toThrow(
      `${path.join(root, "bad.json")} is not readable JSON.`,
    )
  })
})

describe("collectSurface: action", () => {
  it("reads inputs (required, default) and outputs from action.yml", async () => {
    write(
      "action.yml",
      [
        "name: x",
        "inputs:",
        "  args:",
        "    description: d",
        "    required: true",
        "  mode:",
        "    default: fast",
        "  empty:",
        '    default: ""',
        "outputs:",
        "  result:",
        "    description: r",
        "  alpha:",
        "    description: a",
        "runs:",
        "  using: composite",
        "  steps: []",
      ].join("\n"),
    )
    pkg({})
    expect((await collectSurface(root, { runBin: fake({}) })).action).toEqual({
      inputs: {
        args: { required: true, default: null },
        empty: { required: false, default: "" },
        mode: { required: false, default: "fast" },
      },
      outputs: ["alpha", "result"],
    })
  })
  it("reads action.yaml when there is no action.yml, and tolerates an action with no inputs or outputs", async () => {
    write("action.yaml", "name: x\nruns:\n  using: node24\n  main: i.js\n")
    pkg({})
    expect((await collectSurface(root, { runBin: fake({}) })).action).toEqual({
      inputs: {},
      outputs: [],
    })
  })
  it("reads an input declared with no body as optional with no default, and outputs in sorted order", async () => {
    write("action.yml", "name: x\ninputs:\n  bare:\noutputs:\n  zeta:\n  alpha:\n")
    pkg({})
    expect((await collectSurface(root, { runBin: fake({}) })).action).toEqual({
      inputs: { bare: { required: false, default: null } },
      outputs: ["alpha", "zeta"],
    })
  })
  it("stringifies a non-string default", async () => {
    write("action.yml", "name: x\ninputs:\n  n:\n    default: 5\n")
    pkg({})
    expect((await collectSurface(root, { runBin: fake({}) })).action?.inputs["n"]?.default).toBe(
      "5",
    )
  })
})

describe("collectSurface: reusable workflows", () => {
  it("reads inputs, secrets and outputs of each workflow_call workflow, and skips the rest", async () => {
    pkg({})
    write(
      ".github/workflows/reuse.yml",
      [
        "on:",
        "  workflow_call:",
        "    inputs:",
        "      size: { type: string, required: true }",
        "      mode: { type: string, default: fast }",
        "      bare:",
        "    secrets:",
        "      TOKEN: { required: true }",
        "      OPTIONAL:",
        "    outputs:",
        "      z: { value: x }",
        "      a: { value: y }",
      ].join("\n"),
    )
    write(".github/workflows/empty-call.yaml", "on:\n  workflow_call:\n")
    write(".github/workflows/ci.yml", "on: [push]\n")
    write(".github/workflows/push.yml", "on: push\n")
    write(".github/workflows/broken.yml", "on: [")
    write(".github/workflows/notes.txt", "on:\n  workflow_call:\n")
    const surface = await collectSurface(root, { runBin: fake({}) })
    expect(surface.workflows).toEqual({
      "empty-call.yaml": { inputs: {}, outputs: [] },
      "reuse.yml": {
        inputs: {
          size: { required: true, default: null },
          mode: { required: false, default: "fast" },
          bare: { required: false, default: null },
          "secrets.TOKEN": { required: true, default: null },
          "secrets.OPTIONAL": { required: false, default: null },
        },
        outputs: ["a", "z"],
      },
    })
  })
  it("skips a file that only contains .yml in its name, an empty file and an empty on: key", async () => {
    pkg({})
    write(".github/workflows/reuse.yml.bak", "on:\n  workflow_call:\n")
    write(".github/workflows/blank.yml", "")
    write(".github/workflows/bare-on.yml", "on:\n")
    expect((await collectSurface(root, { runBin: fake({}) })).workflows).toEqual({})
  })
})

describe("collectSurface: generated-document headings", () => {
  it("collects heading lines from plain string literals in the listed renderers, never from substituted ones", async () => {
    write(
      "src/render.ts",
      [
        'const a = "# Catalog"',
        "const b = `## Findings\\n\\ntext\\n### Sub heading`",
        "const c = `## ${name}`",
        'const d = "#nospace"',
        'const e = "not a heading # here"',
        'lines.push("## Catalog")',
      ].join("\n"),
    )
    write("src/other.ts", 'const f = "## Lifecycle"')
    pkg({ "internal-package-contract": { surfaceRenderers: ["src/render.ts", "src/other.ts"] } })
    const surface = await collectSurface(root, { runBin: fake({}) })
    expect(surface.documents).toEqual([
      "# Catalog",
      "## Catalog",
      "## Findings",
      "## Lifecycle",
      "### Sub heading",
    ])
  })
  it("drops the trailing spaces a heading line carries", async () => {
    write("src/render.ts", 'const a = "## Spaced   \\n"')
    pkg({ "internal-package-contract": { surfaceRenderers: ["src/render.ts"] } })
    expect((await collectSurface(root, { runBin: fake({}) })).documents).toEqual(["## Spaced"])
  })
  it("omits documents when the package lists no renderers, and refuses a listed file that is missing", async () => {
    pkg({})
    expect("documents" in (await collectSurface(root, { runBin: fake({}) }))).toBe(false)
    pkg({ "internal-package-contract": { surfaceRenderers: ["src/gone.ts"] } })
    await expect(collectSurface(root, { runBin: fake({}) })).rejects.toThrow(
      /surfaceRenderers lists src\/gone\.ts, which does not exist/,
    )
  })
})
