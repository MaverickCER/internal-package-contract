import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { diagnose, renderReport, run } from "../scripts/doctor/run.mjs"

const packageRoot = path.resolve(import.meta.dirname, "..")
let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-doctor-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
type GitHook = (args: string[]) => string | undefined
const git =
  (value?: string): GitHook =>
  () =>
    value
const find = async (id: string, hook: GitHook = git()) =>
  (await diagnose({ cwd: dir, packageRoot, git: hook })).find((item) => item.id === id)

describe("diagnose: a directory that is not a package", () => {
  it("says to start one, and checks nothing else", async () => {
    const items = await diagnose({ cwd: dir, packageRoot, git: git() })
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe("package")
    expect(items[0]?.fix).toContain("init --name <package>")
    write("package.json", "{ nope")
    expect(await diagnose({ cwd: dir, packageRoot, git: git() })).toHaveLength(1)
  })
})

describe("diagnose: a package that has not adopted the standard", () => {
  beforeEach(() =>
    write("package.json", JSON.stringify({ name: "@acme/w", repository: "github:Acme/w" })),
  )
  it("asks for init when the dependency, the script and the workflows are missing", async () => {
    expect((await find("dependency"))?.state).toBe("todo")
    expect((await find("dependency"))?.fix).toBe("Run `internal-package-contract init`.")
    expect((await find("script"))?.state).toBe("todo")
    const workflows = await find("workflows")
    expect(workflows?.state).toBe("todo")
    expect(workflows?.fix).toBe(
      "Run `npm install` so the lockfile pins a commit, then `internal-package-contract init` (it writes only what is missing).",
    )
    expect(workflows?.what).toBe(
      "Missing workflows: release.yml (publishes the package), scorecard.yml (publishes the OpenSSF Scorecard result), sync-internal-package-contract.yml (keeps the pin current).",
    )
  })
  it("does not look at managed files before there is a dependency to compare them to", async () => {
    expect(await find("managed")).toBeUndefined()
  })
  it("asks for the hooks unless git is using this package's", async () => {
    expect((await find("hooks", git(undefined)))?.state).toBe("todo")
    expect((await find("hooks", git("")))?.state).toBe("todo")
    expect((await find("hooks", git("/x/hooks")))?.state).toBe("todo")
    expect((await find("hooks", git("node_modules/internal-package-contract/hooks")))?.state).toBe(
      "ok",
    )
  })
  it("asks for a landing page when there is no docs/site.json", async () => {
    const site = await find("site")
    expect(site?.state).toBe("todo")
    expect(site?.what).toBe(
      "There is no docs/site.json, so the package has no generated landing page.",
    )
  })
  it("reports no generated regions as fine, and a broken one as something to run", async () => {
    expect((await find("regions"))?.state).toBe("ok")
    write("AGENTS.md", "<!-- ipc:begin entry-points -->\n")
    const broken = await find("regions")
    expect(broken?.state).toBe("todo")
    expect(broken?.fix).toBe("Run `internal-package-contract generate`.")
  })
  it("counts unanswered prompts, naming the first", async () => {
    expect((await find("prompts"))?.state).toBe("ok")
    write("README.md", "# T\n\n<!-- ipc:prompt: say it -->\n")
    const prompts = await find("prompts")
    expect(prompts?.state).toBe("todo")
    expect(prompts?.what).toBe(
      "1 unanswered prompt(s), starting with README.md:3. A release fails until they are answered.",
    )
  })
})

describe("diagnose: the steps only a person can take", () => {
  it("gives the exact values for npm's trusted publisher, from the package and its repository", async () => {
    write(
      "package.json",
      JSON.stringify({
        name: "@Acme/widgets",
        repository: { url: "git+https://github.com/Acme/widgets.git" },
      }),
    )
    const publisher = await find("trusted-publisher")
    expect(publisher?.state).toBe("manual")
    expect(publisher?.fix).toContain("open @Acme/widgets > Settings > Trusted Publisher")
    expect(publisher?.fix).toContain(
      "organization or user `acme`, repository `widgets`, workflow `release.yml`",
    )
  })
  it("uses placeholders when the package says nothing about its owner or name", async () => {
    write("package.json", "{}")
    const publisher = await find("trusted-publisher")
    expect(publisher?.fix).toContain("open <package> >")
    expect(publisher?.fix).toContain("`<owner>`, repository `<package>`")
  })
  it("always lists the repository settings and the apps as manual", async () => {
    write("package.json", "{}")
    expect((await find("repository"))?.state).toBe("manual")
    expect((await find("apps"))?.fix).toContain("PIN_SYNC_TOKEN")
  })
})

