import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
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

/** What a failed Prettier run printed; anything that is not a nonzero exit (a spawn failure) is rethrown. */
function prettierFailure(error: unknown): string {
  const failure = error as { status?: unknown; stdout?: string; stderr?: string }
  if (typeof failure.status !== "number") throw error
  return `${failure.stdout ?? ""}${failure.stderr ?? ""}`
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-scaffold-health-"))
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" })
  expect(init.error, `git init failed to start: ${String(init.error)}`).toBeUndefined()
  expect(init.status, `git init failed: ${init.stdout}${init.stderr}`).toBe(0)
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
  it("is left byte-for-byte unchanged by running init again", () => {
    const snapshot = (): Record<string, string> => {
      const files: Record<string, string> = {}
      const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          if (entry.name === ".git") continue
          const full = path.join(current, entry.name)
          if (entry.isDirectory()) walk(full)
          else files[path.relative(dir, full)] = readFileSync(full, "utf8")
        }
      }
      walk(dir)
      return files
    }
    const before = snapshot()
    const again = spawnSync(
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
    expect(again.status, `${again.stdout}${again.stderr}`).toBe(0)
    expect(snapshot()).toEqual(before)
  })

  it("carries the repository rules for an agent", () => {
    const agents = readFileSync(path.join(dir, "AGENTS.md"), "utf8")
    expect(agents).toContain("`health-demo`")
    expect(agents).toContain("Co-Authored-By")
    expect(agents).toContain("--no-verify")
    expect(agents).toContain("npm run verify")
  })

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
      output = prettierFailure(error)
    }
    expect(output, "files Prettier would rewrite").toBe("")
  })

  it("defines the verify gate the shared release workflow runs before it publishes", () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    // Without a `verify` script the release workflow falls back to a bare build and publishes anyway.
    expect(pkg.scripts["verify"]).toBeDefined()
    for (const step of ["typecheck", "lint", "format:check", "build", "test:coverage"]) {
      expect(pkg.scripts["verify"], `verify should run ${step}`).toContain(`npm run ${step}`)
    }
    expect(pkg.scripts["prepublishOnly"]).toBe("npm run verify")
  })

  it("links from its documents to nothing outside the package by a relative path", () => {
    // `../../security/advisories/new` resolves on github.com but is a dead link in the tarball.
    const escaping = readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .flatMap((file) =>
        readFileSync(path.join(dir, file), "utf8")
          .split("\n")
          .flatMap((line, index) =>
            /\]\(\.\.\//.test(line) ? [`${file}:${String(index + 1)}`] : [],
          ),
      )
    expect(escaping).toEqual([])
  })

  it("publishes its own documents, anchored to the package root, and carries the guard for their links", () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      files: string[]
    }
    // "*.md" would also match Markdown inside any directory another entry opens, such as generated files.
    expect(pkg.files).toContain("/*.md")
    expect(pkg.files).not.toContain("*.md")
    expect(existsSync(path.join(dir, "test", "docs-pack-links.test.ts"))).toBe(true)
  })

  it("ships the committed API report that the ApiDocsReport check compares against", () => {
    const report = path.join(dir, "docs", "api-report", "README.md")
    expect(existsSync(report)).toBe(true)
    expect(readFileSync(report, "utf8")).toContain("# health-demo")
  })
})
