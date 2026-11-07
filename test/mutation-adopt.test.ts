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
    const pkg = path.resolve("pkg")
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "merged/mutation.json" }, pkg)).toBe(
      path.join(pkg, "merged", "mutation.json"),
    )
  })

  it("keeps an absolute path as it is", () => {
    const absolute = path.resolve("x", "m.json")
    expect(reportToAdopt({ IPC_MUTATION_REPORT: absolute }, path.resolve("pkg"))).toBe(absolute)
  })

  it("is undefined when the variable is unset, empty or blank", () => {
    expect(reportToAdopt({}, "/pkg")).toBeUndefined()
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "" }, "/pkg")).toBeUndefined()
    expect(reportToAdopt({ IPC_MUTATION_REPORT: "  " }, "/pkg")).toBeUndefined()
  })
})

/** Puts a source file in the package and returns the report entry a Stryker run over it would have written. */
const sourced = (file: string, text: string, status = "Killed") => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
  return { [file]: { language: "typescript", source: text, mutants: [{ id: "1", status }] } }
}
const reportOf = (...entries: Record<string, unknown>[]): string =>
  JSON.stringify({ schemaVersion: "2", files: Object.assign({}, ...entries) })

describe("adoptReport", () => {
  it("puts a mutation report where the Mutation check reads it", () => {
    const text = reportOf(sourced("src/a.ts", "const a = 1\n"))
    expect(adoptReport(root, source(text), ["src/a.ts"])).toEqual({ ok: true })
    expect(readFileSync(evidence(), "utf8")).toBe(text)
  })

  it("replaces a report that was already there", () => {
    mkdirSync(path.dirname(evidence()), { recursive: true })
    writeFileSync(evidence(), "{}")
    const text = reportOf(sourced("src/b.ts", "b"))
    expect(adoptReport(root, source(text), ["src/b.ts"])).toEqual({ ok: true })
    expect(readFileSync(evidence(), "utf8")).toBe(text)
  })

  it("removes the evidence a previous run left, whatever it then refuses, so a failure is never judged as a success", () => {
    const refusals: [string, string[]][] = [
      [path.join(root, "nope.json"), ["src/a.ts"]],
      [source("{ not json"), ["src/a.ts"]],
      [source('{"files":{}}'), ["src/a.ts"]],
      [source(reportOf(sourced("src/other.ts", "x"))), ["src/a.ts"]],
    ]
    for (const [report, files] of refusals) {
      mkdirSync(path.dirname(evidence()), { recursive: true })
      writeFileSync(evidence(), "stale")
      expect(adoptReport(root, report, files)).toMatchObject({ ok: false })
      expect(() => readFileSync(evidence())).toThrow()
    }
  })

  it("refuses a file that is not there", () => {
    const result = adoptReport(root, path.join(root, "nope.json"), ["src/a.ts"])
    expect(result).toMatchObject({ ok: false })
    expect((result as { error: string }).error).toContain("nope.json")
  })

  it("refuses a file that is not JSON", () => {
    const file = source("{ not json")
    const result = adoptReport(root, file, ["src/a.ts"])
    expect((result as { error: string }).error).toContain(file)
    expect((result as { error: string }).error).toMatch(
      /^.+ cannot be read as a mutation report \(.+\)\.$/,
    )
  })

  it("refuses JSON that is not a mutation report, saying what is missing", () => {
    for (const content of ["[]", "null", "3", '{"files":[]}', '{"files":null}', "{}"]) {
      const file = source(content)
      expect(adoptReport(root, file, ["src/a.ts"])).toEqual({
        ok: false,
        error: `${file} is not a mutation report: it has no \`files\` object.`,
      })
    }
  })

  it("refuses a report with no file in it, since that judges nothing", () => {
    const file = source('{"files":{}}')
    expect(adoptReport(root, file, ["src/a.ts"])).toEqual({
      ok: false,
      error: `${file} is not a mutation report: it has no file in it.`,
    })
  })

  it("refuses a file entry without mutants and a mutant without a Stryker status", () => {
    const noMutants = source(
      JSON.stringify({ files: { "src/a.ts": { mutants: null, source: "a" } } }),
    )
    expect(adoptReport(root, noMutants, ["src/a.ts"])).toMatchObject({
      ok: false,
      error: expect.stringContaining("src/a.ts has no `mutants` array"),
    })
    const noStatus = source(
      JSON.stringify({ files: { "src/a.ts": { mutants: [{}], source: "a" } } }),
    )
    expect(adoptReport(root, noStatus, ["src/a.ts"])).toMatchObject({
      ok: false,
      error: expect.stringContaining("status is undefined"),
    })
  })

  it("accepts every status Stryker reports, Ignored included", () => {
    const statuses = [
      "Killed",
      "Survived",
      "NoCoverage",
      "Timeout",
      "CompileError",
      "RuntimeError",
      "Ignored",
      "Pending",
    ]
    const entries = statuses.map((status, index) =>
      sourced(`src/f${String(index)}.ts`, "x", status),
    )
    const files = statuses.map((_, index) => `src/f${String(index)}.ts`)
    expect(adoptReport(root, source(reportOf(...entries)), files)).toEqual({ ok: true })
  })

  it("refuses a report that lacks a file this run mutates, which would otherwise go unjudged", () => {
    const file = source(reportOf(sourced("src/a.ts", "a")))
    writeFileSync(path.join(root, "src", "b.ts"), "b")
    expect(adoptReport(root, file, ["src/a.ts", "src/b.ts"])).toEqual({
      ok: false,
      error: `${file} was not made from this checkout's plan: it lacks src/b.ts.`,
    })
  })

  it("refuses a report with a file this run does not mutate", () => {
    const file = source(reportOf(sourced("src/a.ts", "a"), sourced("src/old.ts", "o")))
    expect(adoptReport(root, file, ["src/a.ts"])).toEqual({
      ok: false,
      error: `${file} was not made from this checkout's plan: it has src/old.ts, which this run does not mutate.`,
    })
  })

  it("lists every file it lacks and every file it has too many of, sorted, however they were given", () => {
    const file = source(reportOf(sourced("src/z.ts", "z"), sourced("src/y.ts", "y")))
    const result = adoptReport(root, file, ["src/d.ts", "src/c.ts"]) as { error: string }
    expect(result.error).toContain(
      "it lacks src/c.ts, src/d.ts; it has src/y.ts, src/z.ts, which this run does not mutate",
    )
  })

  it("lists every file whose text differs, sorted", () => {
    const file = source(reportOf(sourced("src/b.ts", "b"), sourced("src/a.ts", "a")))
    writeFileSync(path.join(root, "src", "a.ts"), "A")
    writeFileSync(path.join(root, "src", "b.ts"), "B")
    const result = adoptReport(root, file, ["src/b.ts", "src/a.ts"]) as { error: string }
    expect(result.error).toContain(": src/a.ts, src/b.ts differ from the text that was mutated.")
  })

  it("says both when it lacks a file and has another", () => {
    const file = source(reportOf(sourced("src/old.ts", "o")))
    const result = adoptReport(root, file, ["src/a.ts"]) as { error: string }
    expect(result.error).toContain(
      "it lacks src/a.ts; it has src/old.ts, which this run does not mutate",
    )
  })

  it("refuses a report whose source text is not what is on disk, because it was made from another revision", () => {
    const file = source(reportOf(sourced("src/a.ts", "const a = 1")))
    writeFileSync(path.join(root, "src", "a.ts"), "const a = 2")
    expect(adoptReport(root, file, ["src/a.ts"])).toEqual({
      ok: false,
      error: `${file} was not made from this checkout: src/a.ts differ from the text that was mutated.`,
    })
  })

  it("refuses a report whose file has no source text", () => {
    sourced("src/a.ts", "a")
    const file = source(JSON.stringify({ files: { "src/a.ts": { mutants: [] } } }))
    expect(adoptReport(root, file, ["src/a.ts"])).toMatchObject({ ok: false })
  })

  it("refuses a report of a file that is no longer on disk", () => {
    const file = source(reportOf(sourced("src/a.ts", "a")))
    rmSync(path.join(root, "src", "a.ts"))
    expect(adoptReport(root, file, ["src/a.ts"])).toMatchObject({ ok: false })
  })

  it("does not mind a checkout's line endings", () => {
    const file = source(reportOf(sourced("src/a.ts", "one\ntwo\n")))
    writeFileSync(path.join(root, "src", "a.ts"), "one\r\ntwo\r\n")
    expect(adoptReport(root, file, ["src/a.ts"])).toEqual({ ok: true })
  })
})

