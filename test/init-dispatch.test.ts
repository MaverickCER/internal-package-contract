import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * `internal-package-contract init` is the one command that brings a package under the standard, and the only
 * way a user reaches the orchestrator in `scripts/init/run.mjs` is through the dispatcher in `bin/contract.mjs`.
 * The orchestrator has its own unit tests with a fake runner; this runs the real command, offline (every case
 * here either stops early or is a dry run), so a mismatch between what the dispatcher passes along and what the
 * orchestrator expects cannot hide.
 */
const bin = path.resolve(import.meta.dirname, "../bin/contract.mjs")
let cwd: string

function init(...args: string[]): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [bin, "init", ...args], { cwd, encoding: "utf8" })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}
const git = (...args: string[]) =>
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-init-dispatch-"))
  git("init", "-q")
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe("internal-package-contract init (through the dispatcher)", () => {
  it("asks for a name when there is no package here to bring under the standard", () => {
    const { status, output } = init()
    expect(status).toBe(2)
    expect(output).toContain("there is no package.json here")
    expect(output).toContain("`init --name <package>`")
  })

  it("says what it would do for a new package, and changes nothing, on a dry run", () => {
    const { status, output } = init("--name", "dispatch-demo", "--dry-run")
    expect(status).toBe(0)
    expect(output).toContain("would scaffold dispatch-demo here")
  })

  it("rejects an unknown argument, naming it", () => {
    const { status, output } = init("--bogus")
    expect(status).toBe(2)
    expect(output).toContain("unknown argument: --bogus")
  })

  it("prints the plan for an existing package on a dry run, naming its owner and what it would add", () => {
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "@acme/w", version: "1.0.0" }),
    )
    git("add", "-A")
    git("commit", "-q", "-m", "chore: init")
    const { status, output } = init("--dry-run", "--owner", "Acme", "--spec", "file:/x")
    expect(status).toBe(0)
    expect(output).toContain("@acme/w, owned by Acme, to internal-package-contract file:/x:")
    expect(output).toContain("dry run: nothing was changed.")
  })

  it("refuses to start over uncommitted changes, so the adoption is a diff that can be undone", () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "@acme/w" }))
    const { status, output } = init("--owner", "Acme", "--spec", "file:/x")
    expect(status).toBe(1)
    expect(output).toContain("commit or stash these first")
  })
})
