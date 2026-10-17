import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { promptBlocksCheck } from "../checks/prompt-blocks.js"
import { nextNumber, renderAdr, run, slugOf } from "../scripts/new/adr.mjs"
import {
  ADR_DIRECTORIES,
  adrDirectory,
  findPrompts,
  findSurfaceTodos,
  scanPackage,
} from "../scripts/prompts/scan.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-prompts-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

describe("findPrompts", () => {
  it("finds a single-line prompt with its line number and text", () => {
    expect(findPrompts("# T\n\n<!-- ipc:prompt: Say who it is for. -->\n\ntext\n")).toEqual([
      { line: 3, text: "Say who it is for." },
    ])
  })
  it("finds each of several, tolerating surrounding whitespace", () => {
    expect(findPrompts("  <!-- ipc:prompt: a -->  \n<!-- ipc:prompt: b -->")).toEqual([
      { line: 1, text: "a" },
      { line: 2, text: "b" },
    ])
  })
  it("ignores a plain comment, an empty prompt, and a prompt that shares its line with text", () => {
    expect(
      findPrompts(
        "<!-- note -->\n<!-- ipc:prompt:  -->\nx <!-- ipc:prompt: a -->\n<!-- ipc:prompt: a --> x",
      ),
    ).toEqual([])
  })
})

describe("findSurfaceTodos", () => {
  it("finds a value that still starts with TODO:, wherever it sits in the file", () => {
    const text =
      '{\n  "entries": {\n    ".": {\n      "tier": "Stable",\n      "purpose": "TODO: say what it is."\n    }\n  }\n}\n'
    expect(findSurfaceTodos(text)).toEqual([{ line: 5, text: "say what it is." }])
  })
  it("ignores an answered value and a mention of TODO inside prose", () => {
    expect(
      findSurfaceTodos('  "purpose": "The runtime. TODO: later."\n  "purpose": "done"\n'),
    ).toEqual([])
  })
  it("tolerates a trailing comma", () => {
    expect(findSurfaceTodos('"purpose": "TODO: x",')).toEqual([{ line: 1, text: "x" }])
  })
})

describe("adrDirectory / scanPackage", () => {
  it("also reports a surface entry still waiting for its purpose", () => {
    write("README.md", "<!-- ipc:prompt: r -->\n")
    write("docs/surface.json", '{\n  "purpose": "TODO: p"\n}\n')
    expect(scanPackage(dir)).toEqual([
      { file: "README.md", line: 1, text: "r" },
      { file: "docs/surface.json", line: 2, text: "p" },
    ])
  })
  it("looks for the decision folder in a fixed order", () => {
    expect(ADR_DIRECTORIES).toEqual(["specs/decisions", "docs/decisions", "docs/adr"])
    expect(adrDirectory(dir)).toBeUndefined()
    mkdirSync(path.join(dir, "docs", "adr"), { recursive: true })
    expect(adrDirectory(dir)).toBe("docs/adr")
    mkdirSync(path.join(dir, "specs", "decisions"), { recursive: true })
    expect(adrDirectory(dir)).toBe("specs/decisions")
  })
  it("reads the listed documents and the decision records, in order, and nothing else", () => {
    write("README.md", "<!-- ipc:prompt: r -->\n")
    write("OTHER.md", "<!-- ipc:prompt: not read -->\n")
    write("specs/decisions/0002-b.md", "<!-- ipc:prompt: b -->\n")
    write("specs/decisions/0001-a.md", "\n<!-- ipc:prompt: a -->\n")
    write("specs/decisions/notes.txt", "<!-- ipc:prompt: not markdown -->\n")
    expect(scanPackage(dir)).toEqual([
      { file: "README.md", line: 1, text: "r" },
      { file: "specs/decisions/0001-a.md", line: 2, text: "a" },
      { file: "specs/decisions/0002-b.md", line: 1, text: "b" },
    ])
  })
  it("finds nothing in a package with no documents and no decision folder", () => {
    expect(scanPackage(dir)).toEqual([])
  })
})

describe("slugOf / nextNumber / renderAdr", () => {
  it("makes a file-name-safe slug", () => {
    expect(slugOf("  Use --Foo & Bar! (v2)  ")).toBe("use-foo-bar-v2")
    expect(slugOf("***")).toBe("")
    expect(slugOf("-edge-")).toBe("edge")
    expect(slugOf("a   b")).toBe("a-b")
  })
  it("numbers the next record after the highest, ignoring files that are not records", () => {
    expect(nextNumber([])).toBe(1)
    expect(nextNumber(["x0009-a.md", "0009.md"])).toBe(1)
    expect(nextNumber(["0001-a.md", "0009-b.md", "notes.md", "12-short.md"])).toBe(10)
  })
  it("renders the sections every record has, each with its prompt", () => {
    const text = renderAdr(7, "Use a thing")
    expect(text.startsWith("# 0007: Use a thing\n\n## Status\n\nProposed.\n")).toBe(true)
    for (const heading of [
      "Status",
      "Context",
      "Decision",
      "Consequences",
      "Alternatives considered",
    ]) {
      expect(text).toContain(`## ${heading}\n`)
    }
    expect(findPrompts(text)).toHaveLength(5)
  })
})

