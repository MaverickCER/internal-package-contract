import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildPinVars,
  buildVars,
  listTemplateFiles,
  parseInitArgs,
  render,
  renderJson,
  shaFromLockfile,
  validatePackageName,
} from "../scripts/init-lib.mjs"

const initScript = path.resolve(__dirname, "../bin/init.mjs")
const packageTemplate = path.resolve(__dirname, "../template/package")

describe("parseInitArgs()", () => {
  it("parses flags in both `--flag value` and `--flag=value` forms", () => {
    expect(
      parseInitArgs(["--name", "demo", "--owner=Acme", "--description", "A thing", "--force"]),
    ).toEqual({ force: true, name: "demo", owner: "Acme", description: "A thing", errors: [] })
  })
  it("defaults to no force and no values", () => {
    expect(parseInitArgs([])).toEqual({ force: false, errors: [] })
  })
  it("reports an unknown argument, including a bare word and an unknown flag", () => {
    expect(parseInitArgs(["--bogus", "word"]).errors).toEqual([
      'Unknown argument "--bogus".',
      'Unknown argument "word".',
    ])
    expect(parseInitArgs(["--force=1"]).errors).toEqual(['Unknown argument "--force=1".'])
  })
  it("reports a missing value (end of args, next flag, or empty)", () => {
    expect(parseInitArgs(["--name"]).errors).toEqual(["--name needs a value."])
    expect(parseInitArgs(["--name", "--force"]).errors).toEqual(["--name needs a value."])
    expect(parseInitArgs(["--owner="]).errors).toEqual(["--owner needs a value."])
  })
  it("accepts an inline value that starts with dashes and consumes only one following value", () => {
    const parsed = parseInitArgs(["--description=--odd", "--name", "demo"])
    expect(parsed.description).toBe("--odd")
    expect(parsed.name).toBe("demo")
    expect(parsed.errors).toEqual([])
  })
})

describe("validatePackageName()", () => {
  it("accepts plain, scoped and punctuated names", () => {
    for (const ok of ["demo", "@acme/demo", "a.b_c-d~e", "x"]) {
      expect(validatePackageName(ok)).toBeUndefined()
    }
  })
  it("rejects uppercase, spaces, leading dots/underscores and bad scopes", () => {
    for (const bad of ["Demo", "de mo", ".demo", "_demo", "@/x", "@acme/", "@acme/Demo", ""]) {
      expect(validatePackageName(bad)).toContain("is not a valid npm package name")
    }
  })
  it("rejects names longer than 214 characters", () => {
    expect(validatePackageName("a".repeat(215))).toBe(
      "A package name must be 214 characters or fewer.",
    )
    expect(validatePackageName("a".repeat(214))).toBeUndefined()
  })
})

const SHA = "8a0b0cf0000000000000000000000000000000ab"

describe("shaFromLockfile()", () => {
  const lock = (resolved: unknown) =>
    JSON.stringify({ packages: { "node_modules/internal-package-contract": { resolved } } })

  it("reads the commit a git dependency resolved to", () => {
    expect(
      shaFromLockfile(
        lock(`git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`),
      ),
    ).toBe(SHA)
  })

  it("is undefined without a lockfile, an entry, a pinned commit, or valid JSON", () => {
    expect(shaFromLockfile(undefined)).toBeUndefined()
    expect(shaFromLockfile("not json")).toBeUndefined()
    expect(shaFromLockfile("{}")).toBeUndefined()
    expect(shaFromLockfile(lock("https://registry.npmjs.org/x/-/x-1.0.0.tgz"))).toBeUndefined()
    expect(shaFromLockfile(lock(42))).toBeUndefined()
    expect(shaFromLockfile(lock("git+ssh://x.git#main"))).toBeUndefined()
  })
})

describe("buildPinVars()", () => {
  it("names the release tag and carries the commit, or an empty one when unknown", () => {
    expect(buildPinVars({ version: "0.8.1", sha: SHA })).toEqual({ ipcRef: "v0.8.1", ipcSha: SHA })
    expect(buildPinVars({ version: "0.8.1", sha: undefined })).toEqual({
      ipcRef: "v0.8.1",
      ipcSha: "",
    })
  })
})

