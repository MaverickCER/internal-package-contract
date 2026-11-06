import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { adoptReport, reportToAdopt } from "../scripts/mutation/adopt.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-adopt-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const source = (content: string): string => {
  const file = path.join(root, "merged.json")
  writeFileSync(file, content)
  return file
}
const evidence = (): string => path.join(root, "reports", "mutation", "mutation.json")

describe("reportToAdopt", () => {
  it("is the file the variable names, resolved against the package", () => {
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "merged/mutation.json" }, "/pkg")).toBe(
      path.join("/pkg", "merged/mutation.json"),
    )
  })

  it("keeps an absolute path as it is", () => {
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "/x/m.json" }, "/pkg")).toBe("/x/m.json")
  })

  it("is undefined when the variable is unset, empty or blank", () => {
    expect(reportToAdopt({}, "/pkg")).toBeUndefined()
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "" }, "/pkg")).toBeUndefined()
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "  " }, "/pkg")).toBeUndefined()
  })
})

describe("adoptReport", () => {
  it("puts a mutation report where the Mutation check reads it", () => {
    const text = JSON.stringify({ schemaVersion: "2", files: { "src/a.ts": { mutants: [] } } })
    expect(adoptReport(root, source(text))).toEqual({ ok: true })
    expect(readFileSync(evidence(), "utf8")).toBe(text)
  })

  it("replaces a report that was already there", () => {
    mkdirSync(path.dirname(evidence()), { recursive: true })
    writeFileSync(evidence(), "{}")
    const text = JSON.stringify({ files: { "src/b.ts": { mutants: [] } } })
    adoptReport(root, source(text))
    expect(readFileSync(evidence(), "utf8")).toBe(text)
  })

  it("refuses a file that is not there, and leaves no evidence", () => {
    const result = adoptReport(root, path.join(root, "nope.json"))
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain("nope.json")
    expect(() => readFileSync(evidence())).toThrow()
  })

  it("refuses a file that is not JSON", () => {
    const file = source("{ not json")
    const result = adoptReport(root, file)
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).toContain(file)
    expect((result as { error: string }).error).toMatch(
      /^.+ cannot be read as a mutation report \(.+\)\.$/,
    )
    expect(() => readFileSync(evidence())).toThrow()
  })

  it("refuses JSON that is not a mutation report", () => {
    for (const content of ["[]", "null", "3", '{"files":[]}', '{"files":null}', "{}"]) {
      expect(adoptReport(root, source(content))).toMatchObject({ ok: false })
    }
    expect(() => readFileSync(evidence())).toThrow()
  })

  it("refuses a report with no file in it, since that judges nothing", () => {
    const file = source('{"files":{}}')
    expect(adoptReport(root, file)).toEqual({
      ok: false,
      error: `${file} is not a mutation report with any file in it.`,
    })
  })
})

describe("run-mutation.mjs with IPC_MUTATION_REPORT", () => {
  const script = path.join(import.meta.dirname, "..", "scripts", "run-mutation.mjs")
  const runIn = (report: string) =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, IPC_MUTATION_REPORT: report, IPC_MUTATION_SHARD: "" },
    })

  it("judges the report without running Stryker", () => {
    const file = source('{"files":{"src/a.ts":{"mutants":[]}}}')
    const result = runIn(file)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain(`judging the report in ${file}`)
    expect(readFileSync(evidence(), "utf8")).toBe('{"files":{"src/a.ts":{"mutants":[]}}}')
  })

  it("fails, saying why, when the report cannot be adopted", () => {
    const result = runIn(path.join(root, "missing.json"))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("missing.json")
  })
})
