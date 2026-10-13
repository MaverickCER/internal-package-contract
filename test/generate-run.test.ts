import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generatedRegionsCheck } from "../checks/generated-regions.js"
import { DOCUMENTS, run } from "../scripts/generate/run.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-generate-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const read = (rel: string): string => readFileSync(path.join(dir, rel), "utf8")
const manifest = {
  name: "@o/demo",
  exports: { ".": "./a.js", "./build": "./b.js", "./package.json": "./package.json" },
}
const surface = {
  entries: {
    ".": { source: "src/core/", environment: "isomorphic", tier: "Stable", purpose: "the runtime" },
    "./build": {
      source: "src/build/",
      environment: "Node-only",
      tier: "Stable",
      purpose: "tooling",
    },
  },
}
const region = (body = "") =>
  `# Agents\n\nprose before\n\n<!-- ipc:begin entry-points -->\n${body}<!-- ipc:end entry-points -->\n\nprose after\n`
const project = (doc = region()): void => {
  write("package.json", JSON.stringify(manifest))
  write("docs/surface.json", JSON.stringify(surface))
  write("AGENTS.md", doc)
}
const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

describe("generate", () => {
  it("only ever reads the documents it lists", () => {
    expect(DOCUMENTS).toEqual([
      "README.md",
      "AGENTS.md",
      "GUIDE.md",
      "ADOPTION.md",
      "VERSIONING.md",
      "CONTRIBUTING.md",
    ])
  })
  it("does nothing, and says so, when no document has a region", async () => {
    write("package.json", JSON.stringify(manifest))
    write("AGENTS.md", "# Agents\n")
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe("[generate] no generated regions here; nothing to do.\n")
    expect(await run([], mkdtempSync(path.join(tmpdir(), "ipc-generate-empty-")), h.io)).toBe(0)
  })
  it("writes the table between the markers and leaves the prose around it alone", async () => {
    project()
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe("[generate] rewrote AGENTS.md.\n")
    const text = read("AGENTS.md")
    expect(
      text.startsWith("# Agents\n\nprose before\n\n<!-- ipc:begin entry-points -->\n\n| Export"),
    ).toBe(true)
    expect(text).toContain(
      "| `@o/demo`       | `src/core/`  | isomorphic  | Stable | the runtime |",
    )
    expect(text).toContain(
      "| `@o/demo/build` | `src/build/` | Node-only   | Stable | tooling     |",
    )
    expect(text.endsWith("<!-- ipc:end entry-points -->\n\nprose after\n")).toBe(true)
  })
  it("is stable: a second run changes nothing", async () => {
    project()
    await run([], dir, io().io)
    const first = read("AGENTS.md")
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe("[generate] every generated region was already current.\n")
    expect(read("AGENTS.md")).toBe(first)
  })
  it("--check writes nothing and names what is stale", async () => {
    project()
    const before = read("AGENTS.md")
    const h = io()
    expect(await run(["--check"], dir, h.io)).toBe(1)
    expect(h.err.join("")).toBe(
      "[generate] stale: AGENTS.md. Run `npx internal-package-contract generate` and commit the result.\n",
    )
    expect(read("AGENTS.md")).toBe(before)
    await run([], dir, io().io)
    const ok = io()
    expect(await run(["--check"], dir, ok.io)).toBe(0)
    expect(ok.out.join("")).toBe("[generate] every generated region is current.\n")
  })
  it("rejects an unknown argument", async () => {
    const h = io()
    expect(await run(["--nope"], dir, h.io)).toBe(2)
    expect(h.err.join("")).toBe(
      "[generate] unknown argument: --nope\nUsage: internal-package-contract generate [--check]\n",
    )
  })
  it("names the first argument that is not --check, even after --check", async () => {
    const h = io()
    expect(await run(["--check", "--nope"], dir, h.io)).toBe(2)
    expect(h.err.join("")).toBe(
      "[generate] unknown argument: --nope\nUsage: internal-package-contract generate [--check]\n",
    )
  })
  it("acts on a document that has regions even when another one has none", async () => {
    project()
    write("README.md", "# Plain prose, no regions\n")
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe("[generate] rewrote AGENTS.md.\n")
    expect(read("README.md")).toBe("# Plain prose, no regions\n")
  })
  it("names every document it rewrote, and every one that is stale", async () => {
    project()
    write("README.md", region())
    const check = io()
    expect(await run(["--check"], dir, check.io)).toBe(1)
    expect(check.err.join("")).toBe(
      "[generate] stale: README.md, AGENTS.md. Run `npx internal-package-contract generate` and commit the result.\n",
    )
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe("[generate] rewrote README.md, AGENTS.md.\n")
  })
  it("still asks for the sources when only one of several documents has the entry-points region", async () => {
    write("package.json", JSON.stringify(manifest))
    write("README.md", "<!-- ipc:begin mystery -->\n<!-- ipc:end mystery -->\n")
    write("AGENTS.md", region())
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain("docs/surface.json not found")
    expect(h.err.join("")).toContain('region "mystery" has no generator')
  })
  it("asks for the sources when a document has the entry-points region among others", async () => {
    write("package.json", JSON.stringify(manifest))
    write(
      "AGENTS.md",
      "<!-- ipc:begin mystery -->\n<!-- ipc:end mystery -->\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n",
    )
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain("docs/surface.json not found")
  })
  it("lists every problem on its own line", async () => {
    write("README.md", "<!-- ipc:begin mystery -->\n<!-- ipc:end mystery -->\n")
    write("AGENTS.md", "<!-- ipc:begin other -->\n<!-- ipc:end other -->\n")
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toBe(
      '[generate] nothing was written:\n- README.md: region "mystery" has no generator. Available: entry-points.\n- AGENTS.md: region "other" has no generator. Available: entry-points.\n',
    )
  })
  it("writes nothing, naming file and line, when a marker is malformed", async () => {
    project("# A\n\n<!-- ipc:begin entry-points -->\nno end\n")
    const before = read("AGENTS.md")
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toBe(
      '[generate] nothing was written:\n- AGENTS.md:3: region "entry-points" has no end marker.\n',
    )
    expect(read("AGENTS.md")).toBe(before)
  })
  it("names a region it has no generator for", async () => {
    project("<!-- ipc:begin mystery -->\n<!-- ipc:end mystery -->\n")
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain(
      '- AGENTS.md: region "mystery" has no generator. Available: entry-points.',
    )
  })
  it("says what is missing or wrong with the sources", async () => {
    project()
    rmSync(path.join(dir, "docs", "surface.json"))
    let h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain(
      'docs/surface.json not found; it describes each entry point for the "entry-points" region.',
    )
    write("docs/surface.json", "{ nope")
    h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain("docs/surface.json is not valid JSON.")
    write("docs/surface.json", JSON.stringify({ entries: { ".": surface.entries["."] } }))
    h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain(
      'docs/surface.json has no entry for "./build", which package.json exports.',
    )
    write("package.json", "{ nope")
    h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toContain("package.json is missing or is not valid JSON.")
  })
  it("does not need the sources when no document asks for the entry-points region", async () => {
    write("AGENTS.md", "<!-- ipc:begin mystery -->\n<!-- ipc:end mystery -->\n")
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).not.toContain("package.json")
    expect(h.err.join("")).not.toContain("surface.json")
  })
  it("says to install first when the Prettier configuration cannot be loaded", async () => {
    project()
    write("prettier.config.mjs", 'import "does-not-exist-anywhere"\nexport default {}\n')
    const h = io()
    expect(await run([], dir, h.io)).toBe(1)
    expect(h.err.join("")).toMatch(
      /^\[generate\] could not load this package's Prettier configuration \(.*does-not-exist-anywhere.*\)\. Run `npm install` first\.\n$/,
    )
    rmSync(path.join(dir, "prettier.config.mjs"))
    write(".prettierrc.json", "{ nope")
    const broken = io()
    expect(await run([], dir, broken.io)).toBe(1)
    expect(broken.err.join("")).toContain("could not load this package's Prettier configuration")
  })
  it("formats with the package's own Prettier settings", async () => {
    project()
    write(".prettierrc.json", JSON.stringify({ proseWrap: "preserve" }))
    await run([], dir, io().io)
    expect(read("AGENTS.md")).toContain("| Export")
  })
})

