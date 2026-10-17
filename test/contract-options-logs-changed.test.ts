import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ALWAYS,
  DOCUMENTATION,
  WORKFLOWS,
  changedFiles,
  gitIn,
  selectChanged,
} from "../scripts/changed.mjs"
import { DEFAULT_LOGS, LOG_MODES, parseRunOptions } from "../scripts/contract-options.mjs"
import {
  REPO_CONTRACT_LOG_DIRECTORY as LOG_DIRECTORY,
  repoContractLogs,
} from "repo-contract/helpers"
import { processTrouble, runContract } from "../scripts/contract-run.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-run-options-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("parseRunOptions", () => {
  it("defaults to no JSON, no change filter, and logs for what did not pass", () => {
    expect(LOG_MODES).toEqual(["all", "failing", "off"])
    expect(DEFAULT_LOGS).toBe("failing")
    expect(parseRunOptions([], {}, dir)).toEqual({ json: false, changed: false, logs: "failing" })
  })
  it("reads --json and --changed as switches", () => {
    expect(parseRunOptions(["--json", "--changed"], {}, dir)).toMatchObject({
      json: true,
      changed: true,
    })
  })
  it("reads the log mode from the flag in either form, then the environment, then the package", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { logs: "all" } }),
    )
    expect(parseRunOptions([], {}, dir).logs).toBe("all")
    expect(parseRunOptions([], { IPC_LOGS: "off" }, dir).logs).toBe("off")
    expect(parseRunOptions(["--logs", "failing"], { IPC_LOGS: "off" }, dir).logs).toBe("failing")
    expect(parseRunOptions(["--logs=all"], { IPC_LOGS: "off" }, dir).logs).toBe("all")
    expect(parseRunOptions([], { IPC_LOGS: "" }, dir).logs).toBe("all")
  })
  it("ignores a package.json that is missing, unreadable or says nothing", () => {
    expect(parseRunOptions([], {}, dir).logs).toBe("failing")
    writeFileSync(path.join(dir, "package.json"), "{ nope")
    expect(parseRunOptions([], {}, dir).logs).toBe("failing")
    writeFileSync(path.join(dir, "package.json"), "{}")
    expect(parseRunOptions([], {}, dir).logs).toBe("failing")
  })
  it("rejects a log mode that is not one of the three, saying where it came from", () => {
    expect(() => parseRunOptions(["--logs", "some"], {}, dir)).toThrow(
      'The log mode must be one of all, failing, off, not "some" (set by --logs).',
    )
    expect(() => parseRunOptions(["--logs"], {}, dir)).toThrow('not "" (set by --logs)')
    expect(() => parseRunOptions([], { IPC_LOGS: "x" }, dir)).toThrow("(set by IPC_LOGS)")
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { logs: true } }),
    )
    expect(() => parseRunOptions([], {}, dir)).toThrow("(set by package.json)")
  })
})

const evidence = (over: Record<string, unknown> = {}) => ({
  command: "eslint",
  args: [".", "--format", "a b"],
  status: "completed",
  exitCode: 1,
  signal: null,
  startedAt: "2026-10-12T00:00:00.000Z",
  durationMs: 1234,
  stdout: "out text\n",
  stderr: "",
  ...over,
})

