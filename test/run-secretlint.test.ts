import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  MAX_ARGUMENT_BYTES,
  listRepositoryFiles,
  withFileList,
} from "../scripts/run-secretlint.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-run-secretlint-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const git = (...args: string[]): void => {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" })
}

describe("listRepositoryFiles", () => {
  it("lists tracked and untracked files and skips git-ignored ones", () => {
    git("init", "-q")
    writeFileSync(path.join(dir, ".gitignore"), "generated/\n")
    writeFileSync(path.join(dir, "tracked.txt"), "a")
    git("add", "tracked.txt", ".gitignore")
    writeFileSync(path.join(dir, "untracked.txt"), "b")
    execFileSync("mkdir", ["generated"], { cwd: dir })
    writeFileSync(path.join(dir, "generated", "big.bin"), "c")
    expect(listRepositoryFiles(dir)?.sort()).toEqual([".gitignore", "tracked.txt", "untracked.txt"])
  })

  it("returns undefined outside a git repository", () => {
    expect(listRepositoryFiles(dir)).toBeUndefined()
  })

  it("returns undefined for a repository with no files", () => {
    git("init", "-q")
    expect(listRepositoryFiles(dir)).toBeUndefined()
  })
})

describe("withFileList", () => {
  const args = ["--format", "json", "**/*"]

  it("replaces the trailing glob with the files", () => {
    expect(withFileList(args, ["a.ts", "b.ts"])).toEqual(["--format", "json", "a.ts", "b.ts"])
  })

  it("keeps the glob when git gave no list", () => {
    expect(withFileList(args, undefined)).toEqual(args)
  })

  it("keeps the glob when the list would not fit on a command line", () => {
    const huge = ["x".repeat(MAX_ARGUMENT_BYTES + 1)]
    expect(withFileList(args, huge)).toEqual(args)
  })

  it("accepts a list exactly at the limit", () => {
    const file = "y".repeat(MAX_ARGUMENT_BYTES - 1)
    expect(withFileList(args, [file])).toEqual(["--format", "json", file])
  })
})
