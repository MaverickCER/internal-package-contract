import { describe, expect, it } from "vitest"
import { reportShapeError } from "../scripts/mutation/report-shape.mjs"

const entry = (status: unknown) => ({ files: { "src/a.ts": { mutants: [{ status }] } } })

describe("reportShapeError", () => {
  it("is undefined for a report of files whose mutants all have a status Stryker reports", () => {
    for (const status of [
      "Killed",
      "Survived",
      "NoCoverage",
      "Timeout",
      "CompileError",
      "RuntimeError",
      "Ignored",
      "Pending",
    ]) {
      expect(reportShapeError(entry(status))).toBeUndefined()
    }
  })

  it("accepts a file with no mutant in it", () => {
    expect(reportShapeError({ files: { "src/a.ts": { mutants: [] } } })).toBeUndefined()
  })

  it("needs a files object", () => {
    for (const report of [
      undefined,
      null,
      3,
      "x",
      [],
      {},
      { files: null },
      { files: [] },
      { files: 1 },
    ]) {
      expect(reportShapeError(report)).toBe("it has no `files` object.")
    }
  })

  it("needs a file in it", () => {
    expect(reportShapeError({ files: {} })).toBe("it has no file in it.")
  })

  it("needs every file entry to have a mutants array", () => {
    for (const value of [
      null,
      undefined,
      {},
      { mutants: null },
      { mutants: {} },
      { mutants: "x" },
    ]) {
      expect(reportShapeError({ files: { "src/a.ts": value } })).toBe(
        "src/a.ts has no `mutants` array.",
      )
    }
  })

  it("needs every mutant to have a status Stryker reports, and names the file and the status", () => {
    for (const status of [undefined, null, "", "killed", "Unknown", 1]) {
      expect(reportShapeError(entry(status))).toBe(
        `src/a.ts has a mutant whose status is ${JSON.stringify(status)}, which Stryker does not report.`,
      )
    }
    expect(reportShapeError({ files: { "src/a.ts": { mutants: [null] } } })).toContain("src/a.ts")
  })

  it("looks at every file and every mutant, not only the first", () => {
    expect(
      reportShapeError({
        files: {
          "src/a.ts": { mutants: [{ status: "Killed" }] },
          "src/b.ts": { mutants: [{ status: "Killed" }, { status: "Bogus" }] },
        },
      }),
    ).toContain("src/b.ts")
  })
})