describe("selectChanged", () => {
  const available = [...ALWAYS, ...DOCUMENTATION, ...WORKFLOWS, "Lint", "Tests", "Mutation"]
  it("runs the checks about the repository itself when nothing has changed", () => {
    const { ids, reason } = selectChanged([], available)
    expect(reason).toBe("nothing has changed")
    expect([...(ids ?? [])].sort()).toEqual([...ALWAYS].sort())
  })
  it("runs every check when any file is not plainly documentation or a workflow, naming it", () => {
    for (const file of ["src/a.ts", "package.json", ".repo-contract/adoption.json", "README.md"]) {
      if (file === "README.md") continue
      const picked = selectChanged([file, "README.md"], available)
      expect(picked.ids).toBeUndefined()
      expect(picked.reason).toBe(`${file} changed, which can affect any check`)
    }
  })
  it("runs the documentation checks, and only them, when only documentation changed", () => {
    for (const files of [
      ["README.md"],
      ["docs/index.html"],
      [".changeset/a.md"],
      ["LICENSE"],
      ["CODEOWNERS"],
      ["notes.txt"],
    ]) {
      const { ids, reason } = selectChanged(files, available)
      expect(reason).toBe("only documentation changed")
      expect(ids).toEqual(expect.arrayContaining([...ALWAYS, ...DOCUMENTATION]))
      expect(ids).not.toContain("Lint")
      expect(ids).not.toContain("GithubActions")
    }
  })
  it("runs the workflow checks, and only them, when only a workflow changed", () => {
    const { ids, reason } = selectChanged([".github/workflows/ci.yml"], available)
    expect(reason).toBe("only workflows changed")
    expect(ids).toEqual(expect.arrayContaining([...ALWAYS, ...WORKFLOWS]))
    expect(ids).not.toContain("DocsLinks")
    expect(ids).not.toContain("Tests")
  })
  it("runs both sets when both changed, and leaves out checks the contract does not declare", () => {
    const picked = selectChanged(
      ["README.md", ".github/dependabot.yml"],
      ["Format", "Lint", "GitHygiene"],
    )
    expect(picked.reason).toBe("only documentation and workflows changed")
    expect(picked.ids).toEqual(["Format", "GitHygiene"])
  })
})

describe("selectChanged -- what counts as documentation", () => {
  const available = [...ALWAYS, ...DOCUMENTATION, ...WORKFLOWS, "Lint"]
  const isDoc = (file: string) => selectChanged([file], available).ids !== undefined
  it("takes markdown and text files, the docs folder, changesets, a LICENSE and CODEOWNERS", () => {
    for (const file of [
      "a.md",
      "a/b/NOTES.TXT",
      "docs/x.html",
      ".changeset/config.json",
      "LICENSE",
      "LICENSE.md",
      "LICENSE.txt",
      "LICENSE.APACHE",
      "CODEOWNERS",
    ]) {
      expect(isDoc(file), file).toBe(true)
    }
  })
  it("leaves out what only looks like documentation", () => {
    for (const file of [
      "a.md.bak",
      "notes.txt.js",
      "src/docs/x.html",
      "a.changeset/x.json",
      "src/.changeset/x.json",
      "LICENSEX",
      "sub/LICENSE",
      "NOTLICENSE",
      "CODEOWNERS.bak",
    ]) {
      expect(isDoc(file), file).toBe(false)
    }
  })
  it("adds the documentation checks for documentation and the workflow checks for a workflow, each only when it changed", () => {
    const both = selectChanged(["README.md", ".github/a.yml"], available).ids ?? []
    for (const id of [...DOCUMENTATION, ...WORKFLOWS]) expect(both).toContain(id)
    const docs = selectChanged(["README.md", "a.md"], available).ids ?? []
    expect(docs).toContain("DocsLinks")
    expect(docs).not.toContain("ScorecardWorkflow")
    const flows = selectChanged([".github/a.yml", ".github/b.yml"], available).ids ?? []
    expect(flows).toContain("ScorecardWorkflow")
    expect(flows).not.toContain("DocsLinks")
    expect(selectChanged(["README.md", ".github/a.yml"], available).reason).toBe(
      "only documentation and workflows changed",
    )
  })
})

describe("gitIn -- the real git", () => {
  it("returns what git printed, and undefined when it failed", () => {
    const sh = (...args: string[]) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: dir,
        encoding: "utf8",
      })
    sh("init", "-q")
    writeFileSync(path.join(dir, "a.txt"), "x")
    sh("add", "a.txt")
    sh("commit", "-q", "-m", "first")
    writeFileSync(path.join(dir, "a.txt"), "y")
    writeFileSync(path.join(dir, "new.txt"), "z")
    const git = gitIn(dir)
    expect(git(["rev-parse", "--is-inside-work-tree"])).toBe("true\n")
    expect(git(["rev-parse", "--verify", "--quiet", "no-such-ref"])).toBeUndefined()
    expect(changedFiles(dir)).toEqual(["a.txt", "new.txt"])
  })
})

