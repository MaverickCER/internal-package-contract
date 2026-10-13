import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { run, runCommand } from "../scripts/upgrade/run.mjs"

const SHA = "a".repeat(40)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-upgrade-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const project = (spec = "github:MaverickCER/internal-package-contract#v0.11.0"): void => {
  write(
    "package.json",
    JSON.stringify({ name: "demo", devDependencies: { "internal-package-contract": spec } }),
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
}
const harness = (status = 0, failOn?: string) => {
  const out: string[] = []
  const err: string[] = []
  const calls: string[][] = []
  const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }
  const spawn = (command: string, args: string[], cwd: string) => {
    calls.push([command, ...args])
    expect(cwd).toBe(dir)
    return failOn !== undefined && args.join(" ").includes(failOn) ? 1 : status
  }
  return { out, err, calls, io, spawn }
}
const bin = path.join("node_modules", "internal-package-contract", "bin", "contract.mjs")

describe("upgrade", () => {
  it("asks for exactly one release tag, and says what a tag looks like", () => {
    for (const argv of [[], ["main"], ["v0.12"], ["v0.12.0", "extra"], ["0.12.0"]]) {
      const h = harness()
      expect(run(argv, dir, h.io, { spawn: h.spawn })).toBe(2)
      expect(h.err.join("")).toBe(
        "[upgrade] expected one release tag such as v0.12.0.\nUsage: internal-package-contract upgrade <vX.Y.Z>\n",
      )
      expect(h.calls).toEqual([])
    }
  })
  it("needs a package.json and a package-lock.json", () => {
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.err.join("")).toBe(
      "[upgrade] needs a package.json and a package-lock.json in this directory.\n",
    )
    write("package.json", "{}")
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.err.join("")).toContain("needs a package.json and a package-lock.json")
  })
  it("needs each of the two files, not just one", () => {
    write("package.json", "{}")
    let h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.err.join("")).toBe(
      "[upgrade] needs a package.json and a package-lock.json in this directory.\n",
    )
    rmSync(path.join(dir, "package.json"))
    write("package-lock.json", "{}")
    h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.err.join("")).toBe(
      "[upgrade] needs a package.json and a package-lock.json in this directory.\n",
    )
  })
  it("says what it is doing at every step, in order, and nothing else", () => {
    project()
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    write("docs/site.json", "{}")
    mkdirSync(path.join(dir, "benchmarks"))
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(0)
    expect(h.out.join("")).toBe(
      [
        "[upgrade] install internal-package-contract v0.12.0",
        "[upgrade] re-pin the workflows that call its reusable workflows",
        "[upgrade] bring the managed files up to date",
        "[upgrade] regenerate the landing page",
        "[upgrade] copy the benchmark guides",
        "[upgrade] done. Review the changes, add a changeset, run the contract, and commit.",
        "",
      ].join("\n"),
    )
  })
  it("only re-pins workflows when there is a workflow folder, and only to a full commit", () => {
    project()
    const none = harness()
    run(["v0.12.0"], dir, none.io, { spawn: none.spawn })
    expect(none.calls.some((call) => call[1]?.endsWith("repin-workflows.mjs"))).toBe(false)
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    write(
      "package-lock.json",
      JSON.stringify({
        packages: {
          "node_modules/internal-package-contract": {
            resolved: `git+ssh://git@github.com/O/ipc.git#${SHA}-extra`,
          },
        },
      }),
    )
    const longer = harness()
    run(["v0.12.0"], dir, longer.io, { spawn: longer.spawn })
    expect(longer.calls.some((call) => call[1]?.endsWith("repin-workflows.mjs"))).toBe(false)
  })
  it("does not mistake a folder for the file or folder it looks for", () => {
    project()
    mkdirSync(path.join(dir, ".github"))
    mkdirSync(path.join(dir, "docs"))
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(0)
    expect(h.calls.map((call) => call[1])).toEqual(["install", bin])
  })
  it("reads a github: dependency only from the start of the spec, and a lockfile that lacks the entry", () => {
    project("npm:github:O/r#v1.0.0")
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    project()
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    for (const lock of [
      { packages: {} },
      { packages: { "node_modules/internal-package-contract": {} } },
    ]) {
      write("package-lock.json", JSON.stringify(lock))
      const quiet = harness()
      expect(run(["v0.12.0"], dir, quiet.io, { spawn: quiet.spawn })).toBe(0)
      expect(quiet.calls.map((call) => call[1])).toEqual(["install", bin])
    }
  })
  it("refuses a dependency that is not a github: one", () => {
    project("^1.0.0")
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.err.join("")).toBe(
      "[upgrade] internal-package-contract is not a github: dependency here, so there is no release to move it to.\n",
    )
    write("package.json", JSON.stringify({ name: "demo" }))
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
  })
  it("reads the dependency from dependencies as well as devDependencies", () => {
    write(
      "package.json",
      JSON.stringify({ dependencies: { "internal-package-contract": "github:Org/ipc#v0.1.0" } }),
    )
    write("package-lock.json", "{}")
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(0)
    expect(h.calls[0]).toEqual([
      "npm",
      "install",
      "--save-dev",
      "--ignore-scripts",
      "internal-package-contract@github:Org/ipc#v0.12.0",
    ])
  })
  it("installs the release, then runs only the steps the package has files for", () => {
    project()
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(0)
    expect(h.calls).toEqual([
      [
        "npm",
        "install",
        "--save-dev",
        "--ignore-scripts",
        "internal-package-contract@github:MaverickCER/internal-package-contract#v0.12.0",
      ],
      ["node", bin, "sync", "--apply", "--update"],
    ])
    expect(h.out.join("")).toBe(
      "[upgrade] install internal-package-contract v0.12.0\n[upgrade] bring the managed files up to date\n[upgrade] done. Review the changes, add a changeset, run the contract, and commit.\n",
    )
  })
  it("also re-pins workflows, regenerates the site and copies the guides when the package has them", () => {
    project()
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    write("docs/site.json", "{}")
    mkdirSync(path.join(dir, "benchmarks"))
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(0)
    expect(h.calls.slice(1)).toEqual([
      [
        "node",
        path.join("node_modules", "internal-package-contract", "scripts", "repin-workflows.mjs"),
        "internal-package-contract",
        SHA,
        "v0.12.0",
      ],
      ["node", bin, "sync", "--apply", "--update"],
      ["node", bin, "site"],
      ["node", bin, "sync-benchmark-guides"],
    ])
  })
  it("skips the workflow re-pin when the lockfile has no commit to pin to", () => {
    project()
    write("package-lock.json", "{}")
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(0)
    expect(h.calls.map((call) => call[1])).toEqual(["install", bin])
  })
  it("stops at the first step that fails and says how to undo it", () => {
    project()
    write("docs/site.json", "{}")
    const h = harness(0, "sync --apply")
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.calls).toHaveLength(2)
    expect(h.err.join("")).toBe(
      '[upgrade] stopped: "bring the managed files up to date" failed. Nothing is committed; `git restore .` undoes the run.\n',
    )
    const first = harness(0, "install")
    expect(run(["v0.12.0"], dir, first.io, { spawn: first.spawn })).toBe(1)
    expect(first.calls).toHaveLength(1)
    expect(first.err.join("")).toContain('"install internal-package-contract v0.12.0" failed')
  })
  it("refuses to start over uncommitted edits to the files it rewrites", () => {
    project()
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" })
    git("init", "-q")
    git("add", "-A")
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
    const clean = harness()
    expect(run(["v0.12.0"], dir, clean.io, { spawn: clean.spawn })).toBe(0)
    write(
      "package.json",
      JSON.stringify({
        name: "edited",
        devDependencies: { "internal-package-contract": "github:O/r#v1.0.0" },
      }),
    )
    const h = harness()
    expect(run(["v0.12.0"], dir, h.io, { spawn: h.spawn })).toBe(1)
    expect(h.err.join("")).toBe(
      "[upgrade] commit or stash these first, since the upgrade rewrites them:\n- package.json\n",
    )
    write("package-lock.json", "{}")
    const two = harness()
    expect(run(["v0.12.0"], dir, two.io, { spawn: two.spawn })).toBe(1)
    expect(two.err.join("")).toBe(
      "[upgrade] commit or stash these first, since the upgrade rewrites them:\n- package-lock.json\n- package.json\n",
    )
    expect(h.calls).toEqual([])
  })
})

describe("runCommand", () => {
  it("returns the exit code of what it ran, in the folder it was told, and null when it did not run", () => {
    expect(runCommand(process.execPath, ["-e", "process.exit(0)"], dir)).toBe(0)
    expect(runCommand(process.execPath, ["-e", "process.exit(3)"], dir)).toBe(3)
    writeFileSync(path.join(dir, "here.txt"), "x")
    expect(
      runCommand(
        process.execPath,
        ["-e", "process.exit(require('fs').existsSync('here.txt') ? 0 : 4)"],
        dir,
      ),
    ).toBe(0)
    expect(runCommand("this-command-does-not-exist-anywhere", [], dir)).toBeNull()
    // Windows reports a command that is not there as exit code 1 together with an error: it did not run.
    expect(
      runCommand("x", [], dir, () => ({ status: 1, error: new Error("spawn x ENOENT") })),
    ).toBeNull()
    expect(runCommand("x", [], dir, () => ({ status: 1, error: null }))).toBe(1)
    expect(runCommand("x", [], dir, () => ({ status: 3 }))).toBe(3)
  })
})
