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

  it("defines the verify gate the shared release workflow runs before it publishes", () => {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
      scripts: Record<string, string>
    }
    // Without a `verify` script the release workflow falls back to a bare build and publishes anyway.
    expect(pkg.scripts.verify).toBeDefined()
    for (const step of ["typecheck", "lint", "format:check", "build", "test:coverage"]) {
      expect(pkg.scripts.verify, `verify should run ${step}`).toContain(`npm run ${step}`)
    }
    expect(pkg.scripts.prepublishOnly).toBe("npm run verify")
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