describe("new adr", () => {
  it("writes the next record in the decision folder and says how to finish it", () => {
    write("specs/decisions/0003-old.md", "x")
    const h = io()
    expect(run(["adr", "Use", "a", "thing"], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe(
      "[new] wrote specs/decisions/0004-use-a-thing.md. Answer the prompts in it; `PromptBlocks` fails a release until you do.\n",
    )
    expect(readFileSync(path.join(dir, "specs/decisions/0004-use-a-thing.md"), "utf8")).toBe(
      renderAdr(4, "Use a thing"),
    )
  })
  it("starts at 0001 in an empty decision folder", () => {
    mkdirSync(path.join(dir, "docs", "adr"), { recursive: true })
    expect(run(["adr", "First"], dir, io().io)).toBe(0)
    expect(readdirSync(path.join(dir, "docs", "adr"))).toEqual(["0001-first.md"])
  })
  it("asks for a record type and a title, naming what is available", () => {
    for (const [argv, message] of [
      [[], "unknown record type: (none given). Available: adr."],
      [["rfc", "x"], "unknown record type: rfc. Available: adr."],
      [["adr"], "a title is needed."],
      [["adr", "  "], "a title is needed."],
    ] as const) {
      const h = io()
      expect(run([...argv], dir, h.io)).toBe(2)
      expect(h.err.join("")).toBe(
        `[new] ${message}\nUsage: internal-package-contract new adr "<title>"\n`,
      )
    }
  })
  it("refuses a title with nothing to name a file after", () => {
    mkdirSync(path.join(dir, "specs", "decisions"), { recursive: true })
    const h = io()
    expect(run(["adr", "***"], dir, h.io)).toBe(2)
    expect(h.err.join("")).toBe(
      '[new] the title has no letters or digits to name the file after.\nUsage: internal-package-contract new adr "<title>"\n',
    )
  })
  it("refuses a package with no decision folder", () => {
    const h = io()
    expect(run(["adr", "x"], dir, h.io)).toBe(1)
    expect(h.err.join("")).toBe(
      "[new] this package has no decision folder (specs/decisions, docs/decisions or docs/adr). Create one first.\n",
    )
  })
})

describe("promptBlocksCheck (policy)", () => {
  const judge = (value: unknown) => promptBlocksCheck().policy(makeContext(makeJsonResult(value)))
  const open = [{ file: "README.md", line: 3, text: "Say who it is for." }]
  it("runs the bundled script and asks for JSON", () => {
    const check = promptBlocksCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-prompt-blocks\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes when nothing is left to answer", async () => {
    expect(await judge({ ok: true, state: "clean", open: [] })).toEqual({
      outcome: "pass",
      rationale: "PromptBlocks: no document still asks its author a question.",
    })
  })
  it("warns, listing each prompt, while the package is in development", async () => {
    expect(await judge({ ok: true, state: "open", release: false, open })).toEqual({
      outcome: "warn",
      rationale:
        "PromptBlocks: 1 unanswered prompt(s). Answer each by replacing its whole comment with the answer:\n- README.md:3: Say who it is for.",
    })
  })
  it("fails, saying why, when a release is being verified", async () => {
    expect(await judge({ ok: true, state: "open", release: true, open })).toEqual({
      outcome: "fail",
      rationale:
        "PromptBlocks: 1 unanswered prompt(s), and a release is being verified. Answer each by replacing its whole comment with the answer:\n- README.md:3: Say who it is for.",
    })
  })
  it("puts each prompt on its own line", async () => {
    const two = [...open, { file: "docs/GUIDE.md", line: 9, text: "Name the limits." }]
    expect((await judge({ ok: true, state: "open", release: false, open: two })).rationale).toBe(
      "PromptBlocks: 2 unanswered prompt(s). Answer each by replacing its whole comment with the answer:\n- README.md:3: Say who it is for.\n- docs/GUIDE.md:9: Name the limits.",
    )
  })
  it("fails closed, naming the tool, on output that is not the envelope or a run that did not finish", async () => {
    const bad = await promptBlocksCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("PromptBlocks: output could not be parsed as JSON.\noops")
    const stopped = await promptBlocksCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stopped.rationale).toBe(
      "check-prompt-blocks did not run to completion (status: timed_out).",
    )
  })
})

describe("check-prompt-blocks (script)", () => {
  const script = path.resolve(import.meta.dirname, "../scripts/check-prompt-blocks.mjs")
  const envelope = (env: Record<string, string> = {}) =>
    JSON.parse(
      spawnSync(process.execPath, [script], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, IPC_RELEASE: "", ...env },
      }).stdout,
    )
  it("reports clean, then open with the release flag only when IPC_RELEASE is 1", () => {
    expect(envelope()).toEqual({ ok: true, state: "clean", release: false, open: [] })
    write("README.md", "<!-- ipc:prompt: q -->\n")
    const open = [{ file: "README.md", line: 1, text: "q" }]
    expect(envelope()).toEqual({ ok: true, state: "open", release: false, open })
    expect(envelope({ IPC_RELEASE: "1" })).toEqual({ ok: true, state: "open", release: true, open })
    expect(envelope({ IPC_RELEASE: "true" }).release).toBe(false)
  })
})
