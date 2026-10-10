import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * A package made by `init --name` has to work before anyone has touched it: install, and pass the
 * checks that only look at files the scaffold itself wrote. These tests scaffold one for real and
 * check that, so a template edit cannot quietly ship a package that fails on its first command.
 */
const root = path.resolve(import.meta.dirname, "..")
const bin = path.join(root, "bin", "contract.mjs")
const prettier = path.join(root, "node_modules", ".bin", "prettier")
let dir: string

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-scaffold-health-"))
  spawnSync("git", ["init", "-q"], { cwd: dir })
  const run = spawnSync(
    process.execPath,
    [
      bin,
      "init",
      "--name",
      "health-demo",
      "--owner",
      "ExampleOwner",
      "--description",
      "A health demo",
    ],
    { cwd: dir, encoding: "utf8" },
  )
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("a freshly scaffolded package", () => {
  it("declares @types/node for the Node floor it supports, so it can install", () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      engines: { node: string }
      devDependencies: Record<string, string>
    }
    const floor = /(\d+)/.exec(pkg.engines.node)?.[1]
    expect(floor).toBeDefined()
    expect(pkg.devDependencies["@types/node"]).toMatch(new RegExp(`^\\^${String(floor)}\\.`))
  })

  it("is already formatted the way the Format check wants", () => {
    let output = ""
    try {
      execFileSync(
        prettier,
        [
          "--check",
          "--config",
          path.join(root, "prettier.config.mjs"),
          "--ignore-path",
          ".prettierignore",
          ".",
        ],
        { cwd: dir, encoding: "utf8", stdio: "pipe" },
      )
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string }
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`
    }
    expect(output, "files Prettier would rewrite").toBe("")
  })

  it("ships the committed API report that the ApiDocsReport check compares against", () => {
    const report = path.join(dir, "docs", "api-report", "README.md")
    expect(existsSync(report)).toBe(true)
    expect(readFileSync(report, "utf8")).toContain("# health-demo")
  })
})