describe("changedFiles", () => {
  const git = (table: Record<string, string | undefined>) => (args: string[]) =>
    table[args.join(" ")]
  it("is undefined outside a git working tree, or when git cannot say", () => {
    expect(changedFiles(dir, git({}))).toBeUndefined()
    expect(changedFiles(dir, git({ "rev-parse --is-inside-work-tree": "false\n" }))).toBeUndefined()
  })
  it("joins what differs from the upstream branch, what is uncommitted, and what is new, without repeats", () => {
    const files = changedFiles(
      dir,
      git({
        "rev-parse --is-inside-work-tree": "true\n",
        "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": "origin/feature\n",
        "rev-parse --verify --quiet origin/feature": "abc\n",
        "diff --name-only origin/feature...HEAD": "a.ts\nb.md\n",
        "diff --name-only HEAD": "b.md\nc.ts\n",
        "ls-files --others --exclude-standard": "d.ts\n\n",
      }),
    )
    expect(files).toEqual(["a.ts", "b.md", "c.ts", "d.ts"])
  })
  it("ignores a blank upstream or a base git cannot confirm, and never asks for a diff against no base", () => {
    const asked: string[] = []
    const run = (table: Record<string, string | undefined>) => (args: string[]) => {
      asked.push(args.join(" "))
      return table[args.join(" ")]
    }
    const files = changedFiles(
      dir,
      run({
        "rev-parse --is-inside-work-tree": "true\n",
        "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": "\n",
        "rev-parse --verify --quiet ": "x",
        "rev-parse --verify --quiet origin/main": "x",
        "diff --name-only origin/main...HEAD": "m.ts\n",
      }),
    )
    expect(files).toEqual(["m.ts"])
    expect(asked).not.toContain("rev-parse --verify --quiet ")
    asked.length = 0
    expect(
      changedFiles(
        dir,
        run({
          "rev-parse --is-inside-work-tree": "true\n",
          "diff --name-only HEAD": "u.ts\n",
        }),
      ),
    ).toEqual(["u.ts"])
    expect(asked.some((call) => call.includes("...HEAD"))).toBe(false)
    expect(asked).not.toContain("rev-parse --verify --quiet undefined")
  })
  it("does not take a missing upstream for a base, and survives a failing diff against the base", () => {
    const files = changedFiles(
      dir,
      (args) =>
        (
          ({
            "rev-parse --is-inside-work-tree": "true\n",
            "rev-parse --verify --quiet ": "x",
            "rev-parse --verify --quiet origin/main": "x",
            "diff --name-only origin/main...HEAD": "m.ts\n",
          }) as Record<string, string | undefined>
        )[args.join(" ")],
    )
    expect(files).toEqual(["m.ts"])
    expect(
      changedFiles(
        dir,
        (args) =>
          (
            ({
              "rev-parse --is-inside-work-tree": "true\n",
              "rev-parse --verify --quiet origin/main": "x",
            }) as Record<string, string | undefined>
          )[args.join(" ")],
      ),
    ).toEqual([])
  })
  it("treats a git that fails after the first question as having nothing to add, and trims each name", () => {
    expect(
      changedFiles(
        dir,
        git({
          "rev-parse --is-inside-work-tree": "true\n",
          "diff --name-only HEAD": "a.ts\r\n  b.ts  \n",
        }),
      ),
    ).toEqual(["a.ts", "b.ts"])
    expect(changedFiles(dir, git({ "rev-parse --is-inside-work-tree": "true\n" }))).toEqual([])
  })
  it("falls back to origin/main, then origin/master, when there is no upstream", () => {
    const base = {
      "rev-parse --is-inside-work-tree": "true\n",
      "diff --name-only HEAD": "",
      "ls-files --others --exclude-standard": "",
    }
    expect(
      changedFiles(
        dir,
        git({
          ...base,
          "rev-parse --verify --quiet origin/main": "x",
          "diff --name-only origin/main...HEAD": "m.ts\n",
        }),
      ),
    ).toEqual(["m.ts"])
    expect(
      changedFiles(
        dir,
        git({
          ...base,
          "rev-parse --verify --quiet origin/master": "x",
          "diff --name-only origin/master...HEAD": "n.ts\n",
        }),
      ),
    ).toEqual(["n.ts"])
    expect(changedFiles(dir, git(base))).toEqual([])
  })
  it("runs real git when no seam is given", () => {
    expect(changedFiles(dir)).toBeUndefined()
  })
})

