import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cpSync } from "node:fs"
import { render } from "../scripts/init-lib.mjs"
import { captureCommand, latestTag, run } from "../scripts/init/existing.mjs"

const packageRoot = path.resolve(import.meta.dirname, "..")
const SHA = "d".repeat(40)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-existing-exact-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const read = (rel: string): string => readFileSync(path.join(dir, rel), "utf8")
const files = (): string[] => {
  const found: string[] = []
  const walk = (relative: string): void => {
    for (const name of readdirSync(path.join(dir, relative)).sort()) {
      if (name === "node_modules") continue
      const next = relative === "" ? name : `${relative}/${name}`
      if (statSync(path.join(dir, next)).isDirectory()) walk(next)
      else found.push(next)
    }
  }
  walk("")
  return found
}
const manifest = (over: Record<string, unknown> = {}, indent: string | number = 2): void =>
  write(
    "package.json",
    `${JSON.stringify(
      {
        name: "@acme/widgets",
        version: "1.4.0",
        description: "Widgets",
        exports: { ".": "./dist/index.js", "./build": "./dist/build.js" },
        ...over,
      },
      null,
      indent,
    )}\n`,
  )
interface Options {
  remote?: string
  tags?: string
  dirty?: string
  failOn?: string
}
const harness = ({
  remote = "git@github.com:Acme/widgets.git\n",
  tags = "abc\trefs/tags/v0.12.0\ndef\trefs/tags/v0.11.0\n",
  dirty = "",
  failOn,
}: Options = {}) => {
  const out: string[] = []
  const err: string[] = []
  const calls: string[] = []
  const captured: string[] = []
  return {
    out,
    err,
    calls,
    captured,
    io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) },
    text: () => out.join(""),
    hooks: {
      packageRoot,
      spawn: (command: string, args: string[]) => {
        calls.push([command, ...args].join(" "))
        if (command === "npm") {
          write(
            "package-lock.json",
            JSON.stringify({
              packages: {
                "node_modules/internal-package-contract": { resolved: `git+ssh://x/y.git#${SHA}` },
              },
            }),
          )
        }
        return failOn !== undefined && [command, ...args].join(" ").includes(failOn) ? 1 : 0
      },
      capture: (command: string, args: string[]) => {
        captured.push([command, ...args].join(" "))
        if (args[0] === "remote") return { status: remote === "" ? 1 : 0, stdout: remote }
        if (args[0] === "ls-remote") return { status: 0, stdout: tags }
        if (args[0] === "status") return { status: 0, stdout: dirty }
        return { status: 1, stdout: "" }
      },
    },
  }
}

