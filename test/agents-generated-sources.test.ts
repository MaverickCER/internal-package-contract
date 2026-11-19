import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

// The file behind each source a region generator destructures in scripts/generate/run.mjs. A new
// source fails the test below until it is mapped here and named in the managed AGENTS.md.
const SOURCE_FILES: Record<string, string> = {
  action: "action.yml",
  pkg: "package.json",
  surface: "docs/surface.json",
}

const generatorSources = (): string[] => {
  const runner = read("scripts/generate/run.mjs")
  const start = runner.indexOf("const GENERATORS = {")
  const block = runner.slice(start, runner.indexOf("\n}\n", start))
  const names = [...block.matchAll(/\(\{([^}]*)\}/g)].flatMap(([, list]) =>
    list!.split(",").map((name) => name.trim()),
  )
  return [...new Set(names)].sort()
}

describe("the managed AGENTS.md: where a generated region comes from", () => {
  it("knows the file behind every source a region generator reads", () => {
    expect(generatorSources()).toEqual(Object.keys(SOURCE_FILES).sort())
  })

  it("names each of those files in its generated-region rule", () => {
    const agents = read("template/package/AGENTS.md")
    const rule = agents.slice(agents.indexOf("<!-- ipc:begin -->"), agents.indexOf("generate`)"))
    for (const name of generatorSources())
      expect(rule, name).toContain(`\`${SOURCE_FILES[name]!}\``)
  })
})
