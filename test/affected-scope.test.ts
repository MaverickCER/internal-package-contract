import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AffectedResult } from "repo-contract/affected"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  SCOPE_PATH,
  capabilities,
  computeFromGit,
  describeScope,
  readScope,
  resolveRunScope,
  withScope,
  writeScope,
} from "../scripts/affected-scope.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-affected-scope-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const result = (patch: Record<string, unknown> = {}) => ({
  scope: "affected",
  changedFiles: ["src/a.ts"],
  changedSymbols: ["src/a.ts#a"],
  affectedSources: ["src/a.ts", "src/b.ts"],
  affectedTests: ["test/b.test.ts"],
  mutateTargets: ["src/a.ts", "src/b.ts"],
  widened: [],
  causes: new Map(),
  ...patch,
})
const asked: { cwd: string; base: string | undefined }[] = []
const compute = (value: unknown) => async (cwd: string, base: string | undefined) => {
  asked.push({ cwd, base })
  return value as AffectedResult
}
beforeEach(() => {
  asked.length = 0
})

const FULL_EMPTY = { tests: [], sources: [], mutate: [], changedFiles: [] }

describe("resolveRunScope", () => {
  it("runs everything when nothing asks for less, and does not look at the changes", async () => {
    const doc = await resolveRunScope({ argv: [], env: {}, cwd: dir, compute: compute(result()) })
    expect(doc).toEqual({
      schemaVersion: 1,
      scope: "full",
      reason: "nothing asked for less (--scope affected or auto does)",
      ...FULL_EMPTY,
    })
    expect(asked).toEqual([])
  })

  it("narrows to what the changes affect when asked to, passing the base along", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected", "--base", "origin/dev"],
      env: {},
      cwd: dir,
      compute: compute(result()),
    })
    expect(asked).toEqual([{ cwd: dir, base: "origin/dev" }])
    expect(doc).toEqual({
      schemaVersion: 1,
      scope: "affected",
      reason: expect.any(String),
      base: "origin/dev",
      changedFiles: ["src/a.ts"],
      tests: ["test/b.test.ts"],
      sources: ["src/a.ts", "src/b.ts"],
      mutate: ["src/a.ts", "src/b.ts"],
    })
  })

  it("leaves out the base when none was given", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope=affected"],
      env: {},
      cwd: dir,
      compute: compute(result()),
    })
    expect(doc).not.toHaveProperty("base")
    expect(asked).toEqual([{ cwd: dir, base: undefined }])
  })

  it("lets the environment decide with --scope auto: a pull request narrows, a push does not", async () => {
    const pull = await resolveRunScope({
      argv: ["--scope", "auto"],
      env: { GITHUB_EVENT_NAME: "pull_request" },
      cwd: dir,
      compute: compute(result()),
    })
    expect(pull.scope).toBe("affected")
    const push = await resolveRunScope({
      argv: ["--scope", "auto"],
      env: { GITHUB_EVENT_NAME: "push" },
      cwd: dir,
      compute: compute(result()),
    })
    expect(push.scope).toBe("full")
    expect(asked).toHaveLength(1)
  })

  it("never narrows a release, whatever was asked", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected"],
      env: { GITHUB_EVENT_NAME: "release" },
      cwd: dir,
      compute: compute(result()),
    })
    expect(doc.scope).toBe("full")
    expect(asked).toEqual([])
  })

  it("honours CI_FULL over the flag", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected"],
      env: { CI_FULL: "1" },
      cwd: dir,
      compute: compute(result()),
    })
    expect(doc.scope).toBe("full")
  })

  it("reads REPO_CONTRACT_SCOPE when no flag is given", async () => {
    const doc = await resolveRunScope({
      argv: [],
      env: { REPO_CONTRACT_SCOPE: "affected" },
      cwd: dir,
      compute: compute(result()),
    })
    expect(doc.scope).toBe("affected")
    const flagWins = await resolveRunScope({
      argv: ["--scope", "full"],
      env: { REPO_CONTRACT_SCOPE: "affected" },
      cwd: dir,
      compute: compute(result()),
    })
    expect(flagWins.scope).toBe("full")
  })

  it("runs everything, and says why, when the analysis could not narrow it", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected"],
      env: {},
      cwd: dir,
      compute: compute(
        result({
          scope: "full",
          fullBecause: { reason: "global-trigger", file: "package-lock.json", to: "full" },
        }),
      ),
    })
    expect(doc).toEqual({
      schemaVersion: 1,
      scope: "full",
      reason: "global-trigger: package-lock.json",
      ...FULL_EMPTY,
    })
  })

  it("includes the detail when the analysis gave one", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected"],
      env: {},
      cwd: dir,
      compute: compute(
        result({
          scope: "full",
          fullBecause: { reason: "git-failed", file: "diff", to: "full", detail: "no base" },
        }),
      ),
    })
    expect(doc.reason).toBe("git-failed: diff (no base)")
  })

  it("runs everything when the analysis itself fails", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected"],
      env: {},
      cwd: dir,
      compute: async () => {
        throw new Error("typescript is not installed")
      },
    })
    expect(doc).toEqual({
      schemaVersion: 1,
      scope: "full",
      reason: "the affected analysis failed: typescript is not installed",
      ...FULL_EMPTY,
    })
  })

  it("reads a thrown non-Error as text", async () => {
    const doc = await resolveRunScope({
      argv: ["--scope", "affected"],
      env: {},
      cwd: dir,
      compute: () => Promise.reject("boom" as unknown as Error),
    })
    expect(doc.reason).toBe("the affected analysis failed: boom")
  })

  it("rejects a flag it cannot use, as a usage error", async () => {
    await expect(
      resolveRunScope({
        argv: ["--scope", "partial"],
        env: {},
        cwd: dir,
        compute: compute(result()),
      }),
    ).rejects.toMatchObject({
      message: 'The scope must be one of auto, affected, full, not "partial".',
      usage: true,
    })
    await expect(
      resolveRunScope({ argv: ["--scope"], env: {}, cwd: dir, compute: compute(result()) }),
    ).rejects.toMatchObject({ usage: true })
  })

  it("passes arguments that are not its own through untouched", async () => {
    const doc = await resolveRunScope({
      argv: ["--checks", "Tests", "--json"],
      env: {},
      cwd: dir,
      compute: compute(result()),
    })
    expect(doc.scope).toBe("full")
  })
})

