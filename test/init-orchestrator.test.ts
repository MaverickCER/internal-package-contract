import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { run } from "../scripts/init/existing.mjs"
import { run as setup } from "../scripts/init/run.mjs"

const packageRoot = path.resolve(import.meta.dirname, "..")
const SHA = "b".repeat(40)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-adopt-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const read = (rel: string): string => readFileSync(path.join(dir, rel), "utf8")
const pkg = (over: Record<string, unknown> = {}) =>
  write(
    "package.json",
    JSON.stringify(
      {
        name: "@acme/widgets",
        version: "1.4.0",
        description: "Widgets",
        exports: {
          ".": "./dist/index.js",
          "./build": "./dist/build.js",
          "./package.json": "./package.json",
        },
        scripts: { test: "vitest" },
        ...over,
      },
      null,
      2,
    ),
  )
const lock = () =>
  write(
    "package-lock.json",
    JSON.stringify({
      packages: {
        "node_modules/internal-package-contract": {
          resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`,
        },
      },
    }),
  )

interface Options {
  dirty?: string
  remote?: string
  tag?: string
  failOn?: string
}
const harness = ({
  dirty = "",
  remote = "git@github.com:Acme/widgets.git\n",
  tag = "refs/tags/v0.12.0",
  failOn,
}: Options = {}) => {
  const out: string[] = []
  const err: string[] = []
  const calls: string[][] = []
  return {
    out,
    err,
    calls,
    io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) },
    hooks: {
      packageRoot,
      spawn: (command: string, args: string[], cwd: string) => {
        calls.push([command, ...args])
        expect(cwd).toBe(dir)
        // The install is what puts the lockfile's pin in place; the fake does it.
        if (command === "npm") lock()
        return failOn !== undefined && args.join(" ").includes(failOn) ? 1 : 0
      },
      capture: (_command: string, args: string[]) => {
        if (args[0] === "remote") return { status: remote === "" ? 1 : 0, stdout: remote }
        if (args[0] === "ls-remote") return { status: 0, stdout: tag === "" ? "" : `abc\t${tag}\n` }
        if (args[0] === "status") return { status: 0, stdout: dirty }
        return { status: 1, stdout: "" }
      },
    },
  }
}
const bin = (file: string) => `node_modules/internal-package-contract/bin/${file}`

describe("init in an existing package: refusals", () => {
  it("explains a bad argument, with the usage", () => {
    const h = harness()
    expect(run(["--nope"], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toContain("unknown argument: --nope")
    expect(run(["--tag"], dir, h.io, h.hooks)).toBe(2)
    expect(run(["--tag", "main"], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toContain("main is not a release tag such as v0.12.0.")
    expect(h.err.join("")).toContain("Usage: internal-package-contract init")
    expect(run(["--owner", "--dry-run"], dir, h.io, h.hooks)).toBe(2)
  })
  it("needs a package.json that is JSON and has a name", () => {
    const h = harness()
    expect(run([], dir, h.io, h.hooks)).toBe(1)
    expect(h.err.join("")).toContain("there is no package.json here")
    write("package.json", "{ nope")
    expect(run([], dir, h.io, h.hooks)).toBe(1)
    expect(h.err.join("")).toContain("package.json is not valid JSON.")
    write("package.json", "{}")
    expect(run([], dir, h.io, h.hooks)).toBe(1)
    expect(h.err.join("")).toContain("package.json has no name.")
    expect(h.calls).toEqual([])
  })
  it("finishes the setup of a package that already uses the standard, without moving its pin or starting adoption mode", () => {
    for (const where of ["devDependencies", "dependencies"]) {
      const spec = "github:MaverickCER/internal-package-contract#v0.9.0"
      pkg({ [where]: { "internal-package-contract": spec } })
      const h = harness({ tag: "" })
      expect(run([], dir, h.io, h.hooks)).toBe(0)
      const manifest = JSON.parse(read("package.json"))
      expect((manifest.devDependencies ?? {})["internal-package-contract"]).toBe(
        where === "devDependencies" ? spec : undefined,
      )
      expect(existsSync(path.join(dir, ".repo-contract/adoption.json"))).toBe(false)
      expect(h.out.join("")).toContain(
        `[init] @acme/widgets, owned by Acme:\n  - keep internal-package-contract where it is (${spec}) and add whatever is missing`,
      )
      expect(h.calls[0]).toEqual(["npm", "install", "--ignore-scripts"])
      rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    }
  })
  it("needs to know the owner, and a release to pin", () => {
    pkg()
    const noOwner = harness({ remote: "" })
    expect(run([], dir, noOwner.io, noOwner.hooks)).toBe(1)
    expect(noOwner.err.join("")).toContain("cannot tell who owns the repository")
    const noTag = harness({ tag: "" })
    expect(run([], dir, noTag.io, noTag.hooks)).toBe(1)
    expect(noTag.err.join("")).toContain(
      "could not find a release of MaverickCER/internal-package-contract. Pass --tag vX.Y.Z.",
    )
    const badTag = harness({ tag: "refs/tags/latest" })
    expect(run([], dir, badTag.io, badTag.hooks)).toBe(1)
  })
  it("refuses to start over uncommitted changes, naming them", () => {
    pkg()
    const h = harness({ dirty: " M src/a.ts\n?? notes.md\n" })
    expect(run([], dir, h.io, h.hooks)).toBe(1)
    expect(h.err.join("")).toBe(
      "[init] commit or stash these first, so the adoption is a diff you can review and undo:\n- src/a.ts\n- notes.md\n",
    )
    expect(h.calls).toEqual([])
  })
})

describe("init in an existing package: --spec", () => {
  it("pins the dependency to exactly what it names, without looking for a release", () => {
    pkg()
    const h = harness({ tag: "" })
    expect(run(["--spec", "file:/work/ipc"], dir, h.io, h.hooks)).toBe(0)
    expect(JSON.parse(read("package.json")).devDependencies["internal-package-contract"]).toBe(
      "file:/work/ipc",
    )
    expect(h.out.join("")).toContain("to internal-package-contract file:/work/ipc:")
  })
  it("cannot be combined with --tag", () => {
    const h = harness()
    expect(run(["--spec", "x", "--tag", "v1.0.0"], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toContain("--tag and --spec cannot be combined.")
  })
  it("is passed on by setup", () => {
    pkg()
    const h = harness({ tag: "" })
    expect(setup(["--spec", "file:/x", "--dry-run"], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toContain("file:/x")
  })
})

describe("init in an existing package: repository settings", () => {
  it("leaves them alone unless asked, and lets init apply them with --github", () => {
    pkg()
    const off = harness()
    run([], dir, off.io, off.hooks)
    expect(off.calls.find((call) => call[1]?.endsWith("scaffold.mjs"))).toEqual([
      "node",
      bin("scaffold.mjs"),
      "--no-github",
    ])
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    pkg()
    const on = harness()
    run(["--github"], dir, on.io, on.hooks)
    expect(on.calls.find((call) => call[1]?.endsWith("scaffold.mjs"))).toEqual([
      "node",
      bin("scaffold.mjs"),
    ])
  })
  it("is passed on by setup, for an existing package and for a new one", () => {
    pkg()
    const existing = harness()
    setup(["--github"], dir, existing.io, existing.hooks)
    expect(existing.calls.find((call) => call[1]?.endsWith("scaffold.mjs"))).toEqual([
      "node",
      bin("scaffold.mjs"),
    ])
    rmSync(path.join(dir, "package.json"))
    const fresh = harness()
    setup(["--name", "n", "--github"], dir, fresh.io, fresh.hooks)
    expect(fresh.calls.some((call) => call.includes("--no-github"))).toBe(false)
  })
  it("carries on when the managed-file step cannot write a file yet, and says so", () => {
    pkg()
    const h = harness({ failOn: "sync --apply" })
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toContain(
      '"write the managed files the package lacks" did not finish; `doctor` at the end says what is left.',
    )
  })
})

describe("init in an existing package: comprehensive", () => {
  it("adds the scripts, tools and overrides the standard's checks need, and none the package has", () => {
    pkg({ scripts: { test: "mine", build: "mine-build" }, devDependencies: { vitest: "^1.0.0" } })
    const h = harness()
    run([], dir, h.io, h.hooks)
    const manifest = JSON.parse(read("package.json"))
    expect(manifest.scripts.test).toBe("mine")
    expect(manifest.scripts.build).toBe("mine-build")
    expect(manifest.scripts.typecheck).toBeDefined()
    expect(manifest.scripts["test:coverage"]).toBeDefined()
    expect(manifest.devDependencies.vitest).toBe("^1.0.0")
    expect(manifest.devDependencies.prettier).toBeDefined()
    expect(manifest.devDependencies["internal-package-contract"]).toBe(
      "github:MaverickCER/internal-package-contract#v0.12.0",
    )
    expect(manifest.overrides).toBeDefined()
    expect(h.out.join("")).toMatch(
      /\[init\] added to package\.json: \d+ scripts, \d+ devDependencies, \d+ overrides/,
    )
  })
  it("adds every config, document and template the package lacks, and none it has", () => {
    pkg()
    write("tsconfig.json", '{"mine":true}')
    write("knip.json", '{"mine":true}')
    const h = harness()
    run([], dir, h.io, h.hooks)
    for (const file of [
      "eslint.config.js",
      "prettier.config.mjs",
      "tsconfig.build.json",
      "tsup.config.ts",
      "typedoc.json",
      "typedoc.markdown.json",
      "stryker.config.mjs",
      "vitest.config.ts",
      "scripts/emit-dts-shims.mjs",
      ".markdownlint-cli2.jsonc",
      ".prettierignore",
      ".npmrc",
      "ADOPTION.md",
      "CODE_REVIEW.md",
      "VERSIONING.md",
      "LICENSE",
      ".github/pull_request_template.md",
      ".github/ISSUE_TEMPLATE/bug_report.yml",
    ]) {
      expect(existsSync(path.join(dir, file)), file).toBe(true)
    }
    expect(read("tsconfig.json")).toBe('{"mine":true}')
    expect(read("knip.json")).toBe('{"mine":true}')
    expect(read("LICENSE")).toContain(`Copyright (c) ${String(new Date().getFullYear())} Acme`)
  })
  it("never adds the package's own source, tests, benchmark suite or API report", () => {
    pkg()
    const h = harness()
    run([], dir, h.io, h.hooks)
    for (const file of [
      "src/index.ts",
      "test/index.test.ts",
      "benchmarks/suite.mjs",
      "docs/api-report/README.md",
    ]) {
      expect(existsSync(path.join(dir, file)), file).toBe(false)
    }
  })
})

describe("init in an existing package: adoption mode", () => {
  it("starts every package in adoption mode, with nothing enforced and ninety days to go", () => {
    pkg()
    const h = harness()
    run([], dir, h.io, h.hooks)
    const adoption = JSON.parse(read(".repo-contract/adoption.json"))
    expect(adoption.version).toBe(1)
    expect(adoption.enforce).toEqual([])
    const days = (Date.parse(adoption.expiresAt) - Date.parse(adoption.startedAt)) / 86_400_000
    expect(days).toBe(90)
    expect(h.out.join("")).toContain(
      "adoption mode: failures are reported but do not fail the run until you promote the check",
    )
  })
  it("--strict skips it, and an adoption file the package has is kept", () => {
    pkg()
    run(["--strict"], dir, harness().io, harness().hooks)
    expect(existsSync(path.join(dir, ".repo-contract/adoption.json"))).toBe(false)
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    write(
      ".repo-contract/adoption.json",
      '{"version":1,"startedAt":"2026-01-01","expiresAt":"2026-02-01","enforce":["Lint"]}',
    )
    write("package.json", JSON.stringify({ name: "@acme/widgets", exports: {} }))
    run([], dir, harness().io, harness().hooks)
    expect(JSON.parse(read(".repo-contract/adoption.json")).enforce).toEqual(["Lint"])
  })
  it("is passed on by setup", () => {
    pkg()
    setup(["--strict"], dir, harness().io, harness().hooks)
    expect(existsSync(path.join(dir, ".repo-contract/adoption.json"))).toBe(false)
  })
})

describe("init in an existing package: --docs", () => {
  it("replaces a shared document that differs with the standard's, and enrols it", () => {
    pkg()
    write("SUPPORT.md", "my own support text\n")
    const h = harness()
    expect(run(["--docs"], dir, h.io, h.hooks)).toBe(0)
    expect(read("SUPPORT.md")).toContain("Thank you for using `@acme/widgets`.")
    expect(read("SUPPORT.md").startsWith("<!-- Managed by internal-package-contract.")).toBe(true)
    expect(JSON.parse(read("package.json"))["internal-package-contract"].copies).toEqual([
      "code-of-conduct",
      "releasing",
      "support",
      "typedoc-markdown",
    ])
    expect(h.out.join("")).toContain("SUPPORT.md (replaced with the standard's)")
    expect(h.out.join("")).not.toContain("differs from the standard's")
  })
  it("is passed on by setup", () => {
    pkg()
    const h = harness()
    setup(["--docs"], dir, h.io, h.hooks)
    expect(read("RELEASING.md").startsWith("<!-- Managed by")).toBe(true)
  })
})

describe("init in an existing package: a dry run", () => {
  it("prints the plan and changes nothing", () => {
    pkg()
    const before = read("package.json")
    const h = harness()
    expect(run(["--dry-run"], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toContain(
      "@acme/widgets, owned by Acme, to internal-package-contract v0.12.0:",
    )
    expect(h.out.join("")).toContain("and its repository")
    expect(h.out.join("")).toContain("dry run: nothing was changed.")
    expect(h.calls).toEqual([])
    expect(read("package.json")).toBe(before)
  })
})

describe("init in an existing package: the run", () => {
  it("adds the pin, the script and the repository, keeping the file's own indentation", () => {
    write(
      "package.json",
      JSON.stringify({ name: "demo", version: "1.0.0", scripts: { test: "t" } }, null, "\t"),
    )
    const h = harness()
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    const text = read("package.json")
    expect(text.startsWith('{\n\t"name"')).toBe(true)
    const manifest = JSON.parse(text)
    expect(manifest.devDependencies["internal-package-contract"]).toBe(
      "github:MaverickCER/internal-package-contract#v0.12.0",
    )
    expect(manifest.scripts.test).toBe("t")
    expect(manifest.scripts.contract).toBe("internal-package-contract")
    expect(manifest.repository).toEqual({
      type: "git",
      url: "git+https://github.com/Acme/demo.git",
    })
  })
  it("keeps a repository the package has, and prefers --owner over the remote", () => {
    pkg({ repository: { type: "git", url: "git+https://github.com/Corp/widgets.git" } })
    const h = harness()
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(JSON.parse(read("package.json")).repository.url).toBe(
      "git+https://github.com/Corp/widgets.git",
    )
    expect(h.out.join("")).toContain("owned by Corp")
    rmSync(path.join(dir, ".github"), { recursive: true, force: true })
    pkg()
    const flagged = harness()
    run(["--owner", "Other"], dir, flagged.io, flagged.hooks)
    expect(flagged.out.join("")).toContain("owned by Other")
  })
  it("installs, scaffolds, syncs, generates, and ends with doctor, in that order", () => {
    pkg()
    const h = harness()
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(h.calls).toEqual([
      ["npm", "install", "--ignore-scripts"],
      ["node", bin("scaffold.mjs"), "--no-github"],
      ["node", bin("contract.mjs"), "sync", "--apply"],
      ["node", bin("contract.mjs"), "generate"],
      ["node", bin("contract.mjs"), "env"],
      ["node", bin("contract.mjs"), "doctor"],
    ])
    expect(h.out.join("")).toContain("[init] done. Review the changes, then run `npm run contract`")
  })
  it("writes the shared documents the package lacks, enrols them, and names one that differs", () => {
    pkg()
    write("SUPPORT.md", "my own support text\n")
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(read("RELEASING.md")).toContain("# Releasing @acme/widgets")
    expect(read("RELEASING.md").startsWith("<!-- Managed by internal-package-contract.")).toBe(true)
    expect(read("CODE_OF_CONDUCT.md")).toContain(
      "https://github.com/acme/widgets/security/advisories/new",
    )
    expect(read("SUPPORT.md")).toBe("my own support text\n")
    expect(JSON.parse(read("package.json"))["internal-package-contract"].copies).toEqual([
      "code-of-conduct",
      "releasing",
      "typedoc-markdown",
    ])
    expect(h.out.join("")).toContain(
      "[init] SUPPORT.md differs from the standard's, so it was left as it is. `internal-package-contract sync --add support` adopts the standard's.",
    )
  })
  it("enrols a document that already is the standard's, and none of the documents when every one differs", () => {
    pkg()
    const first = harness()
    run([], dir, first.io, first.hooks)
    const manifest = JSON.parse(read("package.json"))
    expect(manifest["internal-package-contract"].copies).toHaveLength(4)
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    write(
      "package.json",
      JSON.stringify({ ...manifest, devDependencies: {}, "internal-package-contract": undefined }),
    )
    const again = harness()
    run([], dir, again.io, again.hooks)
    expect(JSON.parse(read("package.json"))["internal-package-contract"].copies).toHaveLength(4)
    expect(again.out.join("")).not.toContain("differs from the standard's")
    for (const file of ["CODE_OF_CONDUCT.md", "SUPPORT.md", "RELEASING.md"]) write(file, "own\n")
    write(
      "package.json",
      JSON.stringify({
        ...JSON.parse(read("package.json")),
        devDependencies: {},
        "internal-package-contract": undefined,
      }),
    )
    const none = harness()
    run([], dir, none.io, none.hooks)
    expect(JSON.parse(read("package.json"))["internal-package-contract"].copies).toEqual([
      "typedoc-markdown",
    ])
  })
  it("enrols a shared file the package carries unchanged, keeps the copies it listed, and leaves a changed one alone", () => {
    pkg()
    write(
      "package.json",
      JSON.stringify({
        ...JSON.parse(read("package.json")),
        "internal-package-contract": { copies: ["glob"], other: 1 },
      }),
    )
    write(".editorconfig", "root = true\n# mine\n")
    mkdirSync(path.join(dir, "benchmarks"), { recursive: true })
    write(
      "benchmarks/budgets.mjs",
      readFileSync(path.join(packageRoot, "template/package/benchmarks/budgets.mjs"), "utf8"),
    )
    const h = harness()
    run([], dir, h.io, h.hooks)
    const own = JSON.parse(read("package.json"))["internal-package-contract"]
    expect(own.other).toBe(1)
    expect(own.copies).toEqual([
      "benchmark-budgets",
      "code-of-conduct",
      "glob",
      "releasing",
      "support",
      "typedoc-markdown",
    ])
    expect(read(".editorconfig")).toBe("root = true\n# mine\n")
  })
  it("lists nothing when the package has no shared file or document in the standard's text", () => {
    pkg()
    for (const file of ["CODE_OF_CONDUCT.md", "SUPPORT.md", "RELEASING.md"]) write(file, "own\n")
    write(".editorconfig", "own\n")
    write("typedoc.markdown.json", "{}\n")
    // The standard's template text, unrendered and without its header, is not a managed document.
    write(
      "CODE_OF_CONDUCT.md",
      readFileSync(path.join(packageRoot, "template/package/CODE_OF_CONDUCT.md"), "utf8"),
    )
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(JSON.parse(read("package.json"))["internal-package-contract"]).toBeUndefined()
  })
  it("drafts docs/surface.json from the exports, and gives AGENTS.md its API map", () => {
    pkg()
    mkdirSync(path.join(dir, "src", "build"), { recursive: true })
    const h = harness()
    run([], dir, h.io, h.hooks)
    const surface = JSON.parse(read("docs/surface.json"))
    expect(Object.keys(surface.entries)).toEqual([".", "./build"])
    expect(surface.entries["./build"].source).toBe("src/build/")
    expect(surface.entries["."].tier).toBe("Stable")
    expect(read("AGENTS.md")).toContain("<!-- ipc:begin entry-points -->")
    expect(read("AGENTS.md")).toContain("Rules for AI coding agents working in `@acme/widgets`")
  })
  it("adds the API map to an AGENTS.md the package has, without touching the rest, and only once", () => {
    pkg()
    write("AGENTS.md", "# Mine\n\nrules\n")
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(read("AGENTS.md")).toBe(
      "# Mine\n\nrules\n\n## Public API map\n\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n",
    )
    const text = read("AGENTS.md")
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    write("package.json", JSON.stringify({ name: "@acme/widgets", exports: {} }))
    const again = harness()
    run([], dir, again.io, again.hooks)
    expect(read("AGENTS.md")).toBe(text)
  })
  it("keeps what a hand-written API map says, seeding the surface from it and generating the table", () => {
    pkg()
    write(
      "AGENTS.md",
      "# Mine\n\n## Public API map\n\n| Export | Source | Environment | Purpose |\n| --- | --- | --- | --- |\n| `@acme/widgets` | `src/core/` | isomorphic | the runtime |\n| `@acme/widgets/build` | `src/build/` | Node-only | tooling |\n\nafter\n",
    )
    const h = harness()
    run([], dir, h.io, h.hooks)
    const surface = JSON.parse(read("docs/surface.json"))
    expect(surface.entries["."]).toMatchObject({
      source: "src/core/",
      environment: "isomorphic",
      purpose: "the runtime",
    })
    expect(surface.entries["./build"]).toMatchObject({
      source: "src/build/",
      environment: "Node-only",
      purpose: "tooling",
    })
    expect(read("AGENTS.md")).toBe(
      "# Mine\n\n## Public API map\n\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n\nafter\n",
    )
    expect(h.out.join("")).toContain(
      "AGENTS.md (its API table is now generated; 2 row(s) seeded docs/surface.json)",
    )
  })
  it("leaves a hand-written table alone when the package already has a surface source or a region", () => {
    pkg()
    const table = "| Export | Purpose |\n| --- | --- |\n| `@acme/widgets` | x |\n"
    write("AGENTS.md", `# Mine\n\n${table}`)
    write("docs/surface.json", '{"entries":{}}')
    run([], dir, harness().io, harness().hooks)
    expect(read("AGENTS.md")).toContain(table)
    rmSync(path.join(dir, "docs"), { recursive: true })
    write(
      "AGENTS.md",
      `# Mine\n\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n\n${table}`,
    )
    run([], dir, harness().io, harness().hooks)
    expect(read("AGENTS.md")).toContain(table)
  })
  it("regenerates the landing page of a package that has one, and only then", () => {
    pkg()
    write("docs/site.json", "{}")
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(h.calls).toContainEqual(["node", bin("contract.mjs"), "site"])
    rmSync(path.join(dir, "docs"), { recursive: true })
    const none = harness()
    run([], dir, none.io, none.hooks)
    expect(none.calls.some((call) => call.includes("site"))).toBe(false)
  })
  it("keeps a docs/surface.json the package has", () => {
    pkg()
    write("docs/surface.json", '{"entries":{}}')
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(read("docs/surface.json")).toBe('{"entries":{}}')
  })
  it("stops at the first step that fails, and says how to undo the run", () => {
    pkg()
    for (const failOn of ["install", "scaffold.mjs", "generate"]) {
      const h = harness({ failOn })
      expect(run([], dir, h.io, h.hooks)).toBe(1)
      expect(h.err.join("")).toContain("stopped:")
      expect(h.err.join("")).toContain("git restore .")
      rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
      pkg()
    }
  })
})

describe("init in a new directory", () => {
  it("adopts a package that is here, passing its options on", () => {
    pkg()
    const h = harness()
    expect(setup(["--owner", "Other", "--tag", "v0.12.0", "--dry-run"], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toContain("owned by Other, to internal-package-contract v0.12.0")
    expect(h.out.join("")).toContain("dry run")
  })
  it("will not describe a new package where one already is", () => {
    pkg()
    const h = harness()
    expect(setup(["--name", "x"], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toContain("only for a new package")
  })
  it("needs a name to start a new package, and understands only its own options", () => {
    const h = harness()
    expect(setup([], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toContain("there is no package.json here")
    expect(setup(["--nope"], dir, h.io, h.hooks)).toBe(2)
    expect(setup(["--name"], dir, h.io, h.hooks)).toBe(2)
    expect(setup(["--name", ""], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toContain("--name needs a value.")
  })
  it("scaffolds, installs, scaffolds again with the pin, generates and ends with doctor", () => {
    const h = harness()
    expect(
      setup(
        ["--name", "@acme/new", "--owner", "Acme", "--description", "A thing"],
        dir,
        h.io,
        h.hooks,
      ),
    ).toBe(0)
    const init = [
      "--name",
      "@acme/new",
      "--owner",
      "Acme",
      "--description",
      "A thing",
      "--no-github",
    ]
    expect(h.calls).toEqual([
      ["git", "init", "-q"],
      ["node", path.join(packageRoot, "bin", "scaffold.mjs"), ...init],
      ["npm", "install", "--ignore-scripts"],
      ["node", bin("scaffold.mjs"), ...init],
      ["node", bin("contract.mjs"), "generate"],
      ["node", bin("contract.mjs"), "env"],
      ["node", bin("contract.mjs"), "doctor"],
    ])
    expect(h.out.join("")).toContain("[init] done.")
  })
  it("does not start a second repository, and omits the options it was not given", () => {
    mkdirSync(path.join(dir, ".git"))
    const h = harness()
    setup(["--name", "new"], dir, h.io, h.hooks)
    expect(h.calls[0]).toEqual([
      "node",
      path.join(packageRoot, "bin", "scaffold.mjs"),
      "--name",
      "new",
      "--no-github",
    ])
    expect(h.calls.some((call) => call[0] === "git")).toBe(false)
  })
  it("stops at the first step that fails", () => {
    const h = harness({ failOn: "install" })
    expect(setup(["--name", "new"], dir, h.io, h.hooks)).toBe(1)
    expect(h.err.join("")).toBe('[init] stopped: "install" failed.\n')
    expect(h.calls.at(-1)).toEqual(["npm", "install", "--ignore-scripts"])
  })
  it("says what it would do on a dry run, and does nothing", () => {
    const h = harness()
    expect(setup(["--name", "new", "--dry-run"], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toContain("would scaffold new here")
    expect(h.calls).toEqual([])
  })

  it("with no flags, passes on none of them: no repository settings, no replaced documents, adoption mode on", () => {
    pkg()
    write("SUPPORT.md", "my own support text\n")
    const h = harness()
    expect(setup([], dir, h.io, h.hooks)).toBe(0)
    expect(h.calls.find((call) => call[1]?.endsWith("scaffold.mjs"))).toEqual([
      "node",
      bin("scaffold.mjs"),
      "--no-github",
    ])
    expect(read("SUPPORT.md")).toBe("my own support text\n")
    expect(existsSync(path.join(dir, ".repo-contract/adoption.json"))).toBe(true)
  })
  it("passes --docs and --strict on, and takes them as options and not as unknown arguments", () => {
    pkg()
    write("SUPPORT.md", "my own support text\n")
    const h = harness()
    expect(setup(["--docs", "--strict"], dir, h.io, h.hooks)).toBe(0)
    expect(h.err.join("")).toBe("")
    expect(read("SUPPORT.md")).toContain("Thank you for using")
    expect(existsSync(path.join(dir, ".repo-contract/adoption.json"))).toBe(false)
  })
  it("says exactly which arguments it does not understand, each once, even when one follows another", () => {
    const h = harness()
    expect(setup(["--bogus", "value", "--other"], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toBe(
      "[init] unknown argument: --bogus unknown argument: value unknown argument: --other\nUsage: internal-package-contract init [--name <package>] [--owner <owner>] [--description <text>] [--tag vX.Y.Z | --spec <dependency spec>] [--github] [--docs] [--strict] [--dry-run]\n",
    )
  })
  it("says which option has no value, for every option that needs one", () => {
    for (const option of ["--name", "--owner", "--description", "--tag", "--spec"]) {
      for (const argv of [[option], [option, ""]]) {
        const h = harness()
        expect(setup(argv, dir, h.io, h.hooks)).toBe(2)
        expect(h.err.join("")).toContain(`${option} needs a value.`)
      }
    }
  })
  it("refuses --description, as well as --name, for a package that already exists", () => {
    pkg()
    const h = harness()
    expect(setup(["--description", "x"], dir, h.io, h.hooks)).toBe(2)
    expect(h.err.join("")).toBe(
      "[init] this directory already has a package.json, so it is brought under the standard as it is; --name and --description are only for a new package.\n",
    )
  })
  it("pins the release it was told to, not the latest one", () => {
    pkg()
    const h = harness()
    expect(setup(["--tag", "v0.9.0", "--dry-run"], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toContain("internal-package-contract v0.9.0")
    expect(h.out.join("")).not.toContain("v0.12.0")
  })
  it("gives a new package exactly the options it was given, and the repository settings only on request", () => {
    const h = harness()
    setup(["--name", "n", "--github"], dir, h.io, h.hooks)
    expect(h.calls[1]).toEqual([
      "node",
      path.join(packageRoot, "bin", "scaffold.mjs"),
      "--name",
      "n",
    ])
    expect(h.calls[3]).toEqual(["node", bin("scaffold.mjs"), "--name", "n"])
  })
  it("says each step before it runs it, and what it did at the end", () => {
    const h = harness()
    expect(setup(["--name", "n"], dir, h.io, h.hooks)).toBe(0)
    expect(h.out.join("")).toBe(
      [
        "[init] start a git repository",
        "[init] scaffold the package",
        "[init] install",
        "[init] scaffold what needed the pin",
        "[init] generate the API map",
        "[init] document the environment",
        "",
        "",
        "[init] done. Answer the prompts, review the files, run `npm run contract`, and make the first commit.",
        "",
      ].join("\n"),
    )
  })
  it("names the step that failed, for each step", () => {
    for (const [failOn, label] of [
      ["init -q", "start a git repository"],
      [path.join("bin", "scaffold.mjs"), "scaffold the package"],
      ["install", "install"],
      ["node_modules/internal-package-contract", "scaffold what needed the pin"],
      ["generate", "generate the API map"],
    ] as const) {
      const h = harness({ failOn })
      expect(setup(["--name", "n"], dir, h.io, h.hooks)).toBe(1)
      expect(h.err.join(""), failOn).toBe(`[init] stopped: "${label}" failed.\n`)
      rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    }
  })
  it("pins the dependency to --spec between the first scaffold and the install", () => {
    const calls: string[] = []
    const h = harness()
    const hooks = {
      ...h.hooks,
      spawn: (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "))
        if (
          args.some((arg) => arg.endsWith("scaffold.mjs")) &&
          !existsSync(path.join(dir, "package.json"))
        ) {
          write("package.json", JSON.stringify({ name: "n", devDependencies: { other: "1.0.0" } }))
        }
        return 0
      },
    }
    expect(setup(["--name", "n", "--spec", "file:/x"], dir, h.io, hooks)).toBe(0)
    expect(h.out.join("")).toContain("[init] pin internal-package-contract to file:/x\n")
    expect(JSON.parse(read("package.json")).devDependencies).toEqual({
      other: "1.0.0",
      "internal-package-contract": "file:/x",
    })
    expect(read("package.json").endsWith("}\n")).toBe(true)
    expect(calls.findIndex((call) => call.startsWith("npm install"))).toBeGreaterThan(1)
  })
  it("does not pin anything when it was not given --spec", () => {
    const h = harness()
    setup(["--name", "n"], dir, h.io, h.hooks)
    expect(h.out.join("")).not.toContain("pin internal-package-contract")
  })
})