describe("buildVars() / render() / renderJson()", () => {
  it("derives repo from a scoped name and defaults the description and year", () => {
    expect(buildVars({ name: "@acme/demo", owner: "Acme", year: 2030 })).toEqual({
      name: "@acme/demo",
      repo: "demo",
      owner: "Acme",
      description: "TODO: describe @acme/demo.",
      year: "2030",
      ipcRef: "main",
      ipcSha: "",
    })
    expect(buildVars({ name: "demo", owner: "Acme", description: "D", year: 1 }).repo).toBe("demo")
    expect(buildVars({ name: "demo", owner: "o" }).year).toBe(String(new Date().getFullYear()))
  })
  const vars = buildVars({ name: "@acme/demo", owner: "Acme", description: "D", year: 2030 })
  it("replaces every known placeholder, every occurrence, and nothing else", () => {
    expect(render("{{name}} {{repo}} {{owner}} {{description}} {{year}} {{name}}", vars)).toBe(
      "@acme/demo demo Acme D 2030 @acme/demo",
    )
    expect(render("${{ secrets.X }} {{unknown}} {{ name }}", vars)).toBe(
      "${{ secrets.X }} {{unknown}} {{ name }}",
    )
  })
  it("renders JSON string values only, escaping safely, at any depth", () => {
    const text = JSON.stringify({
      a: "{{description}}",
      b: ["{{name}}", 3, null, true],
      c: { d: "{{repo}}" },
    })
    const out = renderJson(text, { ...vars, description: 'has "quotes" and \\ slash' })
    expect(JSON.parse(out)).toEqual({
      a: 'has "quotes" and \\ slash',
      b: ["@acme/demo", 3, null, true],
      c: { d: "demo" },
    })
    expect(out.endsWith("}\n")).toBe(true)
  })
})

describe("listTemplateFiles()", () => {
  it("lists nested files as sorted posix paths", () => {
    const files = listTemplateFiles(packageTemplate)
    expect(files).toEqual([...files].sort())
    expect(files).toContain("package.json")
    expect(files).toContain(".github/workflows/sync-internal-package-contract.yml")
    expect(files.every((file) => !file.includes("\\"))).toBe(true)
  })
})

