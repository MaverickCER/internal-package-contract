import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The consumer template says things in prose that `package.json` files say in code. These keep the two
 * in step, so an engine bump or a TypeScript bump cannot leave ADOPTION.md or the dependabot comment
 * describing the previous floor.
 */
const root = path.resolve(import.meta.dirname, "..")
const read = (file: string) => readFileSync(path.join(root, file), "utf8")
const manifest = (file: string) =>
  JSON.parse(read(file)) as {
    engines?: { node?: string }
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

/** The comment lines directly above the `typescript` ignore rule of a dependabot file. */
function typescriptPinComment(file: string): string[] {
  const lines = read(file).split("\n")
  const rule = lines.findIndex((line) => line.trim() === '- dependency-name: "typescript"')
  expect(rule, `${file} has no typescript ignore rule`).toBeGreaterThan(0)
  const comment: string[] = []
  for (let i = rule - 1; i >= 0 && lines[i]?.trim().startsWith("#"); i -= 1) {
    comment.unshift(lines[i]?.trim() ?? "")
  }
  return comment
}

describe("the consumer template agrees with itself", () => {
  it("ADOPTION.md names the Node.js floor that the template package.json declares", () => {
    const engine = manifest("template/package/package.json").engines?.node ?? ""
    const major = /^>=(\d+)\./.exec(engine)?.[1]
    expect(major, `engines.node "${engine}" is not ">=N.x.y"`).toBeDefined()
    expect(read("template/package/ADOPTION.md")).toContain(`- Node.js ${String(major)} or later`)
  })

  it("starts a new package on the TypeScript range this repository develops against", () => {
    const template = manifest("template/package/package.json").devDependencies?.["typescript"]
    // Here TypeScript is a runtime dependency: the checks run its compiler API on consumers' sources.
    const own = manifest("package.json").dependencies?.["typescript"]
    expect(template).toBeDefined()
    expect(template).toBe(own)
  })

  it("explains the TypeScript 7 pin in the same words in the template and in this repository's dependabot file", () => {
    const template = typescriptPinComment("template/dependabot.yml")
    expect(template.length).toBeGreaterThan(0)
    expect(template.join(" ")).toContain("TypeScript 7 has no compiler API")
    expect(typescriptPinComment(".github/dependabot.yml")).toEqual(template)
  })
})
