import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { COPIES, withRequired } from "../scripts/managed-files/inspect.mjs"

/**
 * The official schemas a package's tests validate its standard-format output against (SARIF, OSCAL, CycloneDX)
 * are kept once, here, and carried into each package that enrols them. They are only worth anything byte for
 * byte as published, so each file's SHA-256 is pinned in the README next to the release URL it came from: an
 * edit, a reformat, or a silent swap to a different version fails this test.
 */
const root = path.resolve(import.meta.dirname, "..")
const readme = readFileSync(path.join(root, "template/standards/README.md"), "utf8")
const ROW = /^\| `([^`]+)` +\| ([^|]+?) +\| (https:\/\/\S+) +\| `([0-9a-f]{64})` +\|$/gm
const rows = [...readme.matchAll(ROW)].map(([, file, standard, url, sha256]) => ({
  file,
  standard: standard?.trim(),
  url,
  sha256,
}))
const schemaCopies = COPIES.filter((copy) => copy.from.startsWith("template/standards/"))

describe("vendored standard schemas", () => {
  it("lists every schema it carries, each with a pinned release URL and a SHA-256", () => {
    const files = schemaCopies
      .map((copy) => path.basename(copy.from))
      .filter((f) => f !== "README.md")
    expect(rows.map((row) => row.file).sort()).toEqual([...files].sort())
    for (const row of rows) {
      // A release or tag, never a moving branch, so the bytes can be fetched again and compared.
      expect(row.url, row.file).not.toMatch(/\/(master|main)\//)
    }
  })

  it("carries each schema byte for byte as the README records it", () => {
    for (const row of rows) {
      const bytes = readFileSync(path.join(root, "template/standards", row.file ?? ""))
      expect(createHash("sha256").update(bytes).digest("hex"), row.file).toBe(row.sha256)
    }
  })

  it("is carried as a plain file, with the README, and CycloneDX brings the two schemas it references", () => {
    for (const copy of schemaCopies) {
      expect(copy.kind, copy.name).toBe("file")
      expect(copy.to).toBe(`test/fixtures/standards/${path.basename(copy.from)}`)
      if (copy.name !== "standards-readme")
        expect(withRequired(copy.name)).toContain("standards-readme")
    }
    expect(withRequired("schema-cyclonedx-1.6").sort()).toEqual([
      "schema-cyclonedx-1.6",
      "schema-cyclonedx-jsf-0.82",
      "schema-cyclonedx-spdx",
      "standards-readme",
    ])
  })
})