// Each test spawns the real CLI and copies the whole package template; a Windows runner needs well over
// the default 20 s for that, so these get a generous limit instead of flaking.
describe("internal-package-contract init (real run)", { timeout: 120_000 }, () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "ipc-init-"))
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  const init = (...args: string[]) =>
    spawnSync(process.execPath, [initScript, ...args], { cwd, encoding: "utf8" })

  function allFiles(dir = cwd): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? allFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    )
  }

  it("scaffolds a complete package with every placeholder replaced", () => {
    const run = init("--name", "@acme/demo-pkg", "--owner", "Acme", "--description", "Does a thing")
    expect(run.status).toBe(0)
    for (const rel of listTemplateFiles(packageTemplate)) {
      expect(existsSync(path.join(cwd, rel)), rel).toBe(true)
    }
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"))
    expect(pkg).toMatchObject({
      name: "@acme/demo-pkg",
      description: "Does a thing",
      repository: { url: "git+https://github.com/Acme/demo-pkg.git" },
      scripts: { contract: "internal-package-contract" },
    })
    expect(readFileSync(path.join(cwd, "LICENSE"), "utf8")).toContain(
      `Copyright (c) ${String(new Date().getFullYear())} Acme`,
    )
    expect(readFileSync(path.join(cwd, "src/index.ts"), "utf8")).toContain(
      'return "@acme/demo-pkg"',
    )
    for (const file of allFiles()) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /\{\{(name|repo|owner|description|year)\}\}/,
      )
    }
  })

  it("scaffolds a documented benchmark suite, its guides and its scripts", () => {
    init("--name", "demo")
    for (const file of [
      "suite.mjs",
      "benchmark.config.json",
      "README.md",
      "WRITING-BENCHMARKS.md",
      "READING-BENCHMARKS.md",
    ]) {
      expect(existsSync(path.join(cwd, "benchmarks", file)), file).toBe(true)
    }
    const scripts = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).scripts
    expect(scripts.benchmark).toContain("scripts/benchmark/run-suite.mjs benchmarks/suite.mjs")
    expect(scripts["benchmark:check"]).toContain("--check")
    expect(readFileSync(path.join(cwd, "benchmarks/suite.mjs"), "utf8")).toContain('name: "demo"')
  })

  it("never ships minification or URL-bearing build config by default", () => {
    init("--name", "demo")
    const tsup = readFileSync(path.join(cwd, "tsup.config.ts"), "utf8")
    expect(tsup).not.toMatch(/minify\w*\s*[:=]\s*(?!false)\S*true/)
    expect(
      JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).scripts,
    ).not.toHaveProperty("prepare")
  })

  it("is non-destructive: an existing file is kept and reported, --force overwrites it", () => {
    writeFileSync(path.join(cwd, "README.md"), "mine\n")
    const first = init("--name", "demo")
    expect(first.stdout).toContain("README.md (exists)")
    expect(readFileSync(path.join(cwd, "README.md"), "utf8")).toBe("mine\n")
    const forced = init("--name", "demo", "--force")
    expect(forced.stdout).toContain("+ README.md")
    expect(readFileSync(path.join(cwd, "README.md"), "utf8")).toContain("# demo")
  })

  it("without --name it scaffolds hygiene files only, not a package", () => {
    const run = init()
    expect(run.status).toBe(0)
    expect(existsSync(path.join(cwd, ".gitignore"))).toBe(true)
    for (const guide of ["README.md", "WRITING-BENCHMARKS.md", "READING-BENCHMARKS.md"]) {
      expect(existsSync(path.join(cwd, "benchmarks", guide)), guide).toBe(true)
    }
    expect(existsSync(path.join(cwd, "benchmarks", "suite.mjs"))).toBe(false)
    expect(existsSync(path.join(cwd, "src"))).toBe(false)
    expect(existsSync(path.join(cwd, "tsup.config.ts"))).toBe(false)
  })

  it("pins the scaffolded workflows to the commit its lockfile resolved, never to a branch", () => {
    writeFileSync(
      path.join(cwd, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/internal-package-contract": {
            resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`,
          },
        },
      }),
    )
    expect(init("--name", "demo").status).toBe(0)
    const release = readFileSync(path.join(cwd, ".github/workflows/release.yml"), "utf8")
    expect(release).toMatch(new RegExp(`release-npm-changesets\\.yml@${SHA} # v\\d+\\.\\d+\\.\\d+`))
    expect(release).not.toContain("@main")
    const sync = readFileSync(
      path.join(cwd, ".github/workflows/sync-internal-package-contract.yml"),
      "utf8",
    )
    expect(sync).toContain(`dependency-pin-sync.yml@${SHA} # v`)
    const dep = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).devDependencies[
      "internal-package-contract"
    ]
    expect(dep).toMatch(/^github:MaverickCER\/internal-package-contract#v\d+\.\d+\.\d+$/)
  })

  it("scaffolds Dependabot for npm and for GitHub Actions, leaving the contract pin to the sync workflow", () => {
    expect(init("--name", "demo").status).toBe(0)
    const dependabot = readFileSync(path.join(cwd, ".github/dependabot.yml"), "utf8")
    expect(dependabot).toContain("package-ecosystem: npm")
    expect(dependabot).toContain("package-ecosystem: github-actions")
    expect(dependabot).toContain('dependency-name: "internal-package-contract"')
  })

  it("proves the declared Node floor in the scaffolded workflow, not just the newest Node", () => {
    expect(init("--name", "demo").status).toBe(0)
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      engines: { node: string }
    }
    const floor = /(\d+)/.exec(pkg.engines.node)?.[1]
    const workflow = readFileSync(path.join(cwd, ".github/workflows/contract.yml"), "utf8")
    expect(workflow).toContain(`node-version: ${String(floor)}.x`)
  })

  it("exits 1 with the problem and usage for a bad name or unknown argument", () => {
    const badName = init("--name", "Bad Name")
    expect(badName.status).toBe(1)
    expect(badName.stderr).toContain("is not a valid npm package name")
    expect(badName.stderr).toContain("Usage: internal-package-contract init")
    const unknown = init("--nope")
    expect(unknown.status).toBe(1)
    expect(unknown.stderr).toContain('Unknown argument "--nope".')
    expect(existsSync(path.join(cwd, ".gitignore"))).toBe(false)
  })
})
