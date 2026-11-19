import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { diagnose, run } from "../scripts/doctor/run.mjs"
import { run as envRun } from "../scripts/env/run.mjs"
import { inspectManaged } from "../scripts/managed-files/inspect.mjs"
import { run as renderSite } from "../scripts/site/render-site.mjs"
import { validSite } from "./support-site.js"

const packageRoot = path.resolve(import.meta.dirname, "..")
const SHA = "c".repeat(40)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-doctor-exact-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const noGit = () => undefined
const items = (git: (args: string[]) => string | undefined = noGit) =>
  diagnose({ cwd: dir, packageRoot, git })
const one = async (id: string, git?: (args: string[]) => string | undefined) =>
  (await items(git)).find((item) => item.id === id)

const healthy = async (): Promise<void> => {
  write(
    "package.json",
    JSON.stringify({
      name: "demo-pkg",
      version: "1.0.0",
      repository: { url: "git+ssh://git@github.com/example/demo-pkg.git" },
      "internal-package-contract": { copies: ["releasing", "support"] },
      devDependencies: {
        "internal-package-contract": "github:MaverickCER/internal-package-contract#v0.12.0",
      },
      scripts: { contract: "internal-package-contract" },
    }),
  )
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
  for (const file of ["release.yml", "scorecard.yml", "sync-internal-package-contract.yml"]) {
    write(`.github/workflows/${file}`, "x\n")
  }
  for (const entry of inspectManaged({
    cwd: dir,
    packageRoot,
    pins: { ipcRef: "v0.12.0", ipcSha: SHA },
  })) {
    write(entry.to, entry.wanted)
  }
  write("docs/site.json", JSON.stringify(validSite()))
  await renderSite([], dir, { out: () => undefined, err: () => undefined })
}
describe("diagnose, word for word", () => {
  it("a directory with no package", async () => {
    expect(await items()).toMatchInlineSnapshot(`
      [
        {
          "fix": "Run \`npx github:MaverickCER/internal-package-contract init --name <package>\` in an empty directory to start a package, or run this in an existing package.",
          "id": "package",
          "state": "todo",
          "what": "There is no readable package.json here.",
        },
      ]
    `)
  })

  it("a package that has done nothing yet", async () => {
    write("package.json", JSON.stringify({ name: "@acme/w" }))
    expect(await items()).toMatchInlineSnapshot(`
      [
        {
          "fix": "Run \`internal-package-contract init\`.",
          "id": "dependency",
          "state": "todo",
          "what": "internal-package-contract is not a dependency of this package.",
        },
        {
          "fix": "Add \`"contract": "internal-package-contract"\` to its scripts, or run \`internal-package-contract init\`.",
          "id": "script",
          "state": "todo",
          "what": "package.json has no "contract" script that runs the standard.",
        },
        {
          "fix": "Run \`npm install\` so the lockfile pins a commit, then \`internal-package-contract init\` (it writes only what is missing).",
          "id": "workflows",
          "state": "todo",
          "what": "Missing workflows: release.yml (publishes the package), scorecard.yml (publishes the OpenSSF Scorecard result), sync-internal-package-contract.yml (keeps the pin current).",
        },
        {
          "fix": "Run \`internal-package-contract install-hooks\` once in this clone.",
          "id": "hooks",
          "state": "todo",
          "what": "git is not set up to run the standard's hooks, so a change is not checked before it is committed.",
        },
        {
          "id": "regions",
          "state": "ok",
          "what": "[generate] no generated regions here; nothing to do.",
        },
        {
          "fix": "Write docs/site.json (the README's "Landing page" section lists what it needs), then run \`internal-package-contract site\`.",
          "id": "site",
          "state": "todo",
          "what": "There is no docs/site.json, so the package has no generated landing page.",
        },
        {
          "id": "env",
          "state": "ok",
          "what": "There is no ci/env.schema.ts, and none is required: it documents the credentials the workflows use and when they expire.",
        },
        {
          "id": "prompts",
          "state": "ok",
          "what": "No document still asks its author a question.",
        },
        {
          "id": "adoption",
          "state": "ok",
          "what": "Every check can fail the run (not in adoption mode).",
        },
        {
          "fix": "On npmjs.com, open @acme/w > Settings > Trusted Publisher > GitHub Actions: organization or user \`<owner>\`, repository \`w\`, workflow \`release.yml\`, environment blank. A package that is not on npm yet needs its first publish by hand.",
          "id": "trusted-publisher",
          "state": "manual",
          "what": "npm's trusted publisher is registered on npmjs.com, which only the package's owner can do.",
        },
        {
          "fix": "Run \`gh auth login\` and then \`internal-package-contract init --github\` to apply branch protection; in Settings > Actions > General allow Actions to create pull requests. The BranchProtection check verifies the result.",
          "id": "repository",
          "state": "manual",
          "what": "Branch protection and Actions settings live on GitHub.",
        },
        {
          "fix": "Install the CodeRabbit and Socket apps on the repository. Add a SOCKET_SECURITY_API_KEY secret for the Socket scan. Optionally add a PIN_SYNC_TOKEN secret (a fine-grained token with Contents, Pull requests and Workflows write access) so pin-sync pull requests can change workflow files.",
          "id": "apps",
          "state": "manual",
          "what": "Review and scanning services are installed on the repository, not in it.",
        },
      ]
    `)
  })

  it("a package that has done everything it can by itself", async () => {
    await healthy()
    const git = (args: string[]) =>
      args.includes("core.hooksPath")
        ? "/x/node_modules/internal-package-contract/hooks"
        : undefined
    expect(await items(git)).toMatchInlineSnapshot(`
      [
        {
          "id": "dependency",
          "state": "ok",
          "what": "internal-package-contract is pinned: github:MaverickCER/internal-package-contract#v0.12.0.",
        },
        {
          "id": "script",
          "state": "ok",
          "what": "The "contract" script runs the standard.",
        },
        {
          "id": "workflows",
          "state": "ok",
          "what": "The release, Scorecard and pin-sync workflows exist.",
        },
        {
          "id": "hooks",
          "state": "ok",
          "what": "git runs the standard's hooks.",
        },
        {
          "id": "managed",
          "state": "ok",
          "what": "Every file the standard owns here (2 copies and documents) is current.",
        },
        {
          "id": "regions",
          "state": "ok",
          "what": "[generate] no generated regions here; nothing to do.",
        },
        {
          "id": "site",
          "state": "ok",
          "what": "The landing page matches docs/site.json.",
        },
        {
          "id": "env",
          "state": "ok",
          "what": "There is no ci/env.schema.ts, and none is required: it documents the credentials the workflows use and when they expire.",
        },
        {
          "id": "prompts",
          "state": "ok",
          "what": "No document still asks its author a question.",
        },
        {
          "id": "adoption",
          "state": "ok",
          "what": "Every check can fail the run (not in adoption mode).",
        },
        {
          "fix": "On npmjs.com, open demo-pkg > Settings > Trusted Publisher > GitHub Actions: organization or user \`example\`, repository \`demo-pkg\`, workflow \`release.yml\`, environment blank. A package that is not on npm yet needs its first publish by hand.",
          "id": "trusted-publisher",
          "state": "manual",
          "what": "npm's trusted publisher is registered on npmjs.com, which only the package's owner can do.",
        },
        {
          "fix": "Run \`gh auth login\` and then \`internal-package-contract init --github\` to apply branch protection; in Settings > Actions > General allow Actions to create pull requests. The BranchProtection check verifies the result.",
          "id": "repository",
          "state": "manual",
          "what": "Branch protection and Actions settings live on GitHub.",
        },
        {
          "fix": "Install the CodeRabbit and Socket apps on the repository. Add a SOCKET_SECURITY_API_KEY secret for the Socket scan. Optionally add a PIN_SYNC_TOKEN secret (a fine-grained token with Contents, Pull requests and Workflows write access) so pin-sync pull requests can change workflow files.",
          "id": "apps",
          "state": "manual",
          "what": "Review and scanning services are installed on the repository, not in it.",
        },
      ]
    `)
  })

  it("a linked worktree with the standard installed as a symlink, and a stale landing page", async () => {
    write("package.json", JSON.stringify({ name: "w", repository: "github:Acme/w" }))
    write("docs/site.json", "{ nope")
    mkdirSync(path.join(dir, "elsewhere"))
    mkdirSync(path.join(dir, "node_modules"))
    symlinkSync(
      path.join(dir, "elsewhere"),
      path.join(dir, "node_modules", "internal-package-contract"),
    )
    const git = (args: string[]) =>
      args.includes("--git-dir")
        ? "/repo/.git/worktrees/w"
        : args.includes("--git-common-dir")
          ? "/repo/.git"
          : undefined
    const found = await items(git)
    expect(found.filter((item) => ["install", "worktree", "site"].includes(item.id)))
      .toMatchInlineSnapshot(`
      [
        {
          "fix": "Install a copy instead: \`npm install --install-links --save-dev file:<path to internal-package-contract>\`.",
          "id": "install",
          "state": "todo",
          "what": "internal-package-contract is installed as a symlink, so it resolves its own tools from its own node_modules and checks can fail for reasons that are not in this package.",
        },
        {
          "fix": "Make the commit or push from the main checkout (for a push, \`git push origin <branch>:<branch>\`), or work in a separate clone.",
          "id": "worktree",
          "state": "todo",
          "what": "This is a linked git worktree. The bundled hooks can run the wrong hook, or the wrong copy of the standard, from here.",
        },
        {
          "fix": "Run \`internal-package-contract site\`.",
          "id": "site",
          "state": "todo",
          "what": "[site] docs/site.json is not valid JSON.",
        },
      ]
    `)
  })

  it("broken generated regions and unanswered prompts", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    write(
      "README.md",
      "<!-- ipc:begin entry-points -->\nno end\n<!-- ipc:prompt: Say who it is for. -->\n",
    )
    const found = await items()
    expect(found.filter((item) => ["regions", "prompts"].includes(item.id))).toMatchInlineSnapshot(`
      [
        {
          "fix": "Run \`internal-package-contract generate\`.",
          "id": "regions",
          "state": "todo",
          "what": "[generate] nothing was written:
      - README.md:1: region "entry-points" has no end marker.",
        },
        {
          "fix": "Answer each by replacing its whole comment (or its \`TODO:\` value) with the answer.",
          "id": "prompts",
          "state": "todo",
          "what": "1 unanswered prompt(s), starting with README.md:3. A release fails until they are answered.",
        },
      ]
    `)
  })

  it("each state of adoption mode", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    const day = 24 * 3600 * 1000
    const date = (offsetDays: number) =>
      new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10)
    write(
      ".repo-contract/adoption.json",
      JSON.stringify({ version: 1, startedAt: date(-1), expiresAt: date(10), enforce: [] }),
    )
    const active = await one("adoption")
    expect(active?.state).toBe("todo")
    expect(active?.what).toMatch(
      new RegExp(
        `^Adoption mode is on until ${date(10)} \\((10|11) day\\(s\\) left\\): a failing check reports its error without failing the run, and nothing enforces yet\\.$`,
      ),
    )
    expect(active?.fix).toBe(
      "Run `npm run contract`, fix a check, then `internal-package-contract promote <Check>`. `promote --all` ends adoption mode.",
    )
    write(
      ".repo-contract/adoption.json",
      JSON.stringify({
        version: 1,
        startedAt: date(-1),
        expiresAt: date(10),
        enforce: ["Lint", "Docs"],
      }),
    )
    expect((await one("adoption"))?.what).toContain("and Lint, Docs enforce.")
    write(
      ".repo-contract/adoption.json",
      JSON.stringify({ version: 1, startedAt: "2020-01-01", expiresAt: "2020-02-01", enforce: [] }),
    )
    expect(await one("adoption")).toEqual({
      id: "adoption",
      state: "todo",
      what: "The adoption period ended on 2020-02-01.",
      fix: "Run `internal-package-contract promote --all` so every check enforces.",
    })
    write(".repo-contract/adoption.json", "{ nope")
    expect(await one("adoption")).toEqual({
      id: "adoption",
      state: "todo",
      what: ".repo-contract/adoption.json is not valid JSON.",
      fix: "Run `internal-package-contract promote --all` so every check enforces.",
    })
  })

  it("the owner and repository in the npm trusted-publisher step, from each way a repository is written", async () => {
    for (const [repository, expected] of [
      ["github:Acme/w", "organization or user `acme`, repository `w`"],
      [{ url: "git+https://github.com/Acme/w.git" }, "organization or user `acme`, repository `w`"],
      [undefined, "organization or user `<owner>`, repository `w`"],
      [{}, "organization or user `<owner>`, repository `w`"],
    ] as const) {
      write(
        "package.json",
        JSON.stringify({ name: "@scope/w", ...(repository === undefined ? {} : { repository }) }),
      )
      expect((await one("trusted-publisher"))?.fix, JSON.stringify(repository)).toContain(expected)
    }
    write("package.json", JSON.stringify({}))
    expect((await one("trusted-publisher"))?.fix).toContain("open <package> > Settings")
  })
})