describe("writeScope and readScope", () => {
  const doc = {
    schemaVersion: 1 as const,
    scope: "affected" as const,
    reason: "x",
    changedFiles: ["a"],
    tests: ["t"],
    sources: ["s"],
    mutate: ["m"],
  }

  it("keeps the scope under reports/contract, where a run's cleanup leaves it", () => {
    expect(SCOPE_PATH).toBe(path.join("reports", "contract", "scope.json"))
    writeScope(dir, doc)
    expect(readScope(dir)).toEqual(doc)
  })

  it("reads nothing when there is no file, or it is not a scope", () => {
    expect(readScope(dir)).toBeUndefined()
    mkdirSync(path.join(dir, "reports", "contract"), { recursive: true })
    for (const text of [
      "{",
      "[]",
      "null",
      "5",
      '{"schemaVersion":2,"scope":"full"}',
      '{"schemaVersion":1}',
      '{"schemaVersion":1,"scope":"some"}',
    ]) {
      writeFileSync(path.join(dir, SCOPE_PATH), text)
      expect(readScope(dir)).toBeUndefined()
    }
  })

  it("reads a full scope without lists as one with empty lists", () => {
    mkdirSync(path.join(dir, "reports", "contract"), { recursive: true })
    writeFileSync(path.join(dir, SCOPE_PATH), '{"schemaVersion":1,"scope":"full","reason":"r"}')
    expect(readScope(dir)).toEqual({ schemaVersion: 1, scope: "full", reason: "r", ...FULL_EMPTY })
  })

  it("gives a full scope no reason when the file names none, or not as text", () => {
    mkdirSync(path.join(dir, "reports", "contract"), { recursive: true })
    for (const text of [
      '{"schemaVersion":1,"scope":"full"}',
      '{"schemaVersion":1,"scope":"full","reason":5}',
    ]) {
      writeFileSync(path.join(dir, SCOPE_PATH), text)
      expect(readScope(dir)).toEqual({ schemaVersion: 1, scope: "full", reason: "", ...FULL_EMPTY })
    }
  })

  it("refuses an affected scope whose lists are not lists of text", () => {
    mkdirSync(path.join(dir, "reports", "contract"), { recursive: true })
    for (const patch of [
      { tests: "t" },
      { tests: [1] },
      { mutate: null },
      { sources: {} },
      { changedFiles: [null] },
      { tests: ["t", 1] },
      { scope: "some" },
    ]) {
      writeFileSync(path.join(dir, SCOPE_PATH), JSON.stringify({ ...doc, ...patch }))
      expect(readScope(dir)).toBeUndefined()
    }
  })
})