describe("init in an existing package: what it says", () => {
  it("lays out its plan, and stops there on a dry run", () => {
    manifest()
    const h = harness()
    expect(run(["--dry-run"], dir, h.io, h.hooks)).toBe(0)
    expect(h.text()).toMatchInlineSnapshot(`
      "[init] @acme/widgets, owned by Acme, to internal-package-contract v0.12.0:
        - add internal-package-contract (v0.12.0) and the "contract" script to package.json, and its repository
        - install, then scaffold the hygiene files, workflows, hooks and (with --github) branch protection
        - write the Scorecard workflow, the pin-sync workflow and the Changesets config the package lacks (\`init\` and \`sync\`)
        - add the configs, documents and templates the package lacks, and name any shared document it has that differs
        - start adoption mode: failing checks report their errors but only promoted ones fail the run (--strict skips this)
        - draft docs/surface.json from the exports, generate the API map and document the environment (ci/env.schema.ts)
        - report what is left (\`doctor\`)
      [init] dry run: nothing was changed.
      "
    `)
    expect(h.calls).toEqual([])
  })

  it("names the release, the owner and the repository it will add, and a spec in place of a release", () => {
    manifest()
    write("package.json", JSON.stringify({ name: "w", exports: {} }))
    const h = harness({ remote: "" })
    expect(run(["--dry-run", "--owner", "Acme", "--spec", "file:/x"], dir, h.io, h.hooks)).toBe(0)
    expect(h.text()).toMatchInlineSnapshot(`
      "[init] w, owned by Acme, to internal-package-contract file:/x:
        - add internal-package-contract (file:/x) and the "contract" script to package.json, and its repository
        - install, then scaffold the hygiene files, workflows, hooks and (with --github) branch protection
        - write the Scorecard workflow, the pin-sync workflow and the Changesets config the package lacks (\`init\` and \`sync\`)
        - add the configs, documents and templates the package lacks, and name any shared document it has that differs
        - start adoption mode: failing checks report their errors but only promoted ones fail the run (--strict skips this)
        - draft docs/surface.json from the exports, generate the API map and document the environment (ci/env.schema.ts)
        - report what is left (\`doctor\`)
      [init] dry run: nothing was changed.
      "
    `)
  })

  it("does the whole adoption, saying each step, and writes what the package lacks", () => {
    manifest({ scripts: { test: "vitest" } })
    write("AGENTS.md", "# Agents\n")
    const h = harness()
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(h.text()).toMatchInlineSnapshot(`
      "[init] @acme/widgets, owned by Acme, to internal-package-contract v0.12.0:
        - add internal-package-contract (v0.12.0) and the "contract" script to package.json, and its repository
        - install, then scaffold the hygiene files, workflows, hooks and (with --github) branch protection
        - write the Scorecard workflow, the pin-sync workflow and the Changesets config the package lacks (\`init\` and \`sync\`)
        - add the configs, documents and templates the package lacks, and name any shared document it has that differs
        - start adoption mode: failing checks report their errors but only promoted ones fail the run (--strict skips this)
        - draft docs/surface.json from the exports, generate the API map and document the environment (ci/env.schema.ts)
        - report what is left (\`doctor\`)
      [init] install
      [init] scaffold the files every package carries
      [init] write the managed files the package lacks
      [init] added to package.json: 17 scripts, 12 devDependencies, 1 overrides
      [init] wrote CODE_OF_CONDUCT.md, SUPPORT.md, RELEASING.md, docs/surface.json, AGENTS.md (the API map section), .github/ISSUE_TEMPLATE/bug_report.yml, .github/ISSUE_TEMPLATE/config.yml, .github/ISSUE_TEMPLATE/feature_request.yml, .github/pull_request_template.md, .markdownlint-cli2.jsonc, .npmrc, .prettierignore, ADOPTION.md, CODE_REVIEW.md, LICENSE, README.md, VERSIONING.md, ci/env.schema.ts, eslint.config.js, knip.json, prettier.config.mjs, scripts/emit-dts-shims.mjs, stryker.config.mjs, tsconfig.build.json, tsconfig.json, tsup.config.ts, typedoc.json, typedoc.markdown.json, vitest.config.ts, .repo-contract/adoption.json (adoption mode: failures are reported but do not fail the run until you promote the check)
      [init] generate the API map
      [init] document the environment


      [init] done. Review the changes, then run \`npm run contract\` to see what the standard finds, and commit.
      "
    `)
    expect(h.calls).toMatchInlineSnapshot(`
      [
        "npm install --ignore-scripts",
        "node node_modules/internal-package-contract/bin/scaffold.mjs --no-github",
        "node node_modules/internal-package-contract/bin/contract.mjs sync --apply",
        "node node_modules/internal-package-contract/bin/contract.mjs generate",
        "node node_modules/internal-package-contract/bin/contract.mjs env",
        "node node_modules/internal-package-contract/bin/contract.mjs doctor",
      ]
    `)
    expect(files()).toMatchInlineSnapshot(`
      [
        ".github/ISSUE_TEMPLATE/bug_report.yml",
        ".github/ISSUE_TEMPLATE/config.yml",
        ".github/ISSUE_TEMPLATE/feature_request.yml",
        ".github/pull_request_template.md",
        ".markdownlint-cli2.jsonc",
        ".npmrc",
        ".prettierignore",
        ".repo-contract/adoption.json",
        "ADOPTION.md",
        "AGENTS.md",
        "CODE_OF_CONDUCT.md",
        "CODE_REVIEW.md",
        "LICENSE",
        "README.md",
        "RELEASING.md",
        "SUPPORT.md",
        "VERSIONING.md",
        "ci/env.schema.ts",
        "docs/surface.json",
        "eslint.config.js",
        "knip.json",
        "package-lock.json",
        "package.json",
        "prettier.config.mjs",
        "scripts/emit-dts-shims.mjs",
        "stryker.config.mjs",
        "tsconfig.build.json",
        "tsconfig.json",
        "tsup.config.ts",
        "typedoc.json",
        "typedoc.markdown.json",
        "vitest.config.ts",
      ]
    `)
    expect(JSON.parse(read("package.json")).scripts.contract).toBe("internal-package-contract")
  })
})

