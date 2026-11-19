import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const readme = readFileSync(path.join(root, "README.md"), "utf8")
const exportKeys = Object.keys(
  (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { exports: object })
    .exports,
)

const between = (from: string, to: string): string => {
  const start = readme.indexOf(from)
  expect(start, from).toBeGreaterThan(-1)
  return readme.slice(start, readme.indexOf(to, start))
}

// The export subpaths a passage names, such as `./config/*`.
const exportsNamed = (passage: string): string[] =>
  [...passage.matchAll(/`(\.\/[^`]*)`/g)].map(([, name]) => name!)

// A `*` in the README stands for any run of characters, a literal `*` in an export key included.
const covers = (pattern: string, key: string): boolean =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`).test(key)

const diffed = exportsNamed(between("What a gate holds to that", "\n\n"))
const reviewOnly = exportsNamed(between("so review decides:", "\n\nEverything else"))

describe("README Stability: how each package.json export is levelled", () => {
  it("names every export in exactly one list, the diffed one or the review-only one", () => {
    for (const key of exportKeys) {
      const lists = [diffed, reviewOnly].filter((list) =>
        list.some((pattern) => covers(pattern, key)),
      )
      expect(lists.length, key).toBe(1)
    }
  })

  it("names no export that package.json does not declare", () => {
    for (const pattern of [...diffed, ...reviewOnly]) {
      expect(
        exportKeys.some((key) => covers(pattern, key)),
        pattern,
      ).toBe(true)
    }
  })
})
