import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { helpText } from "../scripts/contract-help.mjs"

const root = path.resolve(import.meta.dirname, "..")
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

/** package.json `description` is the pitch's source; its first sentence is the pitch every first screen shows. */
function pitch(): string {
  const description = (JSON.parse(read("package.json")) as { description: string }).description
  return /^[^.]*\./.exec(description)?.[0] ?? ""
}

describe("the one-line pitch", () => {
  it("is the first sentence of package.json's description", () => {
    expect(pitch().split(" ").length).toBeGreaterThan(5)
  })

  it("is the README's bold line under the title", () => {
    const [title, blank, line] = read("README.md").split("\n")
    expect([title, blank, line]).toEqual(["# internal-package-contract", "", `**${pitch()}**`])
  })

  it("opens the --help overview", () => {
    expect(helpText().split("\n")[2]).toBe(pitch())
  })
})