describe("diagnose: a package that has adopted the standard", () => {
  it("finds the pin, the script, the workflows and the hooks in place", async () => {
    write(
      "package.json",
      JSON.stringify({
        name: "w",
        devDependencies: {
          "internal-package-contract": "github:MaverickCER/internal-package-contract#v0.12.0",
        },
        scripts: { contract: "internal-package-contract" },
      }),
    )
    for (const file of ["release.yml", "scorecard.yml", "sync-internal-package-contract.yml"]) {
      write(`.github/workflows/${file}`, "x\n")
    }
    expect((await find("dependency"))?.what).toBe(
      "internal-package-contract is pinned: github:MaverickCER/internal-package-contract#v0.12.0.",
    )
    expect((await find("script"))?.state).toBe("ok")
    expect((await find("workflows"))?.state).toBe("ok")
  })
  it("lists the managed files that are missing, once there is a dependency", async () => {
    write(
      "package.json",
      JSON.stringify({
        name: "w",
        devDependencies: { "internal-package-contract": "github:O/r#v1.0.0" },
        "internal-package-contract": { copies: ["releasing"] },
      }),
    )
    const managed = await find("managed")
    expect(managed?.state).toBe("todo")
    expect(managed?.what).toContain("managed file(s) are missing or drifted:")
    expect(managed?.what).toContain("RELEASING.md")
    expect(managed?.fix).toContain("sync --apply --update")
  })
  it("passes a landing page that is current and flags one that is stale", async () => {
    write("package.json", JSON.stringify({ name: "w", version: "1.0.0" }))
    write("docs/site.json", "{ nope")
    const stale = await find("site")
    expect(stale?.state).toBe("todo")
    expect(stale?.fix).toBe("Run `internal-package-contract site`.")
  })
})

describe("renderReport / run", () => {
  const items = [
    { id: "a", state: "ok" as const, what: "fine" },
    { id: "b", state: "todo" as const, what: "broken", fix: "run b" },
    { id: "c", state: "manual" as const, what: "by hand", fix: "do c" },
  ]
  it("marks each item, shows the fix under it, and counts what is left", () => {
    expect(renderReport(items)).toBe(
      "[ok    ] fine\n[TODO  ] broken\n         -> run b\n[MANUAL] by hand\n         -> do c\n\n1 thing(s) to run, then 1 step(s) only a person can take.\n",
    )
  })
  it("says nothing is left to run when only manual steps remain", () => {
    expect(renderReport([items[0]!, items[2]!])).toContain(
      "Nothing left to run. 1 step(s) only a person can take are listed above.",
    )
  })
  it("exits 1 while there is something to run, and 0 when only manual steps remain", async () => {
    write("package.json", "{}")
    const out: string[] = []
    const io = { out: (t: string) => out.push(t), err: () => undefined }
    expect(await run([], dir, packageRoot, io)).toBe(1)
    expect(out.join("")).toContain("[TODO  ]")
  })
  it("rejects an argument", async () => {
    const err: string[] = []
    expect(
      await run(["--x"], dir, packageRoot, { out: () => undefined, err: (t) => err.push(t) }),
    ).toBe(2)
    expect(err.join("")).toBe(
      "[doctor] unknown argument: --x\nUsage: internal-package-contract doctor\n",
    )
  })
})

describe("diagnose: a symlinked install and a linked worktree", () => {
  const link = (target: string): void => {
    mkdirSync(path.join(dir, "node_modules"), { recursive: true })
    symlinkSync(target, path.join(dir, "node_modules", "internal-package-contract"))
  }
  beforeEach(() => write("package.json", JSON.stringify({ name: "w" })))
  it("says to install a copy when the standard is installed as a symlink", async () => {
    const real = path.join(dir, "elsewhere")
    mkdirSync(real)
    link(real)
    const item = await find("install")
    expect(item?.state).toBe("todo")
    expect(item?.what).toContain("installed as a symlink")
    expect(item?.fix).toBe(
      "Install a copy instead: `npm install --install-links --save-dev file:<path to internal-package-contract>`.",
    )
  })
  it("says nothing about a copy, or an install that is not there", async () => {
    expect(await find("install")).toBeUndefined()
    mkdirSync(path.join(dir, "node_modules", "internal-package-contract"), { recursive: true })
    expect(await find("install")).toBeUndefined()
  })
  it("flags a linked worktree, where the git directory differs from the common one", async () => {
    const hook = (args: string[]) =>
      args.includes("--git-dir")
        ? "/repo/.git/worktrees/w"
        : args.includes("--git-common-dir")
          ? "/repo/.git"
          : undefined
    const item = await find("worktree", hook)
    expect(item?.state).toBe("todo")
    expect(item?.fix).toContain("git push origin <branch>:<branch>")
  })
  it("does not flag the main checkout, or a directory git cannot describe", async () => {
    const same = (args: string[]) => (args[0] === "rev-parse" ? "/repo/.git" : undefined)
    expect(await find("worktree", same)).toBeUndefined()
    expect(await find("worktree", git(undefined))).toBeUndefined()
    const half = (args: string[]) => (args.includes("--git-dir") ? "/repo/.git" : undefined)
    expect(await find("worktree", half)).toBeUndefined()
  })
})
