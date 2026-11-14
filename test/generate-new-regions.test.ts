import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { actionInputsRegion, firstSentence } from "../scripts/generate/action-inputs.mjs"
import { run } from "../scripts/generate/run.mjs"
import { supportedVersionsRegion } from "../scripts/generate/supported-versions.mjs"

describe("firstSentence", () => {
  it("keeps the first sentence on one line, and the whole text when it has no sentence end", () => {
    expect(firstSentence("Directory to run from.\nIgnored otherwise.")).toBe(
      "Directory to run from.",
    )
    expect(firstSentence("  Token for  the\n calls ")).toBe("Token for the calls")
    expect(firstSentence("Use v1.2 or later! Then more.")).toBe("Use v1.2 or later!")
    expect(firstSentence("Is it set? Yes.")).toBe("Is it set?")
  })
})

describe("actionInputsRegion", () => {
  it("lists every input in file order with required, default and the first sentence", () => {
    const yml = [
      "inputs:",
      "  args:",
      "    description: 'Arguments. More detail.'",
      "    required: true",
      "  dir:",
      "    description: Directory.",
      "    default: '.'",
      "  token:",
      "    default: ''",
      "  bare:",
    ].join("\n")
    expect(actionInputsRegion(yml)).toEqual({
      problems: [],
      markdown: [
        "| Input | Required | Default | What it does |",
        "| --- | --- | --- | --- |",
        "| `args` | yes | none | Arguments. |",
        "| `dir` | no | `.` | Directory. |",
        "| `token` | no | none |  |",
        "| `bare` | no | none |  |",
      ].join("\n"),
    })
  })
  it("stops on a missing file, invalid YAML, or no inputs", () => {
    expect(actionInputsRegion(undefined).problems).toEqual([
      'action.yml not found; the "action-inputs" region lists its inputs.',
    ])
    expect(actionInputsRegion("a: [").problems).toEqual(["action.yml is not valid YAML."])
    for (const text of ["name: x", "inputs: {}", "inputs:", ""]) {
      expect(actionInputsRegion(text).problems).toEqual([
        'action.yml declares no inputs for the "action-inputs" region.',
      ])
    }
  })
})

describe("supportedVersionsRegion", () => {
  it("lists Node.js, then each peer by name, marking the optional ones", () => {
    expect(
      supportedVersionsRegion({
        engines: { node: ">=22" },
        peerDependencies: { zeta: "^1", typescript: ">=5.0.0" },
        peerDependenciesMeta: { typescript: { optional: true }, zeta: { optional: false } },
      }),
    ).toEqual({
      problems: [],
      markdown: [
        "| Requirement | Range | Needed |",
        "| --- | --- | --- |",
        "| Node.js | `>=22` | always |",
        "| `typescript` | `>=5.0.0` | optional |",
        "| `zeta` | `^1` | always |",
        "",
      ]
        .join("\n")
        .trimEnd(),
    })
  })
  it("lists peers alone when there is no Node.js range, and stops when there is nothing", () => {
    expect(supportedVersionsRegion({ peerDependencies: { a: "1" } }).markdown).toContain(
      "| `a` | `1` | always |",
    )
    expect(supportedVersionsRegion({ engines: { node: 22 } }).problems).toEqual([
      'package.json has no "engines.node" and no "peerDependencies" for the "supported-versions" region.',
    ])
    expect(supportedVersionsRegion(undefined).problems).toHaveLength(1)
  })
})

describe("generate with the package-only regions", () => {
  let root: string
  const out: string[] = []
  const err: string[] = []
  const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "gen-new-"))
    out.length = 0
    err.length = 0
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const write = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const doc =
    "# Guide\n\n<!-- ipc:begin action-inputs -->\n<!-- ipc:end action-inputs -->\n\n<!-- ipc:begin supported-versions -->\n<!-- ipc:end supported-versions -->\n"

  it("writes both regions without docs/surface.json, then reports them current", async () => {
    write("package.json", JSON.stringify({ name: "p", engines: { node: ">=22" } }))
    write("action.yml", "inputs:\n  a:\n    description: The a.\n")
    write("GUIDE.md", doc)
    expect(await run([], root, io, { formatOptions: async () => ({}) })).toBe(0)
    const text = readFileSync(path.join(root, "GUIDE.md"), "utf8")
    expect(text).toContain("| `a`   | no       | none    | The a.       |")
    expect(text).toContain("| Node.js     | `>=22` | always |")
    expect(await run(["--check"], root, io, { formatOptions: async () => ({}) })).toBe(0)
    expect(err).toEqual([])
  })
  it("reads action.yaml when there is no action.yml, and fails without either", async () => {
    write("package.json", JSON.stringify({ name: "p", engines: { node: ">=22" } }))
    write("GUIDE.md", doc)
    expect(await run(["--check"], root, io, { formatOptions: async () => ({}) })).toBe(1)
    expect(err.join("")).toContain(
      'action.yml not found; the "action-inputs" region lists its inputs.',
    )
    err.length = 0
    write("action.yaml", "inputs:\n  b:\n    required: true\n")
    expect(await run([], root, io, { formatOptions: async () => ({}) })).toBe(0)
    expect(readFileSync(path.join(root, "GUIDE.md"), "utf8")).toContain("| `b`   | yes")
  })
  it("still asks for docs/surface.json for a region that needs it, naming only that region", async () => {
    write("package.json", JSON.stringify({ name: "p", engines: { node: ">=22" } }))
    write("GUIDE.md", `${doc}\n<!-- ipc:begin standards -->\n<!-- ipc:end standards -->\n`)
    write("action.yml", "inputs:\n  a: {}\n")
    expect(await run(["--check"], root, io, { formatOptions: async () => ({}) })).toBe(1)
    expect(err.join("")).toContain(
      'docs/surface.json not found; it holds what only a person can say for the "standards" region.',
    )
  })
})
