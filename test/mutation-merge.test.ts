// The merge step the reusable contract.yml and data-cap's ci.yml run: `repo-contract merge-mutation`,
// reached through this package's `repo-contract` dependency. IPC kept a second merge script until
// repo-contract shipped this command; the last test pins that the copy is gone.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const packageRoot = path.resolve(import.meta.dirname, "..")
const bin = path.join(
  path.dirname(createRequire(import.meta.url).resolve("repo-contract/package.json")),
  "bin",
  "repo-contract.mjs",
)

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-merge-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const shardReport = (file: string) => ({
  schemaVersion: "2",
  files: {
    [file]: { language: "typescript", source: "x", mutants: [{ id: "1", status: "Killed" }] },
  },
})
const write = (name: string, value: unknown): void => {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
  writeFileSync(path.join(root, name), JSON.stringify(value))
}
const merge = (...args: string[]) =>
  spawnSync(process.execPath, [bin, "merge-mutation", ...args], { cwd: root, encoding: "utf8" })

describe("repo-contract merge-mutation, as the shard workflows call it", () => {
  it("puts the shard reports back into one report at the path the Mutation check judges", () => {
    write("reports/shards/mutation-shard-1/mutation.json", shardReport("src/a.ts"))
    write("reports/shards/mutation-shard-2/mutation.json", shardReport("src/b.ts"))
    const result = merge(
      "--total",
      "2",
      "--out",
      "reports/mutation/mutation.json",
      "1=reports/shards/mutation-shard-1/mutation.json",
      "2=reports/shards/mutation-shard-2/mutation.json",
    )
    expect(result.stderr).toContain("merged 2 shards")
    expect(result.status).toBe(0)
    const merged = JSON.parse(
      readFileSync(path.join(root, "reports/mutation/mutation.json"), "utf8"),
    )
    expect(Object.keys(merged.files)).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("writes nothing and exits 1 when a shard never reported", () => {
    write("1.json", shardReport("src/a.ts"))
    const result = merge("--total", "2", "--out", "merged.json", "1=1.json")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("missing shard 2")
    expect(existsSync(path.join(root, "merged.json"))).toBe(false)
  })

  it("writes nothing and exits 1 when two shards mutated the same file", () => {
    write("1.json", shardReport("src/a.ts"))
    write("2.json", shardReport("src/a.ts"))
    const result = merge("--total", "2", "--out", "merged.json", "1=1.json", "2=2.json")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("src/a.ts appears in shards 1 and 2")
    expect(existsSync(path.join(root, "merged.json"))).toBe(false)
  })

  it("exits 2 on a bad command line", () => {
    expect(merge("--total", "x").status).toBe(2)
  })

  it("is the only merge: IPC no longer ships its own copy", () => {
    for (const gone of [
      "scripts/run-merge-mutation-reports.mjs",
      "scripts/mutation/merge.mjs",
      "scripts/mutation/merge.d.mts",
      "scripts/mutation/report-shape.mjs",
      "scripts/mutation/report-shape.d.mts",
    ]) {
      expect(existsSync(path.join(packageRoot, gone)), gone).toBe(false)
    }
  })
})
