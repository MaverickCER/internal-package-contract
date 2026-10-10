import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * `internal-package-contract init` is how a package adopts the standard, and the only way a user
 * reaches `bin/init.mjs` is through the dispatcher in `bin/contract.mjs`. The argument parser has its
 * own unit tests; this runs the real command so a mismatch between what the dispatcher passes along
 * and what `init` expects (the subcommand name itself arriving as an unknown argument) cannot hide.
 */
const bin = path.resolve(import.meta.dirname, "../bin/contract.mjs")
let cwd: string

function init(...args: string[]): { status: number | null; output: string } {
  const run = spawnSync(process.execPath, [bin, "init", ...args], { cwd, encoding: "utf8" })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-init-dispatch-"))
  spawnSync("git", ["init", "-q"], { cwd })
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe("internal-package-contract init (through the dispatcher)", () => {
  it("scaffolds the repository hygiene files when given no flags", () => {
    const { status, output } = init()
    expect(output).not.toContain("Unknown argument")
    expect(status).toBe(0)
    expect(existsSync(path.join(cwd, ".gitignore"))).toBe(true)
    expect(existsSync(path.join(cwd, ".github", "workflows", "contract.yml"))).toBe(true)
  })

  it("scaffolds a complete package from --name, --owner and --description", () => {
    const { status, output } = init(
      "--name",
      "dispatch-demo",
      "--owner",
      "ExampleOwner",
      "--description",
      "A demo",
    )
    expect(output).not.toContain("Unknown argument")
    expect(status).toBe(0)
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      name: string
      description: string
    }
    expect(pkg.name).toBe("dispatch-demo")
    expect(pkg.description).toBe("A demo")
  })

  it("still rejects a genuinely unknown argument", () => {
    const { status, output } = init("--bogus")
    expect(status).not.toBe(0)
    expect(output).toContain('Unknown argument "--bogus"')
  })
})