const USAGE =
  "Usage: internal-package-contract init [--tag vX.Y.Z | --spec <dependency spec>] [--owner <github owner>] [--github] [--docs] [--strict] [--dry-run]\n"

describe("init in an existing package: every refusal, word for word", () => {
  const refuse = (argv: string[], options?: Options) => {
    const h = harness(options)
    const code = run(argv, dir, h.io, h.hooks)
    return { code, err: h.err.join(""), calls: h.calls }
  }
  it("says which options are wrong, all of them, with the usage", () => {
    manifest()
    expect(refuse(["--tag"])).toEqual({
      code: 2,
      err: `[init] --tag needs a value.\n${USAGE}`,
      calls: [],
    })
    expect(refuse(["--tag", "--owner", "--spec"]).err).toBe(
      `[init] --tag needs a value. --spec needs a value.\n${USAGE}`,
    )
    expect(refuse(["--owner", ""]).code).toBe(0)
    expect(refuse(["--bogus", "--tag", "main"]).err).toBe(
      `[init] unknown argument: --bogus main is not a release tag such as v0.12.0.\n${USAGE}`,
    )
    expect(refuse(["--tag", "v1.0.0", "--spec", "file:/x"]).err).toBe(
      `[init] --tag and --spec cannot be combined.\n${USAGE}`,
    )
  })
  it("needs a package.json that is JSON, with a name", () => {
    expect(refuse([]).err).toBe(
      "[init] there is no package.json here. To start a new package use `init --name <package>` in an empty directory.\n",
    )
    write("package.json", "{ nope")
    expect(refuse([]).err).toBe("[init] package.json is not valid JSON.\n")
    write("package.json", "{}")
    expect(refuse([]).err).toBe("[init] package.json has no name.\n")
  })
  it("needs an owner, and a release to pin, and a clean working tree", () => {
    manifest()
    expect(refuse([], { remote: "" }).err).toBe(
      "[init] cannot tell who owns the repository: package.json has no repository and there is no GitHub origin remote. Pass --owner <github owner>.\n",
    )
    expect(refuse([], { tags: "" }).err).toBe(
      "[init] could not find a release of MaverickCER/internal-package-contract. Pass --tag vX.Y.Z.\n",
    )
    expect(refuse([], { tags: "abc\trefs/tags/not-a-tag\n" }).err).toContain(
      "could not find a release",
    )
    const dirty = refuse([], { dirty: " M a.ts\n?? b.ts\n" })
    expect(dirty.err).toBe(
      "[init] commit or stash these first, so the adoption is a diff you can review and undo:\n- a.ts\n- b.ts\n",
    )
    expect(dirty.calls).toEqual([])
  })
  it("asks git for the origin, the newest release and the state of the tree, in those words", () => {
    manifest()
    const h = harness()
    run(["--dry-run"], dir, h.io, h.hooks)
    expect(h.captured).toEqual([
      "git remote get-url origin",
      "git ls-remote --tags --refs --sort=-v:refname https://github.com/MaverickCER/internal-package-contract.git v[0-9]*",
      "git status --porcelain",
    ])
  })
  it("stops, saying which step and how to undo, at each step that must succeed", () => {
    for (const [failOn, label] of [
      ["npm install", "install"],
      ["scaffold.mjs", "scaffold the files every package carries"],
      ["generate", "generate the API map"],
    ] as const) {
      manifest()
      const h = harness({ failOn })
      expect(run([], dir, h.io, h.hooks), failOn).toBe(1)
      expect(h.err.join("")).toBe(
        `[init] stopped: "${label}" failed. Nothing is committed; \`git restore .\` undoes the run (and delete untracked files with \`git clean\`).\n`,
      )
      rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    }
  })
  it("carries on, saying so, when the managed files cannot be written yet", () => {
    manifest()
    const h = harness({ failOn: "sync --apply" })
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(h.text()).toContain(
      '[init] "write the managed files the package lacks" did not finish; `doctor` at the end says what is left.\n',
    )
    expect(h.text()).toContain("[init] generate the API map\n")
  })
})