describe("generatedRegionsCheck (policy)", () => {
  const judge = (value: unknown) =>
    generatedRegionsCheck().policy(makeContext(makeJsonResult(value)))
  it("runs the bundled script and asks for JSON", () => {
    const check = generatedRegionsCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-generated-regions\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes when there is nothing generated, and when everything is current", async () => {
    expect(await judge({ ok: true, state: "absent" })).toEqual({
      outcome: "pass",
      rationale:
        "GeneratedRegions: no document marks a generated region, so there is nothing to check.",
    })
    expect(await judge({ ok: true, state: "current" })).toEqual({
      outcome: "pass",
      rationale: "GeneratedRegions: every generated region matches what its sources produce.",
    })
  })
  it("fails with the generator's own message, or a generic one", async () => {
    expect(
      await judge({ ok: true, state: "problem", message: "[generate] stale: AGENTS.md." }),
    ).toEqual({
      outcome: "fail",
      rationale: "GeneratedRegions: [generate] stale: AGENTS.md.",
    })
    expect(await judge({ ok: true, state: "problem" })).toEqual({
      outcome: "fail",
      rationale: "GeneratedRegions: the generated regions could not be checked.",
    })
  })
  it("fails closed, naming the tool, on output that is not the envelope or a run that did not finish", async () => {
    const bad = await generatedRegionsCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("GeneratedRegions: output could not be parsed as JSON.\noops")
    const stopped = await generatedRegionsCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stopped.rationale).toBe(
      "check-generated-regions did not run to completion (status: timed_out).",
    )
  })
})

describe("check-generated-regions (script)", () => {
  const script = path.resolve(import.meta.dirname, "../scripts/check-generated-regions.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
  it("reports absent, problem and current", async () => {
    write("package.json", JSON.stringify(manifest))
    expect(envelope()).toEqual({ ok: true, state: "absent" })
    project()
    const problem = envelope()
    expect(problem.state).toBe("problem")
    expect(problem.message).toContain("stale: AGENTS.md")
    await run([], dir, io().io)
    expect(envelope()).toEqual({ ok: true, state: "current" })
  })
})