describe("run-mutation.mjs with IPC_MUTATION_REPORT", () => {
  const script = path.join(import.meta.dirname, "..", "scripts", "run-mutation.mjs")
  const runIn = (report: string, extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, IPC_MUTATION_REPORT: report, IPC_MUTATION_SHARD: "", ...extra },
    })

  it("judges the report without running Stryker", () => {
    const text = reportOf(sourced("src/a.ts", "const a = 1\n"))
    const file = source(text)
    const result = runIn(file)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain(`judging the report in ${file}`)
    expect(readFileSync(evidence(), "utf8")).toBe(text)
  })

  it("prefers the report to a shard selector it also inherits, which a single file could not be cut into", () => {
    const file = source(reportOf(sourced("src/a.ts", "a")))
    const result = runIn(file, { IPC_MUTATION_SHARD: "1/2" })
    expect(result.stderr).not.toContain("IPC_MUTATION_SHARD")
    expect(result.status).toBe(0)
  })

  it("fails, saying why, and leaves no evidence, when the report cannot be adopted", () => {
    mkdirSync(path.dirname(evidence()), { recursive: true })
    writeFileSync(evidence(), "stale")
    const result = runIn(path.join(root, "missing.json"))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("missing.json")
    expect(() => readFileSync(evidence())).toThrow()
  })

  it("fails on a report of other files than this checkout mutates", () => {
    sourced("src/a.ts", "a")
    const file = source(reportOf(sourced("src/old.ts", "o")))
    rmSync(path.join(root, "src", "old.ts"))
    const result = runIn(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("was not made from this checkout's plan")
  })

  it("fails, and leaves no evidence, when the change affects no source to judge a report against", () => {
    const file = source(reportOf(sourced("src/a.ts", "a")))
    mkdirSync(path.join(root, "reports", "contract"), { recursive: true })
    writeFileSync(
      path.join(root, "reports", "contract", "scope.json"),
      JSON.stringify({
        schemaVersion: 1,
        scope: "affected",
        reason: "test",
        changedFiles: [],
        tests: [],
        sources: [],
        mutate: [],
      }),
    )
    mkdirSync(path.dirname(evidence()), { recursive: true })
    writeFileSync(evidence(), "stale")
    const result = runIn(file)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("no source file is affected")
    expect(() => readFileSync(evidence())).toThrow()
  })
})
