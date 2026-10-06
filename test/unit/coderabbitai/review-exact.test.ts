import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  defaultBaseRef,
  gitIn,
  hasUncommittedEdits,
  interpretCliResult,
  isDetachedHead,
  parseAgentStream,
  runCoderabbitReview,
} from "../../../scripts/coderabbitai/review.js"
import type { CliDependencies, GitResult } from "../../../scripts/coderabbitai/review.js"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const scratch = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-coderabbit-exact-"))
  roots.push(root)
  return root
}

const ran = (status: number | null, stdout = "", error?: Error): GitResult => ({
  status,
  stdout,
  error,
})
const complete = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "complete", status: "review_completed", findings: 0, ...extra })
const finding = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "finding",
    severity: "major",
    fileName: "src/a.ts",
    codegenInstructions: "Do it.",
    ...extra,
  })

describe("the git helpers", () => {
  it("detect a detached HEAD from a non-zero exit, but not from a spawn failure", () => {
    const calls: string[][] = []
    const detached = (result: GitResult) =>
      isDetachedHead((args) => {
        calls.push(args)
        return result
      })
    expect(detached(ran(0))).toBe(false)
    expect(detached(ran(1))).toBe(true)
    expect(detached(ran(128))).toBe(true)
    expect(detached(ran(null, "", new Error("ENOENT")))).toBe(false)
    expect(detached({ status: 1, stdout: "", error: new Error("boom") })).toBe(false)
    expect(calls[0]).toEqual(["symbolic-ref", "-q", "HEAD"])
  })

  it("see uncommitted edits only from a successful status with output", () => {
    const calls: string[][] = []
    const edits = (result: GitResult) =>
      hasUncommittedEdits((args) => {
        calls.push(args)
        return result
      })
    expect(edits(ran(0, " M a.ts\n"))).toBe(true)
    expect(edits(ran(0, ""))).toBe(false)
    expect(edits(ran(0, "  \n"))).toBe(false)
    expect(edits(ran(1, " M a.ts\n"))).toBe(false)
    expect(edits(ran(0, " M a.ts\n", new Error("boom")))).toBe(false)
    expect(edits(ran(null, " M a.ts\n"))).toBe(false)
    expect(calls[0]).toEqual(["status", "--porcelain", "--untracked-files=no"])
  })

  it("pick origin/main only when it verifies", () => {
    const calls: string[][] = []
    const base = (result: GitResult) =>
      defaultBaseRef((args) => {
        calls.push(args)
        return result
      })
    expect(base(ran(0))).toBe("origin/main")
    expect(base(ran(1))).toBe("main")
    expect(base(ran(0, "", new Error("boom")))).toBe("main")
    expect(calls[0]).toEqual(["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"])
  })

  it("work against a real repository", () => {
    const root = scratch()
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    writeFileSync(path.join(root, "a.txt"), "a")
    git("add", "-A")
    git("commit", "-q", "-m", "x")
    const runner = gitIn(root)
    expect(isDetachedHead(runner)).toBe(false)
    expect(hasUncommittedEdits(runner)).toBe(false)
    expect(defaultBaseRef(runner)).toBe("main")
    writeFileSync(path.join(root, "a.txt"), "changed")
    expect(hasUncommittedEdits(runner)).toBe(true)
    writeFileSync(path.join(root, "untracked.txt"), "u")
    git("checkout", "-q", "--", "a.txt")
    expect(hasUncommittedEdits(runner)).toBe(false)
    git("checkout", "-q", "--detach")
    expect(isDetachedHead(runner)).toBe(true)
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    expect(defaultBaseRef(runner)).toBe("origin/main")
    expect(isDetachedHead(gitIn(scratch()))).toBe(true)
  })
})

