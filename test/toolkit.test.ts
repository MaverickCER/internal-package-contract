import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

/** The paragraph every MaverickCER README carries, taken from the one document that defines it. */
function sharedParagraph(): string {
  const toolkit = read("TOOLKIT.md")
  const after = toolkit.split("## Part of the MaverickCER toolkit")[1] ?? ""
  const quoted = after.split("\n").find((line) => line.startsWith("> "))
  return quoted === undefined ? "" : quoted.slice(2)
}

describe("TOOLKIT.md", () => {
  it("defines a non-empty shared paragraph", () => {
    expect(sharedParagraph()).toContain("internal-package-contract")
  })

  it("is carried verbatim by this repository's README", () => {
    expect(read("README.md")).toContain(sharedParagraph())
  })

  it("defines every word its glossary promises", () => {
    const toolkit = read("TOOLKIT.md")
    for (const word of [
      "Evidence",
      "Contract",
      "Manifest",
      "Exception",
      "Citation",
      "Verdict",
      "Ownership",
    ])
      expect(toolkit).toContain(`**${word}**`)
  })
})