describe("init in an existing package: the details of what it writes", () => {
  it("does not look for a release, or ask for one, when the package already has the dependency or is given a spec", () => {
    manifest({ devDependencies: { "internal-package-contract": "github:O/r#v1.2.3" } })
    const adopted = harness({ tags: "" })
    expect(run(["--dry-run"], dir, adopted.io, adopted.hooks)).toBe(0)
    expect(adopted.text()).toContain(
      "keep internal-package-contract where it is (github:O/r#v1.2.3)",
    )
    expect(adopted.captured.some((call) => call.includes("ls-remote"))).toBe(false)
    manifest()
    const spec = harness({ tags: "" })
    expect(run(["--dry-run", "--spec", "file:/x"], dir, spec.io, spec.hooks)).toBe(0)
    expect(spec.text()).toContain("to internal-package-contract file:/x:")
    expect(spec.captured.some((call) => call.includes("ls-remote"))).toBe(false)
  })
  it("keeps the indentation the manifest already uses, and counts what it added", () => {
    for (const indent of ["\t", 4, 2] as const) {
      manifest({}, indent)
      const h = harness()
      run([], dir, h.io, h.hooks)
      const text = read("package.json")
      expect(
        text.startsWith(`{\n${typeof indent === "number" ? " ".repeat(indent) : indent}"name"`),
      ).toBe(true)
      expect(text.endsWith("}\n")).toBe(true)
      rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
      rmSync(path.join(dir, "package-lock.json"), { force: true })
    }
    write("package.json", '{"name":"x","exports":{}}')
    const compact = harness()
    run([], dir, compact.io, compact.hooks)
    expect(read("package.json").startsWith('{\n  "name"')).toBe(true)
  })
  it("adds a repository from the owner, for a scoped and an unscoped name, and keeps one that is there", () => {
    manifest({ name: "@acme/widgets" })
    run([], dir, harness().io, harness().hooks)
    expect(JSON.parse(read("package.json")).repository).toEqual({
      type: "git",
      url: "git+https://github.com/Acme/widgets.git",
    })
    write("package.json", JSON.stringify({ name: "plain", exports: {} }))
    run([], dir, harness().io, harness().hooks)
    expect(JSON.parse(read("package.json")).repository.url).toBe(
      "git+https://github.com/Acme/plain.git",
    )
    write(
      "package.json",
      JSON.stringify({ name: "plain", exports: {}, repository: "github:Own/plain" }),
    )
    run([], dir, harness().io, harness().hooks)
    expect(JSON.parse(read("package.json")).repository).toBe("github:Own/plain")
  })
  it("adds a script, a tool or an override only where the package has none of its own, and says how many", () => {
    manifest({
      scripts: { test: "mine", build: "mine too" },
      devDependencies: { vitest: "^1.0.0" },
    })
    const h = harness()
    run([], dir, h.io, h.hooks)
    const added = JSON.parse(read("package.json"))
    expect(added.scripts.test).toBe("mine")
    expect(added.scripts.build).toBe("mine too")
    expect(added.devDependencies.vitest).toBe("^1.0.0")
    expect(h.text()).toMatch(
      /added to package.json: \d+ scripts, \d+ devDependencies, \d+ overrides\n/,
    )
    const again = harness()
    rmSync(path.join(dir, "node_modules"), { recursive: true, force: true })
    run([], dir, again.io, again.hooks)
    expect(again.text()).toContain(
      "added to package.json: 0 scripts, 0 devDependencies, 0 overrides\n",
    )
    expect(Object.keys(JSON.parse(read("package.json")))).not.toContain("overrides-empty")
  })
  it("writes the standard's documents the package lacks, and names one that differs", () => {
    manifest()
    write("SUPPORT.md", "my own support text\n")
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(h.text()).toContain(
      "[init] SUPPORT.md differs from the standard's, so it was left as it is. `internal-package-contract sync --add support` adopts the standard's.\n",
    )
    expect(read("SUPPORT.md")).toBe("my own support text\n")
    expect(JSON.parse(read("package.json"))["internal-package-contract"].copies).toEqual([
      "code-of-conduct",
      "releasing",
      "typedoc-markdown",
    ])
  })
  it("rewrites a hand-written API table into the generated region, and seeds the surface from it", () => {
    manifest()
    write(
      "AGENTS.md",
      "# Agents\n\n| Export | Source | Environment | Purpose |\n| --- | --- | --- | --- |\n| `@acme/widgets` | `src/core/` | isomorphic | the runtime |\n\nafter\n",
    )
    const h = harness()
    run([], dir, h.io, h.hooks)
    expect(h.text()).toContain(
      "AGENTS.md (its API table is now generated; 1 row(s) seeded docs/surface.json), docs/surface.json",
    )
    expect(read("AGENTS.md")).toBe(
      "# Agents\n\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n\nafter\n",
    )
    expect(JSON.parse(read("docs/surface.json")).entries["."]).toEqual({
      source: "src/core/",
      environment: "isomorphic",
      tier: "Stable",
      purpose: "the runtime",
    })
  })
  it("leaves a table alone when the package already has the markers, or a surface file", () => {
    manifest()
    const table = "| Export | Source |\n| --- | --- |\n| `@acme/widgets` | `src/` |\n"
    write("AGENTS.md", `${table}<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n`)
    run([], dir, harness().io, harness().hooks)
    expect(read("AGENTS.md")).toBe(
      `${table}<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n`,
    )
  })
  it("appends the API map section to an AGENTS.md without one, once", () => {
    manifest()
    write("AGENTS.md", "# Agents\n\ntext   \n\n")
    run([], dir, harness().io, harness().hooks)
    expect(read("AGENTS.md")).toBe(
      "# Agents\n\ntext\n\n## Public API map\n\n<!-- ipc:begin entry-points -->\n<!-- ipc:end entry-points -->\n",
    )
  })
  it("never adds the package's own source, tests, benchmarks, report, workflows or changesets", () => {
    manifest()
    const h = harness()
    run([], dir, h.io, h.hooks)
    for (const file of files()) {
      expect(file, file).not.toMatch(
        /^(src|test|benchmarks|docs\/api-report|\.github\/workflows|\.changeset)\//,
      )
    }
    expect(files()).not.toContain("CODEOWNERS")
  })
  it("starts adoption mode unless the package is adopted, strict, or already has the file", () => {
    manifest()
    run([], dir, harness().io, harness().hooks)
    expect(files()).toContain(".repo-contract/adoption.json")
    rmSync(path.join(dir, ".repo-contract"), { recursive: true })
    run(["--strict"], dir, harness().io, harness().hooks)
    expect(files()).not.toContain(".repo-contract/adoption.json")
    write(".repo-contract/adoption.json", "keep me")
    manifest({ devDependencies: { "internal-package-contract": "github:O/r#v1.0.0" } })
    run([], dir, harness().io, harness().hooks)
    expect(read(".repo-contract/adoption.json")).toBe("keep me")
  })
  it("carries on, saying so, when the environment cannot be documented", () => {
    manifest()
    const h = harness({ failOn: "contract.mjs env" })
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(h.text()).toContain(
      '[init] "document the environment" did not finish; `doctor` at the end says what is left.\n',
    )
  })

  it("regenerates the landing page of a package that has one, saying so, and carries on if it cannot", () => {
    manifest()
    write("docs/site.json", "{}")
    const h = harness({ failOn: "contract.mjs site" })
    expect(run([], dir, h.io, h.hooks)).toBe(0)
    expect(h.text()).toContain("[init] regenerate the landing page\n")
    expect(h.text()).toContain(
      '[init] "regenerate the landing page" did not finish; `doctor` at the end says what is left.\n',
    )
    expect(h.calls.at(-1)).toContain("doctor")
  })
  it("fills the documents it writes with the package's own name, owner, description and year", () => {
    manifest({ description: "Make widgets" })
    run([], dir, harness().io, harness().hooks)
    expect(read("LICENSE")).toContain(String(new Date().getFullYear()))
    expect(read("LICENSE")).toContain("Acme")
    expect(read("README.md")).toContain("Make widgets")
    expect(read("RELEASING.md")).toContain("`acme`")
    manifest({ description: undefined })
    rmSync(path.join(dir, "README.md"))
    run([], dir, harness().io, harness().hooks)
    expect(read("README.md")).not.toContain("undefined")
  })
})

