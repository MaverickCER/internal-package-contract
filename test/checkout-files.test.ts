import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { filesOf } from "../scripts/checkout-files.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-checkout-files-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const put = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}

describe("filesOf", () => {
  it("lists what git would not ignore, including a file not yet added, when the checkout is a repository", () => {
    put("a.txt", "a")
    put("sub/b.txt", "b")
    put("ignored.log", "x")
    put(".gitignore", "*.log\n")
    spawnSync("git", ["init", "-q"], { cwd: root })
    spawnSync("git", ["add", "a.txt", ".gitignore"], { cwd: root })
    expect(filesOf(root).sort()).toEqual([".gitignore", "a.txt", "sub/b.txt"])
  })

  it("lists everything but node_modules and .git when it is not a repository", () => {
    put("a.txt", "a")
    put("sub/deep/b.txt", "b")
    put("node_modules/x/c.txt", "c")
    put(".git/config", "d")
    const dir = mkdtempSync(path.join(tmpdir(), "ipc-not-a-repo-"))
    try {
      writeFileSync(path.join(dir, "a.txt"), "a")
      mkdirSync(path.join(dir, "sub", "deep"), { recursive: true })
      writeFileSync(path.join(dir, "sub", "deep", "b.txt"), "b")
      mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true })
      writeFileSync(path.join(dir, "node_modules", "x", "c.txt"), "c")
      mkdirSync(path.join(dir, ".git"))
      writeFileSync(path.join(dir, ".git", "config"), "d")
      expect(filesOf(dir).sort()).toEqual(["a.txt", path.join("sub", "deep", "b.txt")])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
