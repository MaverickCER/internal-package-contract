import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseArguments, run } from "../scripts/mutation/merge.mjs"

let root: string
let out: string[]
let err: string[]
const io = () => ({ out: (text: string) => out.push(text), err: (text: string) => err.push(text) })

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-merge-"))
  out = []
  err = []
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const shardReport = (file: string, status = "Killed") => ({
  schemaVersion: "2",
  files: { [file]: { language: "typescript", source: "x", mutants: [{ id: "1", status }] } },
})
const write = (name: string, value: unknown): string => {
  const file = path.join(root, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value))
  return file
}

describe("parseArguments", () => {
  it("reads the total, the output and the shard reports", () => {
    expect(parseArguments(["--total", "2", "--out", "m.json", "1=a.json", "2=b.json"])).toEqual({
      ok: true,
      total: 2,
      out: "m.json",
      entries: [
        { shard: 1, path: "a.json" },
        { shard: 2, path: "b.json" },
      ],
    })
  })

  it("reads a total and a shard number of more than one digit", () => {
    expect(parseArguments(["--total", "12", "--out", "m.json", "11=a.json"])).toMatchObject({
      ok: true,
      total: 12,
      entries: [{ shard: 11, path: "a.json" }],
    })
  })

  it("needs the whole of the total to be digits", () => {
    for (const total of ["1x", "x1", "1 2", "1\n"]) {
      expect(parseArguments(["--total", total, "--out", "m.json", "1=a.json"])).toEqual({
        ok: false,
        error: "--total must be a whole number of at least 1.",
      })
    }
  })

  it("needs the whole of a report to be one line", () => {
    expect(parseArguments(["--total", "1", "--out", "m.json", "1=a\nb"])).toMatchObject({
      ok: false,
    })
  })

  it("needs a total that is a whole number of at least one", () => {
    for (const total of ["0", "-1", "1.5", "two"]) {
      const parsed = parseArguments(["--total", total, "--out", "m.json", "1=a.json"])
      expect(parsed).toMatchObject({ ok: false })
      expect(JSON.stringify(parsed)).toContain("--total")
    }
    expect(parseArguments(["--out", "m.json", "1=a.json"])).toMatchObject({ ok: false })
  })

  it("needs an output", () => {
    const parsed = parseArguments(["--total", "1", "1=a.json"])
    expect(parsed).toMatchObject({ ok: false })
    expect(JSON.stringify(parsed)).toContain("--out")
  })

  it("needs each report written as <shard>=<path>", () => {
    for (const bad of ["a.json", "=a.json", "1=", "x=a.json", "1.5=a.json"]) {
      const parsed = parseArguments(["--total", "1", "--out", "m.json", bad])
      expect(parsed).toMatchObject({ ok: false })
      expect(JSON.stringify(parsed)).toContain(bad)
    }
  })

  it("keeps a path that itself contains an equals sign", () => {
    expect(parseArguments(["--total", "1", "--out", "m.json", "1=dir/a=b.json"])).toMatchObject({
      ok: true,
      entries: [{ shard: 1, path: "dir/a=b.json" }],
    })
  })

  it("refuses an option it does not know", () => {
    expect(parseArguments(["--total", "1", "--out", "m.json", "--bogus", "1=a.json"])).toEqual({
      ok: false,
      error: "Unknown option --bogus.",
    })
  })

  it("refuses an option that has no value", () => {
    expect(parseArguments(["--total"])).toEqual({ ok: false, error: "--total needs a value." })
    expect(parseArguments(["--total", "1", "--out"])).toEqual({
      ok: false,
      error: "--out needs a value.",
    })
  })
})

describe("run", () => {
  it("writes the report an unsharded run would have produced", () => {
    const a = write("1/mutation.json", shardReport("src/a.ts"))
    const b = write("2/mutation.json", shardReport("src/b.ts", "Survived"))
    const target = path.join(root, "reports", "mutation", "mutation.json")
    expect(run(["--total", "2", "--out", target, `1=${a}`, `2=${b}`], root, io())).toBe(0)
    const merged = JSON.parse(readFileSync(target, "utf8")) as { files: Record<string, unknown> }
    expect(Object.keys(merged.files).sort()).toEqual(["src/a.ts", "src/b.ts"])
    expect(out.join("")).toContain("2 shard")
    expect(err).toEqual([])
  })

  it("resolves relative paths against the directory it is run from", () => {
    write("s1.json", shardReport("src/a.ts"))
    expect(run(["--total", "1", "--out", "merged.json", "1=s1.json"], root, io())).toBe(0)
    expect(JSON.parse(readFileSync(path.join(root, "merged.json"), "utf8"))).toHaveProperty([
      "files",
      "src/a.ts",
    ])
  })

  it("never writes a partial report: a missing shard fails and leaves nothing behind", () => {
    const a = write("1.json", shardReport("src/a.ts"))
    const target = path.join(root, "merged.json")
    expect(run(["--total", "2", "--out", target, `1=${a}`], root, io())).toBe(1)
    expect(err.join("")).toContain("missing shard 2")
    expect(() => readFileSync(target)).toThrow()
  })

  it("fails on a report that cannot be read", () => {
    const target = path.join(root, "merged.json")
    expect(
      run(["--total", "1", "--out", target, `1=${path.join(root, "nope.json")}`], root, io()),
    ).toBe(1)
    expect(err.join("")).toContain("nope.json")
  })

  it("fails on a report that is not JSON", () => {
    const bad = write("bad.json", "{ not json")
    expect(run(["--total", "1", "--out", path.join(root, "m.json"), `1=${bad}`], root, io())).toBe(
      1,
    )
    expect(err.join("")).toContain("bad.json")
  })

  it("fails on a file two shards both mutated", () => {
    const a = write("1.json", shardReport("src/a.ts"))
    const b = write("2.json", shardReport("src/a.ts"))
    expect(
      run(["--total", "2", "--out", path.join(root, "m.json"), `1=${a}`, `2=${b}`], root, io()),
    ).toBe(1)
    expect(err.join("")).toContain("src/a.ts")
  })

  it("explains a bad command line and exits with 2", () => {
    expect(run(["--total", "x"], root, io())).toBe(2)
    expect(err.join("")).toContain("--total")
  })

  it("is what the script runs", () => {
    const a = write("1.json", shardReport("src/a.ts"))
    const target = path.join(root, "m.json")
    const script = path.join(import.meta.dirname, "..", "scripts", "run-merge-mutation-reports.mjs")
    const result = spawnSync(
      process.execPath,
      [script, "--total", "1", "--out", target, `1=${a}`],
      {
        cwd: root,
        encoding: "utf8",
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("1 shard")
    expect(JSON.parse(readFileSync(target, "utf8"))).toHaveProperty(["files", "src/a.ts"])
  })
})