describe("diagnose, the remaining edges", () => {
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: dir,
      encoding: "utf8",
    })

  it("asks real git where it is, and about the hooks it runs", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    git("init", "-q")
    const plain = await diagnose({ cwd: dir, packageRoot })
    expect(plain.find((item) => item.id === "hooks")?.state).toBe("todo")
    expect(plain.some((item) => item.id === "worktree")).toBe(false)
    git("config", "core.hooksPath", "node_modules/internal-package-contract/hooks")
    const hooked = await diagnose({ cwd: dir, packageRoot })
    expect(hooked.find((item) => item.id === "hooks")?.state).toBe("ok")
  })

  it("sees a linked worktree for what it is, with real git", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "first")
    const linked = path.join(dir, "linked")
    git("worktree", "add", "-q", linked)
    const found = await diagnose({ cwd: linked, packageRoot })
    expect(found.find((item) => item.id === "worktree")?.state).toBe("todo")
  })

  it("flags a worktree when only the common directory is unknown too: both must be known to compare", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    const onlyCommon = (args: string[]) =>
      args.includes("--git-common-dir") ? "/repo/.git" : undefined
    expect((await items(onlyCommon)).some((item) => item.id === "worktree")).toBe(false)
  })

  it("leaves the managed files out when the standard it compares with has no templates", async () => {
    write(
      "package.json",
      JSON.stringify({
        name: "w",
        devDependencies: { "internal-package-contract": "github:O/r#v1.0.0" },
      }),
    )
    const bare = path.join(dir, "no-templates")
    mkdirSync(bare)
    const found = await diagnose({ cwd: dir, packageRoot: bare, git: noGit })
    expect(found.some((item) => item.id === "managed")).toBe(false)
  })

  it("lists every managed file that is missing, separated by commas", async () => {
    write(
      "package.json",
      JSON.stringify({
        name: "w",
        devDependencies: { "internal-package-contract": "github:O/r#v1.0.0" },
        "internal-package-contract": { copies: ["releasing", "support"] },
      }),
    )
    const managed = await one("managed")
    const listed = (managed?.what ?? "").split("drifted: ")[1]?.replace(/\.$/, "")
    expect(listed?.split(", ")).toHaveLength(7)
    expect(listed).toBe(
      ".github/workflows/release.yml, .github/workflows/sync-internal-package-contract.yml, .github/workflows/env-rotation.yml, .github/workflows/scorecard.yml, .changeset/config.json, SUPPORT.md, RELEASING.md",
    )
  })

  it("checks the generated regions without writing them", async () => {
    write("package.json", JSON.stringify({ name: "w", exports: { ".": "./a.js" } }))
    write(
      "docs/surface.json",
      JSON.stringify({
        entries: {
          ".": {
            source: "src/",
            environment: "any",
            tier: "Stable",
            purpose: "does a thing for the reader",
          },
        },
      }),
    )
    const stale = "<!-- ipc:begin entry-points -->\nold\n<!-- ipc:end entry-points -->\n"
    write("README.md", stale)
    const regions = await one("regions")
    expect(regions?.state).toBe("todo")
    expect(regions?.what).toBe(
      "[generate] stale: README.md. Run `npx internal-package-contract generate` and commit the result.",
    )
    expect(readFileSync(path.join(dir, "README.md"), "utf8")).toBe(stale)
  })

  it("names what is wrong with a landing page that cannot be read", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    mkdirSync(path.join(dir, "docs", "site.json"), { recursive: true })
    expect(await one("site")).toEqual({
      id: "site",
      state: "todo",
      what: "[site] docs/site.json is not valid JSON.",
      fix: "Run `internal-package-contract site`.",
    })
  })
  it("exits 0 when nothing is left to run and 1 when something is, and prints what it found", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    const out: string[] = []
    const io = { out: (t: string) => out.push(t), err: () => undefined }
    expect(await run([], dir, packageRoot, io)).toBe(1)
    expect(out.join("")).toContain(
      "[TODO  ] internal-package-contract is not a dependency of this package.",
    )
  })

  it("exits 0, and says nothing is left to run, for a package that has done what it can", async () => {
    await healthy()
    git("init", "-q")
    git("config", "core.hooksPath", "node_modules/internal-package-contract/hooks")
    const out: string[] = []
    const code = await run([], dir, packageRoot, { out: (t) => out.push(t), err: () => undefined })
    expect(code).toBe(0)
    expect(out.join("")).toContain(
      "Nothing left to run. 3 step(s) only a person can take are listed above.",
    )
  })

  it("says there is no landing page when docs exists but docs/site.json does not", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    mkdirSync(path.join(dir, "docs"))
    expect((await one("site"))?.what).toBe(
      "There is no docs/site.json, so the package has no generated landing page.",
    )
  })

  it("checks a landing page without writing it", async () => {
    write("package.json", JSON.stringify({ name: "demo-pkg" }))
    write("docs/site.json", JSON.stringify(validSite()))
    const site = await one("site")
    expect(site?.state).toBe("todo")
    expect(site?.what).toContain("docs is stale")
    expect(existsSync(path.join(dir, "docs", "index.html"))).toBe(false)
  })

  it("reports a missing or invalid package.json as a finding, and lets any other trouble reading it through", async () => {
    expect((await items()).map((item) => item.id)).toEqual(["package"])
    write("package.json", "{ nope")
    expect((await items()).map((item) => item.id)).toEqual(["package"])
    rmSync(path.join(dir, "package.json"))
    mkdirSync(path.join(dir, "package.json"))
    await expect(items()).rejects.toThrow("EISDIR")
  })

  it("asks for nothing when there is no environment contract, and says what to look at when there is one", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    expect(await one("env")).toEqual({
      id: "env",
      state: "ok",
      what: "There is no ci/env.schema.ts, and none is required: it documents the credentials the workflows use and when they expire.",
    })
    write(
      "ci/env.schema.ts",
      [
        'import { createEnv, documentEnv } from "internal-package-contract/env-cap"',
        "const s = { A_TOKEN: { validator: (v: string) => v.length > 0 || 'x' } }",
        'export const e = createEnv(s, { name: "ci" })',
        'documentEnv(s, { category: "CI", variables: { A_TOKEN: { description: "A token.", owner: "me", refreshInstructions: "Replace it.", sensitivity: "secret", expiresAt: "2020-01-01" } } })',
      ].join("\n"),
    )
    const todo = await one("env")
    expect(todo?.state).toBe("todo")
    expect(todo?.what).toMatch(
      /^The environment contract has 2 thing\(s\) to look at: "A_TOKEN" .*expired.*; docs\/ENVIRONMENT.md is out of date\.$/,
    )
    expect(todo?.fix).toBe(
      "Rotate what is expiring and update its `expiresAt`, then run `internal-package-contract env`.",
    )
  })

  it("calls a documented, current environment contract fine", async () => {
    write("package.json", JSON.stringify({ name: "w" }))
    write(
      "ci/env.schema.ts",
      [
        'import { createEnv, documentEnv } from "internal-package-contract/env-cap"',
        'const s = { A_TOKEN: { default: "", validator: () => true } }',
        'export const e = createEnv(s, { name: "ci" })',
        'documentEnv(s, { category: "CI", variables: { A_TOKEN: { description: "A token.", owner: "me", refreshInstructions: "Replace it.", sensitivity: "secret" } } })',
      ].join("\n"),
    )
    await envRun([], dir, { out: () => undefined, err: () => undefined })
    expect(await one("env")).toEqual({
      id: "env",
      state: "ok",
      what: "1 environment contract(s) documented, and the generated files are current.",
    })
  })
})
