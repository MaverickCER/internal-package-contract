import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MEMO_DIRECTORY, inputsHash, recall, remember } from "../scripts/mutation/memo.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-mutation-memo-"))
  spawnSync("git", ["init", "-q"], { cwd: dir })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), text)
}
const read = (file: string): string => readFileSync(path.join(dir, file)).toString()
const evidence = `${MEMO_DIRECTORY}/mutation.json`

describe("inputsHash", () => {
  it("is the same for the same files, and a different checkout of them", () => {
    put("src/a.ts", "a")
    put("package.json", "{}")
    const other = mkdtempSync(path.join(tmpdir(), "ipc-mutation-memo-other-"))
    try {
      mkdirSync(path.join(other, "src"))
      writeFileSync(path.join(other, "src/a.ts"), "a")
      writeFileSync(path.join(other, "package.json"), "{}")
      spawnSync("git", ["init", "-q"], { cwd: other })
      expect(inputsHash(dir)).toBe(inputsHash(dir))
      expect(inputsHash(other)).toBe(inputsHash(dir))
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it("changes when a file's content, a file's name, a new file or the Node version does", () => {
    put("src/a.ts", "a")
    const base = inputsHash(dir)
    put("src/a.ts", "b")
    const edited = inputsHash(dir)
    expect(edited).not.toBe(base)
    rmSync(path.join(dir, "src/a.ts"))
    put("src/renamed.ts", "b")
    const renamed = inputsHash(dir)
    expect(renamed).not.toBe(edited)
    put("src/extra.ts", "c")
    const added = inputsHash(dir)
    expect(added).not.toBe(renamed)
    expect(inputsHash(dir, "v1.0.0")).not.toBe(inputsHash(dir, "v2.0.0"))
    expect(inputsHash(dir, "v1.0.0")).toBe(inputsHash(dir, "v1.0.0"))
  })

  it("cannot be fooled by moving text between a file's name and its content", () => {
    put("ab", "c")
    const first = inputsHash(dir)
    rmSync(path.join(dir, "ab"))
    put("a", "bc")
    expect(inputsHash(dir)).not.toBe(first)
  })

  it("does not see what the tools themselves write", () => {
    put("src/a.ts", "a")
    const base = inputsHash(dir)
    put("reports/mutation/mutation.json", "{}")
    put("coverage/x.json", "{}")
    put(".stryker-tmp/sandbox/x.ts", "x")
    put("node_modules/p/index.js", "x")
    expect(inputsHash(dir)).toBe(base)
    put("reportsnot/x.ts", "this one is an input")
    expect(inputsHash(dir)).not.toBe(base)
  })

  it("leaves out a file that git still lists but that has been deleted", () => {
    put("src/a.ts", "a")
    put("src/gone.ts", "g")
    spawnSync("git", ["add", "-A"], { cwd: dir })
    const withIt = inputsHash(dir)
    rmSync(path.join(dir, "src/gone.ts"))
    expect(() => inputsHash(dir)).not.toThrow()
    expect(inputsHash(dir)).not.toBe(withIt)
  })
})

describe("remember and recall", () => {
  // A report of a run in which every mutant was caught; `label` tells one run's evidence from another's.
  const clean = (label: string): string =>
    JSON.stringify({
      label,
      files: { "a.ts": { mutants: [{ status: "Killed" }, { status: "Ignored" }] } },
    })
  const ran = (label = "the run"): void => put(evidence, clean(label))

  it("hands back, unchanged, the evidence of a run for exactly the same inputs", () => {
    ran("first")
    remember(dir, "h1", 0)
    ran("overwritten by something else")
    expect(recall(dir, "h1", {})).toBe(true)
    expect(read(evidence)).toBe(clean("first"))
  })

  it("hands back nothing for other inputs, and nothing when nothing was kept", () => {
    expect(recall(dir, "h1", {})).toBe(false)
    ran()
    remember(dir, "h1", 0)
    expect(recall(dir, "h2", {})).toBe(false)
    expect(recall(dir, "h1", {})).toBe(true)
  })

  it("keeps only what a run that finished cleanly produced", () => {
    ran()
    remember(dir, "h1", 1)
    remember(dir, "h1", null)
    expect(existsSync(path.join(dir, MEMO_DIRECTORY, "memo.json"))).toBe(false)
    rmSync(path.join(dir, evidence))
    remember(dir, "h1", 0)
    expect(existsSync(path.join(dir, MEMO_DIRECTORY, "memo.json"))).toBe(false)
    expect(recall(dir, "h1", {})).toBe(false)
  })

  it("keeps nothing from a run in which any mutant survived, had no test, timed out or is unknown", () => {
    const report = (...statuses: string[]) =>
      put(
        evidence,
        JSON.stringify({ files: { "a.ts": { mutants: statuses.map((status) => ({ status })) } } }),
      )
    for (const bad of ["Survived", "NoCoverage", "Timeout", "Pending", "Strange"]) {
      report("Killed", bad)
      remember(dir, "h1", 0)
      expect(existsSync(path.join(dir, MEMO_DIRECTORY, "memo.json"))).toBe(false)
    }
    report("Killed", "Ignored", "RuntimeError", "CompileError")
    remember(dir, "h1", 0)
    expect(recall(dir, "h1", {})).toBe(true)
  })

  it("keeps nothing from evidence that is empty, has no mutants, or is not a report", () => {
    for (const text of [
      "not json",
      "{}",
      '{"files":{}}',
      '{"files":{"a.ts":{}}}',
      '{"files":{"a.ts":{"mutants":[]}}}',
      "null",
    ]) {
      put(evidence, text)
      remember(dir, "h1", 0)
      expect(existsSync(path.join(dir, MEMO_DIRECTORY, "memo.json"))).toBe(false)
    }
  })

  it("forgets the evidence for older inputs when it keeps newer", () => {
    ran("one")
    remember(dir, "h1", 0)
    ran("two")
    remember(dir, "h2", 0)
    expect(
      readdirSync(path.join(dir, MEMO_DIRECTORY)).filter((name) => name.startsWith("memo-")),
    ).toEqual(["memo-h2.json"])
    expect(recall(dir, "h1", {})).toBe(false)
    expect(recall(dir, "h2", {})).toBe(true)
    expect(read(evidence)).toBe(clean("two"))
  })

  it("never reuses a run under CI, whatever it recorded, and can be switched off", () => {
    ran()
    remember(dir, "h1", 0)
    expect(recall(dir, "h1", { CI: "true" })).toBe(false)
    expect(recall(dir, "h1", { CI: "1" })).toBe(false)
    expect(recall(dir, "h1", { IPC_MUTATION_MEMO: "0" })).toBe(false)
    expect(recall(dir, "h1", { CI: "", IPC_MUTATION_MEMO: "1" })).toBe(true)
    expect(recall(dir, "h1", { CI: "false" })).toBe(true)
    expect(recall(dir, "h1", { CI: undefined })).toBe(true)
  })

  it("does not trust evidence that merely sits there for other inputs than the record names", () => {
    ran("for h1")
    remember(dir, "h1", 0)
    writeFileSync(path.join(dir, MEMO_DIRECTORY, "memo-h2.json"), "left behind")
    expect(recall(dir, "h2", {})).toBe(false)
    expect(read(evidence)).toBe(clean("for h1"))
  })

  it("treats a record it cannot read, or whose evidence is gone, as nothing kept", () => {
    ran()
    remember(dir, "h1", 0)
    rmSync(path.join(dir, MEMO_DIRECTORY, "memo-h1.json"))
    expect(recall(dir, "h1", {})).toBe(false)
    ran()
    remember(dir, "h1", 0)
    writeFileSync(path.join(dir, MEMO_DIRECTORY, "memo.json"), "not json")
    expect(recall(dir, "h1", {})).toBe(false)
  })
})