describe("parseAgentStream() input shapes", () => {
  const noType = 'coderabbit review --agent produced an event with no recognized "type" field.'
  it("rejects any line that is not an object with a string type", () => {
    for (const line of [
      "[]",
      "null",
      "3",
      '"x"',
      "{}",
      '{"type":3}',
      '[{"type":"complete"}]',
      "true",
    ]) {
      expect(parseAgentStream(line), line).toEqual({ ok: false, error: noType })
    }
  })

  it("accepts an object event of a type it does not interpret", () => {
    expect(parseAgentStream(`{"type":"status"}\n${complete()}`)).toEqual({
      ok: true,
      findings: [],
      completed: true,
    })
  })

  it("names the unexpected status it was given", () => {
    expect(parseAgentStream(complete({ status: "failed" }))).toEqual({
      ok: false,
      error:
        'coderabbit review --agent produced a "complete" event with an unexpected status ("failed"); expected "review_completed" or "review_skipped".',
    })
    expect(parseAgentStream(JSON.stringify({ type: "complete", findings: 0 }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("unexpected status (undefined)") as unknown,
    })
  })

  it("requires the count on the complete event to equal the findings streamed, whatever its type", () => {
    for (const count of ["0", 0.5, -1, null, undefined, 1]) {
      expect(parseAgentStream(complete({ findings: count })), String(count)).toMatchObject({
        ok: false,
      })
    }
    expect(parseAgentStream(`${finding()}\n${complete({ findings: 1 })}`)).toMatchObject({
      ok: true,
    })
    expect(parseAgentStream(complete({ status: "review_skipped" }))).toEqual({
      ok: true,
      findings: [],
      completed: true,
    })
  })
})

describe("interpretCliResult() on a malformed stream", () => {
  it("reports the parse failure as an error", () => {
    expect(interpretCliResult({ stdout: "not json", stderr: "", status: 0 })).toEqual({
      status: "error",
      message: "coderabbit review --agent produced a non-JSON line: not json",
    })
  })
})

describe("runCoderabbitReview()", () => {
  const deps = (overrides: Partial<CliDependencies> = {}): CliDependencies => ({
    env: {},
    isDetachedHead: () => false,
    hasUncommittedEdits: () => true,
    defaultBaseRef: () => "main",
    spawn: () => ({ stdout: complete(), stderr: "", status: 0 }),
    ...overrides,
  })
  const registryOf = (root: string) => path.join(root, ".repo-contract/exceptions/coderabbit.json")

  it("short-circuits in CI, naming the provider that takes over", async () => {
    const evidence = await runCoderabbitReview(scratch(), deps({ env: { CI: "1" } }))
    expect(evidence).toEqual({
      status: "not-applicable",
      reason: "ci",
      expectedProvider: "coderabbit-github-app",
      registryPath: ".repo-contract/exceptions/coderabbit.json",
      existingRecordCount: 0,
    })
  })

  it("reports an unavailable git context without running the CLI", async () => {
    let spawned = false
    const evidence = await runCoderabbitReview(
      scratch(),
      deps({
        isDetachedHead: () => true,
        spawn: () => {
          spawned = true
          return { stdout: "", stderr: "", status: 0 }
        },
      }),
    )
    expect(spawned).toBe(false)
    expect(evidence).toEqual({
      status: "unavailable",
      reason: "git-context-unavailable",
      registryPath: ".repo-contract/exceptions/coderabbit.json",
      existingRecordCount: 0,
    })
  })

  it("reports a CLI that is not installed as unavailable, and any other failure as an error", async () => {
    const enoent = Object.assign(new Error("spawn coderabbit ENOENT"), { code: "ENOENT" })
    expect(
      await runCoderabbitReview(
        scratch(),
        deps({ spawn: () => ({ error: enoent, stdout: "", stderr: "", status: null }) }),
      ),
    ).toEqual({
      status: "unavailable",
      reason: "cli-not-installed",
      registryPath: ".repo-contract/exceptions/coderabbit.json",
      existingRecordCount: 0,
    })
    expect(
      await runCoderabbitReview(
        scratch(),
        deps({ spawn: () => ({ stdout: "garbage", stderr: "", status: 0 }) }),
      ),
    ).toEqual({
      status: "error",
      message: "coderabbit review --agent produced a non-JSON line: garbage",
      registryPath: ".repo-contract/exceptions/coderabbit.json",
      existingRecordCount: 0,
    })
  })

  it("passes the arguments for the state of the tree to the CLI, with its limits", async () => {
    const seen: { command: string; args: string[]; options: Record<string, unknown> }[] = []
    const record = (uncommitted: boolean, base: string) =>
      runCoderabbitReview(
        scratch(),
        deps({
          hasUncommittedEdits: () => uncommitted,
          defaultBaseRef: () => base,
          spawn: (command, args, options) => {
            seen.push({ command, args, options: options as Record<string, unknown> })
            return { stdout: complete(), stderr: "", status: 0 }
          },
        }),
      )
    await record(true, "main")
    await record(false, "origin/main")
    expect(seen[0]).toMatchObject({
      command: "coderabbit",
      args: ["review", "--agent", "--uncommitted"],
    })
    expect(seen[1]?.args).toEqual(["review", "--agent", "--committed", "--base", "origin/main"])
    expect(seen[0]?.options).toEqual({
      encoding: "utf8",
      timeout: 600_000,
      killSignal: "SIGKILL",
      maxBuffer: 33_554_432,
    })
  })

  it("reconciles findings into the registry, collapsing duplicates and scaffolding stubs", async () => {
    const root = scratch()
    const stream = [
      finding(),
      finding(),
      finding({ fileName: "src/b.ts", severity: "minor" }),
      complete({ findings: 3 }),
    ].join("\n")
    const evidence = await runCoderabbitReview(
      root,
      deps({ spawn: () => ({ stdout: stream, stderr: "", status: 0 }) }),
    )
    expect(evidence.status).toBe("reviewed")
    if (evidence.status !== "reviewed") throw new Error("not reviewed")
    expect(evidence.findings.map((f) => f.file)).toEqual(["src/a.ts", "src/b.ts"])
    expect(evidence.registryPath).toBe(".repo-contract/exceptions/coderabbit.json")
    expect(evidence.scaffoldedIds).toHaveLength(2)
    expect(Object.keys(evidence.activeExceptions).sort()).toEqual(
      [...evidence.scaffoldedIds].sort(),
    )
    expect(evidence.staleExceptions).toEqual([])
    expect(evidence.registryError).toBeUndefined()
    const written = JSON.parse(readFileSync(registryOf(root), "utf8")) as {
      exceptions: { id: string }[]
    }
    expect(written.exceptions.map((r) => r.id).sort()).toEqual([...evidence.scaffoldedIds].sort())

    const again = await runCoderabbitReview(
      root,
      deps({ spawn: () => ({ stdout: complete(), stderr: "", status: 0 }) }),
    )
    if (again.status !== "reviewed") throw new Error("not reviewed")
    expect(again.findings).toEqual([])
    expect(again.scaffoldedIds).toEqual([])
    expect(again.staleExceptions).toHaveLength(2)
    expect(again.activeExceptions).toEqual({})
  })

  it("reports a registry it cannot read, leaving the findings in the evidence", async () => {
    const root = scratch()
    mkdirSync(registryOf(root), { recursive: true })
    const evidence = await runCoderabbitReview(
      root,
      deps({
        spawn: () => ({
          stdout: `${finding()}\n${complete({ findings: 1 })}`,
          stderr: "",
          status: 0,
        }),
      }),
    )
    expect(evidence.status).toBe("reviewed")
    if (evidence.status !== "reviewed") throw new Error("not reviewed")
    expect(evidence.registryError?.length).toBeGreaterThan(0)
    expect(evidence.findings).toHaveLength(1)
    expect(evidence.activeExceptions).toEqual({})
    expect(evidence.staleExceptions).toEqual([])
    expect(evidence.scaffoldedIds).toEqual([])
  })

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "reports a registry it can read but not write back, keeping the findings",
    async () => {
      const root = scratch()
      const directory = path.dirname(registryOf(root))
      mkdirSync(directory, { recursive: true })
      writeFileSync(registryOf(root), JSON.stringify({ exceptions: [] }))
      chmodSync(directory, 0o555)
      try {
        const evidence = await runCoderabbitReview(
          root,
          deps({
            spawn: () => ({
              stdout: `${finding()}\n${complete({ findings: 1 })}`,
              stderr: "",
              status: 0,
            }),
          }),
        )
        expect(evidence.status).toBe("reviewed")
        if (evidence.status !== "reviewed") throw new Error("not reviewed")
        expect(evidence.registryError).toHaveLength(1)
        expect(evidence.registryError?.[0]).toMatch(
          /^(Could not write|Writing) \.repo-contract\/exceptions\/coderabbit\.json/,
        )
        expect(evidence.findings).toHaveLength(1)
        expect(evidence.activeExceptions).toEqual({})
        expect(evidence.staleExceptions).toEqual([])
        expect(evidence.scaffoldedIds).toEqual([])
      } finally {
        chmodSync(directory, 0o755)
      }
    },
  )

  it("reports a registry it cannot write", async () => {
    const root = scratch()
    writeFileSync(path.join(root, ".repo-contract"), "a file where a folder should be")
    const evidence = await runCoderabbitReview(
      root,
      deps({
        spawn: () => ({
          stdout: `${finding()}\n${complete({ findings: 1 })}`,
          stderr: "",
          status: 0,
        }),
      }),
    )
    expect(evidence.status).toBe("reviewed")
    expect(evidence.registryError?.join("\n")).toMatch(
      /Could not write \.repo-contract\/exceptions\/coderabbit\.json|Writing \.repo-contract\/exceptions\/coderabbit\.json failed|exceptions\/coderabbit\.json/,
    )
    if (evidence.status !== "reviewed") throw new Error("not reviewed")
    expect(evidence.findings).toHaveLength(1)
    expect(evidence.scaffoldedIds).toEqual([])
  })
})