describe("init in an existing package: helpers", () => {
  it("captureCommand returns what a command printed and how it ended, and 1 when it did not run", () => {
    expect(captureCommand(process.execPath, ["-e", "process.stdout.write('hi')"], dir)).toEqual({
      status: 0,
      stdout: "hi",
    })
    expect(
      captureCommand(process.execPath, ["-e", "process.stdout.write('x');process.exit(3)"], dir),
    ).toEqual({ status: 3, stdout: "x" })
    writeFileSync(path.join(dir, "here.txt"), "")
    expect(
      captureCommand(
        process.execPath,
        ["-e", "process.exit(require('fs').existsSync('here.txt') ? 0 : 5)"],
        dir,
      ).status,
    ).toBe(0)
    expect(captureCommand("this-command-does-not-exist-anywhere", [], dir)).toEqual({
      status: 1,
      stdout: "",
    })
  })
  it("latestTag takes the first line git lists, without the ref prefix, and nothing when git lists none", () => {
    const capture = (stdout: string) => () => ({ status: 0, stdout })
    expect(latestTag(capture("abc\trefs/tags/v0.12.0\ndef\trefs/tags/v0.11.0\n"), dir)).toBe(
      "v0.12.0",
    )
    expect(latestTag(capture("  abc\trefs/tags/v1.0.0  \n"), dir)).toBe("v1.0.0")
    expect(latestTag(capture(""), dir)).toBe("")
  })
})