describe("describeScope", () => {
  it("says what a full run and a narrowed run will do", () => {
    expect(
      describeScope({ schemaVersion: 1, scope: "full", reason: "no flag", ...FULL_EMPTY }),
    ).toBe("scope: full (no flag)")
    expect(
      describeScope({
        schemaVersion: 1,
        scope: "affected",
        reason: "a pull request",
        changedFiles: ["a"],
        tests: ["t1", "t2"],
        sources: ["s"],
        mutate: ["m1", "m2", "m3"],
      }),
    ).toBe("scope: affected (a pull request); 1 changed file, 2 test files, 3 mutation targets")
    expect(
      describeScope({
        schemaVersion: 1,
        scope: "affected",
        reason: "r",
        changedFiles: ["a", "b"],
        tests: ["t"],
        sources: [],
        mutate: ["m"],
      }),
    ).toBe("scope: affected (r); 2 changed files, 1 test file, 1 mutation target")
  })
})

describe("computeFromGit", () => {
  const git = (...args: string[]): void => {
    spawnSync("git", args, { cwd: dir })
  }
  const put = (file: string, text: string): void => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  const installTypeScript = (): void => {
    mkdirSync(path.join(dir, "node_modules"))
    symlinkSync(
      path.resolve(__dirname, "..", "node_modules", "typescript"),
      path.join(dir, "node_modules", "typescript"),
    )
    put(".gitignore", "node_modules\n")
  }

  it("finds the tests a change reaches in a real repository, with the project's own TypeScript", async () => {
    installTypeScript()
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.test")
    git("config", "user.name", "t")
    put("src/a.ts", "export const a = 1\n")
    put("src/b.ts", 'import { a } from "./a.js"\nexport const b = a\n')
    put("test/b.test.ts", 'import { b } from "../src/b.js"\nb\n')
    put("test/other.test.ts", "export {}\n")
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    put("src/a.ts", "export const a = 2\n")
    const found = await computeFromGit(dir, "HEAD")
    expect(found.scope).toBe("affected")
    expect(found.affectedTests).toEqual(["test/b.test.ts"])
    expect(found.mutateTargets).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("reports everything when there is no repository to compare with", async () => {
    installTypeScript()
    put("src/a.ts", "export const a = 1\n")
    const found = await computeFromGit(dir, undefined)
    expect(found.scope).toBe("full")
  })

  it("fails, saying so, when the project has no TypeScript to read its modules with", async () => {
    await expect(computeFromGit(dir, undefined)).rejects.toThrow(
      "TypeScript could not be loaded from the project",
    )
  })

  it("fails when the installed TypeScript has no compiler API, as TypeScript 7 does not", async () => {
    await expect(computeFromGit(dir, undefined, () => ({}))).rejects.toThrow(
      "the installed TypeScript has no compiler API",
    )
    await expect(computeFromGit(dir, undefined, () => undefined)).rejects.toThrow(
      "the installed TypeScript has no compiler API",
    )
  })

  it("keeps the reason the project's TypeScript could not be loaded", async () => {
    const cause = new Error("boom")
    await expect(
      computeFromGit(dir, undefined, () => {
        throw cause
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("boom"), cause })
  })
})

describe("capabilities", () => {
  it("gives git's output, nothing when git says no, and fails when git cannot run", async () => {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir })
    const { git } = capabilities(dir)
    expect(await git(["rev-parse", "--is-inside-work-tree"])).toBe("true\n")
    expect(await git(["rev-parse", "no-such-ref"])).toBeUndefined()
    await expect(capabilities(path.join(dir, "missing")).git(["status"])).rejects.toThrow()
  })

  it("reads a file under the repository, or nothing", async () => {
    writeFileSync(path.join(dir, "a.txt"), "hello")
    const { readFile } = capabilities(dir)
    expect(await readFile("a.txt")).toBe("hello")
    expect(await readFile("b.txt")).toBeUndefined()
  })
})

describe("withScope", () => {
  const narrow = {
    schemaVersion: 1 as const,
    scope: "affected" as const,
    reason: "r",
    changedFiles: [],
    tests: ["t"],
    sources: ["s"],
    mutate: ["m"],
  }
  const full = { ...narrow, scope: "full" as const, tests: [], sources: [], mutate: [] }

  it("leaves the checks exactly as they are for a full run", () => {
    const config = {
      checks: { A: { run: ["a"], policy: () => ({ outcome: "pass", rationale: "" }) } },
    }
    expect(withScope(config, full)).toBe(config)
  })

  it("hands a narrowed run's scope to every policy, with the rest of what it was given", async () => {
    const seen: unknown[] = []
    const config = {
      title: "kept",
      checks: {
        A: {
          run: ["a"],
          timeoutMs: 5,
          policy: (ctx: unknown) => (seen.push(ctx), { outcome: "pass", rationale: "a" }),
        },
        B: {
          run: ["b"],
          dependsOn: ["A"],
          policy: (ctx: unknown) => (seen.push(ctx), { outcome: "fail", rationale: "b" }),
        },
      },
    }
    const wrapped = withScope(config, narrow)
    expect(wrapped).toMatchObject({ title: "kept" })
    expect(Object.keys(wrapped.checks)).toEqual(["A", "B"])
    expect(wrapped.checks.A).toMatchObject({ run: ["a"], timeoutMs: 5 })
    expect(wrapped.checks.B).toMatchObject({ dependsOn: ["A"] })
    expect(await wrapped.checks.A.policy({ result: 1 })).toEqual({
      outcome: "pass",
      rationale: "a",
    })
    expect(await wrapped.checks.B.policy({ result: 2 })).toEqual({
      outcome: "fail",
      rationale: "b",
    })
    expect(seen).toEqual([
      { result: 1, scope: narrow },
      { result: 2, scope: narrow },
    ])
  })

  it("does not change the original config", () => {
    const policy = () => ({ outcome: "pass", rationale: "" })
    const config = { checks: { A: { run: ["a"], policy } } }
    withScope(config, narrow)
    expect(config.checks.A.policy).toBe(policy)
  })
})

describe("withScope: the test command", () => {
  const narrow = (tests: string[]) => ({
    schemaVersion: 1 as const,
    scope: "affected" as const,
    reason: "r",
    changedFiles: [],
    tests,
    sources: [],
    mutate: [],
  })
  const policy = () => ({ outcome: "pass", rationale: "" })
  const config = (run: unknown) => ({
    checks: { Tests: { run, policy }, Lint: { run: ["eslint", "."], policy } },
  })

  it("names only the affected test files on the test command", () => {
    const wrapped = withScope(
      config(["vitest", "run", "--coverage"]),
      narrow(["test/a.test.ts", "test/b.test.ts"]),
    )
    expect(wrapped.checks.Tests.run).toEqual([
      "vitest",
      "run",
      "--coverage",
      "test/a.test.ts",
      "test/b.test.ts",
    ])
    expect(wrapped.checks.Lint.run).toEqual(["eslint", "."])
  })

  it("runs nothing at all when no test file is affected", () => {
    const wrapped = withScope(config(["vitest", "run"]), narrow([]))
    expect(wrapped.checks.Tests.run).toEqual(["node", "--version"])
  })

  it("leaves a test command it cannot append to as it is", () => {
    const wrapped = withScope(config("vitest run"), narrow(["t"]))
    expect(wrapped.checks.Tests.run).toBe("vitest run")
  })

  it("does not touch any other check's command", () => {
    const wrapped = withScope(config(["vitest"]), narrow(["t"]))
    expect(wrapped.checks.Lint.run).toEqual(["eslint", "."])
  })
})
