import { describe, expect, it } from "vitest"
import { standardsRegion } from "../scripts/generate/standards.mjs"

/**
 * The "standards" region lists the standard-format documents a package generates (SARIF, OSCAL, CycloneDX, ...)
 * from one source, `docs/surface.json`. Each row names the test that checks the format, and generation fails
 * when that test does not exist, so "validated against the official schema" is something a reader can rerun.
 */
const entry = {
  document: "Findings",
  standard: "OASIS SARIF 2.1.0",
  producedBy: "`buildSarifLog` (`@o/p/build`)",
  checkedAgainst: "The official OASIS schema",
  test: "test/build/sarif.test.ts",
  limits: "Not wired to the CLI.",
}
const exists = (file: string): boolean => file === "test/build/sarif.test.ts"

describe("standardsRegion", () => {
  it("renders one row per document, citing the test that checks it", () => {
    expect(standardsRegion({ standards: [entry] }, exists)).toEqual({
      problems: [],
      markdown: [
        "| Document | Standard | Produced by | Checked against | Test | Limits |",
        "| --- | --- | --- | --- | --- | --- |",
        "| Findings | OASIS SARIF 2.1.0 | `buildSarifLog` (`@o/p/build`) | The official OASIS schema | `test/build/sarif.test.ts` | Not wired to the CLI. |",
      ].join("\n"),
    })
  })

  it("says so when the package generates no standard-format document", () => {
    expect(standardsRegion({ standards: [] }, exists)).toEqual({
      problems: [],
      markdown: "This package generates no standard-format documents.",
    })
  })

  it("fails when the cited test does not exist, so the claim cannot outlive its test", () => {
    expect(
      standardsRegion({ standards: [{ ...entry, test: "test/gone.test.ts" }] }, exists).problems,
    ).toEqual([
      'docs/surface.json standards entry "Findings" cites test "test/gone.test.ts", which does not exist.',
    ])
  })

  it("asks for every field a row needs", () => {
    const partial: Record<string, string> = Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "document" && key !== "limits"),
    )
    expect(
      standardsRegion({ standards: [{ ...partial, document: "X", limits: " " }] }, exists).problems,
    ).toEqual(['docs/surface.json standards entry "X" needs limits.'])
    expect(standardsRegion({ standards: [partial] }, exists).problems).toEqual([
      "docs/surface.json standards entry 1 needs document, limits.",
    ])
  })

  it("requires a standards list", () => {
    for (const surface of [{}, { standards: {} }, { standards: "SARIF" }]) {
      expect(standardsRegion(surface, exists).problems).toEqual([
        'docs/surface.json needs a "standards" list for the "standards" region: one entry per standard-format document the package generates.',
      ])
    }
  })

  it("rejects an entry that is not an object", () => {
    expect(standardsRegion({ standards: ["SARIF"] }, exists).problems).toEqual([
      "docs/surface.json standards entry 1 must be an object.",
    ])
  })

  it("escapes pipes so a cell never splits the table", () => {
    const { markdown } = standardsRegion({ standards: [{ ...entry, limits: "a | b" }] }, exists)
    expect(markdown).toContain("| a \\| b |")
  })

  it("treats a surface that is null or not an object as having no standards list", () => {
    for (const surface of [null, "standards", 5]) {
      expect(standardsRegion(surface, exists).problems).toEqual([
        'docs/surface.json needs a "standards" list for the "standards" region: one entry per standard-format document the package generates.',
      ])
    }
  })

  it("rejects a null or array entry as not an object", () => {
    expect(standardsRegion({ standards: [null, []] }, exists).problems).toEqual([
      "docs/surface.json standards entry 1 must be an object.",
      "docs/surface.json standards entry 2 must be an object.",
    ])
  })

  it("names an entry by its position when its document is only whitespace", () => {
    expect(standardsRegion({ standards: [{ ...entry, document: "  " }] }, exists).problems).toEqual(
      ["docs/surface.json standards entry 1 needs document."],
    )
  })
})
