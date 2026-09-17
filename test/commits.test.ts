import { describe, expect, it } from "vitest"
import { commits } from "../checks/commits.js"
import { makeContext, makeResult } from "./support.js"

describe("commits", () => {
  it("warns when origin/main cannot be resolved -- nothing to lint", async () => {
    const check = commits()
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 1, stderr: "fatal: bad revision 'origin/main..HEAD'" })),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("could not resolve `origin/main..HEAD`")
  })

  it("does not treat a successful exit as pre-adoption history, even if the output happens to contain 8+ failing-block markers", async () => {
    const check = commits()
    const failingBlock = Array.from({ length: 8 }, () => "⧗   --- input ---").join("\n")
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 0, stdout: failingBlock })),
    )
    expect(result.outcome).not.toBe("warn")
  })

  it("does not warn on a successful exit even if its output happens to contain 'bad revision' text", async () => {
    const check = commits()
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 0, stdout: "totally unrelated bad revision mention" })),
    )
    expect(result.outcome).not.toBe("warn")
  })

  it("fails at exactly one below the pre-adoption threshold (a real regression, not history)", async () => {
    const check = commits()
    const failingBlock = Array.from({ length: 7 }, () => "⧗   --- input ---").join("\n")
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 1, stdout: failingBlock })),
    )
    expect(result.outcome).toBe("fail")
  })

  it("warns (pre-adoption history), with the exact multi-line message, at exactly the threshold", async () => {
    const check = commits()
    const failingBlock = Array.from({ length: 8 }, () => "⧗   --- input ---").join("\n")
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 1, stdout: failingBlock })),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale: [
        "Commits: 8 commits in `origin/main..HEAD` are not Conventional Commits -- this looks like history that predates the standard, not a regression.",
        "Resolve it as a git-history operation before merge:",
        "  - squash-merge the branch (one conforming message), or",
        "  - `git rebase -i origin/main` and `reword` each with a `type: subject` header.",
        "New commits on top of a conforming base will fail here as usual.",
      ].join("\n"),
    })
  })

  it("uses a custom `from` ref throughout its pre-adoption message", async () => {
    const check = commits({ from: "origin/develop" })
    const failingBlock = Array.from({ length: 8 }, () => "⧗   --- input ---").join("\n")
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 1, stdout: failingBlock, command: "commitlint" })),
    )
    expect(result.rationale).toContain("origin/develop..HEAD")
    expect(result.rationale).toContain("git rebase -i origin/develop")
  })

  it("passes a clean history using a custom `from` ref, delegating it through to the underlying commitlint preset", async () => {
    const check = commits({ from: "origin/develop" })
    const result = await check.policy(makeContext(makeResult({ exitCode: 0 })))
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("between origin/develop and HEAD")
  })

  it("fails a genuine regression -- a few non-conforming commits below the pre-adoption threshold", async () => {
    const check = commits()
    const failingBlock = "⧗   --- input ---"
    const result = await check.policy(
      makeContext(makeResult({ exitCode: 1, stdout: failingBlock })),
    )
    expect(result.outcome).toBe("fail")
  })

  it("passes a clean history", async () => {
    const check = commits()
    const result = await check.policy(makeContext(makeResult({ exitCode: 0 })))
    expect(result.outcome).toBe("pass")
  })

  it("wires run to the bundled commitlint.config.mjs when the consumer has no config of their own", () => {
    const check = commits()
    const run = check.run as string[]
    expect(run).toContain("--config")
    expect(run.at(-1)).toContain("commitlint.config.mjs")
  })
})