// The folder the logs are kept in, written with / as the command says it on every platform.
const logsShown = LOG_DIRECTORY.split(path.sep).join("/")

describe("runContract: progress, logs, --changed and --json", () => {
  const evidenceFor = (ids: string[]) => ({
    version: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    checks: Object.fromEntries(
      ids.map((id) => [id, evidence({ durationMs: 1500, stdout: `${id} output` })]),
    ),
  })
  type Hooks = {
    onEvidence?: (id: string, e: unknown) => void
    onVerdict?: (id: string, r: { outcome: string; rationale: string }) => void
  }
  const engine =
    (
      outcomes: Record<string, "pass" | "fail">,
      calls: unknown[] = [],
      useHooks = true,
      probe?: () => Promise<void>,
    ) =>
    async (_config: unknown, options?: Hooks & { checks?: string[] }) => {
      calls.push(options)
      const ids = options?.checks ?? Object.keys(outcomes)
      const ev = evidenceFor(ids)
      const checks = Object.fromEntries(
        ids.map((id) => [id, { outcome: outcomes[id], rationale: `${id} said so` }]),
      )
      if (useHooks) {
        for (const id of ids) options?.onEvidence?.(id, ev.checks[id])
        for (const id of ids) {
          options?.onVerdict?.(id, { outcome: outcomes[id] ?? "pass", rationale: `${id} said so` })
        }
        await probe?.()
      }
      return Promise.resolve({
        evidence: ev,
        verdict: { passed: !ids.some((id) => outcomes[id] === "fail"), checks },
      })
    }
  const go = async (
    outcomes: Record<string, "pass" | "fail">,
    over: Record<string, unknown> = {},
    useHooks = true,
    probe?: () => Promise<void>,
  ) => {
    let text = ""
    let notes = ""
    const calls: unknown[] = []
    const result = await runContract({
      runRepoContract: engine(outcomes, calls, useHooks, probe) as never,
      config: { checks: Object.fromEntries(Object.keys(outcomes).map((id) => [id, {}])) },
      cwd: dir,
      title: "T",
      argv: [],
      env: {},
      out: { write: (chunk: string) => (text += chunk) },
      err: { write: (chunk: string) => (notes += chunk) },
      prepare: () => undefined,
      ...over,
    })
    process.exitCode = 0
    return { ...result, text, notes, calls }
  }
  const log = (id: string) => readFileSync(path.join(dir, LOG_DIRECTORY, `${id}.log`), "utf8")

  it("prints a line as each check finishes, with how long it took and how many are done", async () => {
    const { text } = await go({ Lint: "pass", Tests: "fail" })
    expect(text).toContain("[contract] Lint finished in 1.5s (1 of 2)")
    expect(text).toContain("[contract] Tests finished in 1.5s (2 of 2)")
    expect((await go({ Lint: "pass" })).notes).toBe("")
    expect((await go({}, {}, false)).notes).toBe("")
    expect(text.indexOf("Lint finished")).toBeLessThan(text.indexOf("[PASS] Lint"))
  })
  it("says a failure on the console as its verdict arrives, before the report, and not a pass", async () => {
    const { text } = await go({ Lint: "pass", Tests: "fail" })
    expect(text).toContain("[contract] FAIL Tests: Tests said so")
    expect(text).not.toContain("[contract] FAIL Lint")
    expect(text.indexOf("[contract] FAIL Tests")).toBeLessThan(text.indexOf("[FAIL] Tests"))
  })
  it("writes each log as its evidence arrives and leads it with the verdict as that arrives, before the run ends", async () => {
    const seen: string[] = []
    await go({ Lint: "pass", Tests: "fail" }, {}, true, async () => {
      await repoContractLogs({ cwd: dir, mode: "failing" }).flush()
      seen.push(log("Tests").split("\n")[0] ?? "")
      seen.push(String(existsSync(path.join(dir, LOG_DIRECTORY, "Lint.log"))))
    })
    expect(seen).toEqual(["Verdict: FAIL", "false"])
  })
  it("writes a log for what did not pass, led by its verdict, and none for what passed", async () => {
    const { text } = await go({ Lint: "pass", Tests: "fail" })
    expect(existsSync(path.join(dir, LOG_DIRECTORY, "Lint.log"))).toBe(false)
    expect(log("Tests").startsWith("Verdict: FAIL\n\nTests said so\n\n=== evidence ===")).toBe(true)
    expect(log("Tests")).toContain("Tests output")
    expect(text).toContain("Logs: ")
  })
  it("writes no log, and complains of none, for a check that never ran because an earlier one failed", async () => {
    const { text } = await go({ Lint: "fail", SecuritySocket: "pass" }, { argv: ["--logs", "all"] })
    expect(text).not.toContain("could not write a log")
    expect(existsSync(path.join(dir, LOG_DIRECTORY, "SecuritySocket.log"))).toBe(false)
    expect(existsSync(path.join(dir, LOG_DIRECTORY, "Lint.log"))).toBe(true)
  })
  it("says which logs it kept, by what the mode asks for", async () => {
    const failing = await go({ Lint: "pass", Tests: "fail" })
    expect(failing.text).toContain(`Logs: ${logsShown}/<Check>.log (checks that did not pass)\n`)
    const all = await go({ Lint: "pass", Tests: "fail" }, { argv: ["--logs", "all"] })
    expect(all.text).toContain(`Logs: ${logsShown}/<Check>.log (every check)\n`)
  })
  it("writes a log for every check with --logs all, and none with --logs off", async () => {
    await go({ Lint: "pass", Tests: "fail" }, { argv: ["--logs", "all"] })
    expect(log("Lint").startsWith("Verdict: PASS")).toBe(true)
    rmSync(path.join(dir, "reports"), { recursive: true, force: true })
    const off = await go({ Lint: "pass", Tests: "fail" }, { argv: ["--logs=off"] })
    expect(existsSync(path.join(dir, LOG_DIRECTORY))).toBe(false)
    expect(off.text).not.toContain("Logs: ")
  })
  it("still writes the logs when the engine reports nothing as it goes, from what it returns", async () => {
    const { text, notes } = await go({ Lint: "pass", Tests: "fail" }, {}, false)
    expect(log("Tests").startsWith("Verdict: FAIL")).toBe(true)
    expect(text).not.toContain("finished in")
    expect(notes).toContain("does not report checks as they finish (it needs 0.11.0 or later)")
  })
  it("labels an advisory failure the same in the log as on the console", async () => {
    mkdirSync(path.join(dir, ".repo-contract"), { recursive: true })
    writeFileSync(
      path.join(dir, ".repo-contract/adoption.json"),
      JSON.stringify({ version: 1, startedAt: "2026-01-01", expiresAt: "2999-01-01", enforce: [] }),
    )
    await go({ Lint: "fail" })
    expect(log("Lint").startsWith("Verdict: FAIL (advisory)\n\nLint said so")).toBe(true)
  })
  it("reports a log it could not write once, and carries on", async () => {
    mkdirSync(path.join(dir, "reports/contract"), { recursive: true })
    writeFileSync(path.join(dir, "reports/contract/logs"), "a file where the folder should be")
    const { text, passed } = await go({ Lint: "fail", Tests: "fail" })
    expect(passed).toBe(false)
    expect(text.match(/could not write a log/g)).toHaveLength(1)
  })
  it("with --changed, runs only the checks the changed files can affect, and says so", async () => {
    const config = { checks: { GitHygiene: {}, DocsLinks: {}, Lint: {} } }
    const { text, calls } = await go(
      { GitHygiene: "pass", DocsLinks: "pass", Lint: "pass" },
      { argv: ["--changed"], changed: () => ["README.md"], config },
    )
    expect(text).toContain(
      "[contract] --changed: only documentation changed; running 2 of 3 checks.",
    )
    expect((calls[0] as { checks: string[] }).checks).toEqual(["GitHygiene", "DocsLinks"])
  })
  it("with --changed, runs everything when source changed, or when git cannot say", async () => {
    const config = { checks: { GitHygiene: {}, Lint: {} } }
    const source = await go(
      { GitHygiene: "pass", Lint: "pass" },
      { argv: ["--changed"], changed: () => ["src/a.ts"], config },
    )
    expect(source.text).toContain(
      "src/a.ts changed, which can affect any check; running 2 of 2 checks.",
    )
    const unknown = await go(
      { GitHygiene: "pass", Lint: "pass" },
      { argv: ["--changed"], changed: () => undefined, config },
    )
    expect(unknown.text).toContain("git could not say what changed, so every check runs.")
  })
  it("with --changed and --checks, runs only the checks both ask for", async () => {
    const config = { checks: { GitHygiene: {}, DocsLinks: {}, Lint: {} } }
    const { calls } = await go(
      { GitHygiene: "pass", DocsLinks: "pass", Lint: "pass" },
      { argv: ["--changed", "--checks", "DocsLinks,Lint"], changed: () => ["README.md"], config },
    )
    expect((calls[0] as { checks: string[] }).checks).toEqual(["DocsLinks"])
  })
  it("with --changed and --checks, still runs the checks asked for when the change affects everything", async () => {
    const config = { checks: { GitHygiene: {}, DocsLinks: {}, Lint: {} } }
    const { calls } = await go(
      { GitHygiene: "pass", DocsLinks: "pass", Lint: "pass" },
      { argv: ["--changed", "--checks", "Lint"], changed: () => ["package.json"], config },
    )
    expect((calls[0] as { checks: string[] }).checks).toEqual(["Lint"])
  })
  it("with --json, prints the report as one JSON document and nothing else", async () => {
    const { text, passed } = await go({ Lint: "pass", Tests: "fail" }, { argv: ["--json"] })
    expect(passed).toBe(false)
    const report = JSON.parse(text)
    expect(report.passed).toBe(false)
    expect(report.counts.fail).toBe(1)
    expect(report.checks.map((check: { id: string }) => check.id)).toEqual(["Lint", "Tests"])
    expect(report.exceptions.total).toBe(0)
    expect(text.endsWith("}\n")).toBe(true)
  })
  it("with --json, hides the progress and the --changed note too, but still sets the exit code", async () => {
    const { text } = await go(
      { Lint: "fail" },
      { argv: ["--json", "--changed"], changed: () => ["README.md"] },
    )
    expect(text).not.toContain("[contract]")
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe("processTrouble", () => {
  it("adds nothing for a process that ended normally, and says how a trouble one ended", () => {
    expect(processTrouble({ status: "completed", exitCode: 0 })).toBe("")
    expect(processTrouble({ status: "completed", exitCode: 2 })).toBe(" -- exit code 2")
    expect(processTrouble({ status: "timed_out", exitCode: null })).toBe(" -- timed_out")
  })
})