describe("init in an existing package: edges of what it writes", () => {
  it("adds its repository to the plan only when the package has none", () => {
    manifest()
    const without = harness()
    run(["--dry-run"], dir, without.io, without.hooks)
    expect(without.text()).toContain('the "contract" script to package.json, and its repository\n')
    manifest({ repository: "github:Acme/widgets" })
    const withOne = harness()
    run(["--dry-run"], dir, withOne.io, withOne.hooks)
    expect(withOne.text()).toContain('the "contract" script to package.json\n')
    expect(withOne.text()).not.toContain("and its repository")
  })

  it("takes the indentation only from the top of the file, not from something nested in it", () => {
    write("package.json", '{"name":"@acme/widgets","exports":{\n      ".": "./a.js"\n}}\n')
    run([], dir, harness().io, harness().hooks)
    expect(read("package.json").startsWith('{\n  "name"')).toBe(true)
  })

  it("says it wrote nothing more when there is nothing left to write", () => {
    manifest()
    run([], dir, harness().io, harness().hooks)
    const again = harness()
    run([], dir, again.io, again.hooks)
    expect(again.text()).toContain("[init] wrote nothing more\n")
  })

  it("keeps an adoption file the package already has, even when it is not adopted yet", () => {
    manifest()
    write(".repo-contract/adoption.json", "keep me")
    run([], dir, harness().io, harness().hooks)
    expect(read(".repo-contract/adoption.json")).toBe("keep me")
  })

  it("starts adoption mode even when the package already keeps other files in .repo-contract", () => {
    manifest()
    write(".repo-contract/exceptions/socket.json", '{ "exceptions": [] }\n')
    run([], dir, harness().io, harness().hooks)
    expect(files()).toContain(".repo-contract/adoption.json")
  })

  it("renders a document it writes with an empty description when the package has none", () => {
    manifest({ description: undefined })
    run([], dir, harness().io, harness().hooks)
    const expected = render(
      readFileSync(path.join(packageRoot, "template", "package", "README.md"), "utf8"),
      {
        name: "@acme/widgets",
        repo: "widgets",
        owner: "Acme",
        description: "",
        year: String(new Date().getFullYear()),
      },
    )
    expect(read("README.md")).toBe(expected)
  })

  it("writes every template file except the package's own source, tests, benchmarks, report, workflows, changesets and what it handles itself", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-template-"))
    try {
      cpSync(path.join(packageRoot, "template"), path.join(root, "template"), { recursive: true })
      for (const extra of [
        "src/skipped.ts",
        "test/skipped.ts",
        "benchmarks/skipped.md",
        "docs/api-report/skipped.md",
        ".github/workflows/skipped.yml",
        ".changeset/skipped.md",
        "nested/package.json",
        "nested/AGENTS.md",
        "nested/CODEOWNERS",
        "nested/docs/surface.json",
        "nested/CODE_OF_CONDUCT.md",
        "nested/SUPPORT.md",
        "nested/RELEASING.md",
        "src-notes/kept.md",
        "xsrc/kept.md",
        "xtest/kept.md",
        "kept/benchmarks/kept.md",
        "docs/api-report-extra/kept.md",
        "x.github/workflows/kept.yml",
        "x.changeset/kept.md",
        "package.json.bak",
        "AGENTS.mdx",
        "CODEOWNERS.bak",
        "docs/surface.json.bak",
        "SUPPORT.md.bak",
      ]) {
        const target = path.join(root, "template", "package", extra)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, "x\n")
      }
      manifest()
      const h = harness()
      h.hooks.packageRoot = root
      expect(run([], dir, h.io, h.hooks)).toBe(0)
      const written = files()
      for (const skipped of [
        "src/skipped.ts",
        "test/skipped.ts",
        "benchmarks/skipped.md",
        "docs/api-report/skipped.md",
        ".github/workflows/skipped.yml",
        ".changeset/skipped.md",
      ]) {
        expect(written, skipped).not.toContain(skipped)
      }
      for (const kept of [
        "nested/package.json",
        "nested/AGENTS.md",
        "nested/CODEOWNERS",
        "nested/docs/surface.json",
        "nested/CODE_OF_CONDUCT.md",
        "nested/SUPPORT.md",
        "nested/RELEASING.md",
        "src-notes/kept.md",
        "xsrc/kept.md",
        "xtest/kept.md",
        "kept/benchmarks/kept.md",
        "docs/api-report-extra/kept.md",
        "x.github/workflows/kept.yml",
        "x.changeset/kept.md",
        "package.json.bak",
        "AGENTS.mdx",
        "CODEOWNERS.bak",
        "docs/surface.json.bak",
        "SUPPORT.md.bak",
      ]) {
        expect(written, kept).toContain(kept)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
