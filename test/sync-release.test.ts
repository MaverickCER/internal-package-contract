import { spawnSync } from "node:child_process"
import {
  chmodSync,
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
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { releaseSteps, runRelease } from "../scripts/managed-files/release.mjs"
import { run } from "../scripts/managed-files/sync.mjs"

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..")
const BIN = path.join(PACKAGE_ROOT, "bin", "contract.mjs")
const USAGE =
  "Usage: internal-package-contract sync [--apply [--update]] [--add <copy>] | sync --release\n"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-sync-release-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const manifest = (scripts: Record<string, unknown> = {}, fields: object = {}): void => {
  write("package.json", JSON.stringify({ name: "demo", version: "1.0.0", scripts, ...fields }))
}
/** Runs git in the fixture as a throwaway committer, with no hooks and no signing. */
const git = (...args: string[]): string => {
  const ran = spawnSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: dir, encoding: "utf8" },
  )
  expect(ran.status, `git ${args.join(" ")}: ${ran.stderr}`).toBe(0)
  return ran.stdout
}
/** A package that can release: changesets installed, everything committed. */
const releasable = (scripts: Record<string, unknown> = {}): void => {
  manifest(scripts)
  write("node_modules/@changesets/cli/package.json", JSON.stringify({ name: "@changesets/cli" }))
  write(".gitignore", "node_modules/\n")
  git("init", "-q")
  git("add", "-A")
  git("commit", "-q", "-m", "init")
}
const harness = (failOn?: string, status: number | null = 1) => {
  const out: string[] = []
  const err: string[] = []
  const calls: string[][] = []
  const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }
  const spawn = (command: string, args: string[], cwd: string): number | null => {
    calls.push([command, ...args])
    expect(cwd).toBe(dir)
    return failOn !== undefined && [command, ...args].join(" ").includes(failOn) ? status : 0
  }
  return { out, err, calls, io, spawn }
}

describe("releaseSteps", () => {
  it("versions, updates the lockfile and refreshes the baselines in every package", () => {
    manifest()
    expect(releaseSteps(dir, PACKAGE_ROOT).map(([, command, args]) => [command, ...args])).toEqual([
      ["npx", "--no-install", "changeset", "version"],
      ["npm", "install", "--package-lock-only", "--ignore-scripts"],
      [process.execPath, BIN, "update-baseline"],
    ])
  })

  it("adds the build, goldens, SBOM, skill and site, in that order, where the package has them", () => {
    manifest({ build: "tsup", "examples:update-golden": "node g.mjs", sbom: "node s.mjs" })
    write("docs/skill.json", "{}")
    write("docs/site.json", "{}")
    expect(releaseSteps(dir, PACKAGE_ROOT)).toEqual([
      ["version the package from its changesets", "npx", ["--no-install", "changeset", "version"]],
      [
        "update package-lock.json to the new version",
        "npm",
        ["install", "--package-lock-only", "--ignore-scripts"],
      ],
      ["build the package", "npm", ["run", "build"]],
      ["refresh the API and surface baselines", process.execPath, [BIN, "update-baseline"]],
      ["regenerate the example goldens", "npm", ["run", "examples:update-golden"]],
      ["write the SBOMs", "npm", ["run", "sbom"]],
      ["regenerate the agent skill", process.execPath, [BIN, "skill"]],
      ["regenerate the landing page", process.execPath, [BIN, "site"]],
    ])
  })

  it("leaves out a script that is not a string, and a package.json with no scripts at all", () => {
    manifest({ build: true, sbom: null })
    expect(releaseSteps(dir, PACKAGE_ROOT)).toHaveLength(3)
    write("package.json", JSON.stringify({ name: "demo" }))
    expect(releaseSteps(dir, PACKAGE_ROOT)).toHaveLength(3)
  })

  it("runs skill, site and the SBOMs only for their own file in docs/, not for another one", () => {
    manifest()
    write("docs/site.json", "{}")
    const labels = releaseSteps(dir, PACKAGE_ROOT).map(([label]) => label)
    expect(labels).toContain("regenerate the landing page")
    expect(labels).not.toContain("regenerate the agent skill")
    expect(labels).not.toContain("write the SBOMs")
    rmSync(path.join(dir, "docs"), { recursive: true })
    write("docs/skill.json", "{}")
    const skillOnly = releaseSteps(dir, PACKAGE_ROOT).map(([label]) => label)
    expect(skillOnly).toContain("regenerate the agent skill")
    expect(skillOnly).not.toContain("regenerate the landing page")
  })

  it("writes the SBOMs with `tool sbom` when the package keeps them but has no sbom script", () => {
    const sbomStep = ["write the SBOMs", process.execPath, [BIN, "tool", "sbom"]]
    manifest()
    write("docs/sbom.cdx.json", "{}")
    expect(releaseSteps(dir, PACKAGE_ROOT)).toContainEqual(sbomStep)
    rmSync(path.join(dir, "docs"), { recursive: true })
    manifest({}, { "internal-package-contract": { checks: ["Sbom"] } })
    expect(releaseSteps(dir, PACKAGE_ROOT).at(-1)).toEqual(sbomStep)
  })

  it("prefers the package's own sbom script, and writes no SBOM for a package that keeps none", () => {
    manifest({ sbom: "node s.mjs" }, { "internal-package-contract": { checks: ["Sbom"] } })
    write("docs/sbom.cdx.json", "{}")
    const sboms = releaseSteps(dir, PACKAGE_ROOT).filter(([label]) => label === "write the SBOMs")
    expect(sboms).toEqual([["write the SBOMs", "npm", ["run", "sbom"]]])
    rmSync(path.join(dir, "docs"), { recursive: true })
    for (const checks of [["AgentSkill"], "Sbom", undefined]) {
      manifest({}, { "internal-package-contract": { checks } })
      expect(releaseSteps(dir, PACKAGE_ROOT).map(([label]) => label)).not.toContain(
        "write the SBOMs",
      )
    }
  })
})

describe("runRelease", () => {
  it("runs every step in the package's root, names each, and exits 0", () => {
    releasable({ build: "tsup" })
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(0)
    expect(h.calls).toEqual([
      ["npx", "--no-install", "changeset", "version"],
      ["npm", "install", "--package-lock-only", "--ignore-scripts"],
      ["npm", "run", "build"],
      [process.execPath, BIN, "update-baseline"],
    ])
    expect(h.out.join("")).toBe(
      [
        "[sync] version the package from its changesets",
        "[sync] update package-lock.json to the new version",
        "[sync] build the package",
        "[sync] refresh the API and surface baselines",
        "[sync] done. Review the release's changes before they are committed.",
        "",
      ].join("\n"),
    )
    expect(h.err).toEqual([])
  })

  it("stops at the first failing step, runs nothing after it, and exits 1", () => {
    releasable({ build: "tsup" })
    const h = harness("run build")
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.calls.at(-1)).toEqual(["npm", "run", "build"])
    expect(h.calls).toHaveLength(3)
    expect(h.err.join("")).toBe(
      '[sync] stopped: "build the package" failed. Nothing is committed, and the run changed no file.\n',
    )
    expect(h.out.join("")).not.toContain("done")
  })

  it("names only the files the failed run touched, and how to undo each kind", () => {
    releasable()
    write(".changeset/one.md", "---\n---\n")
    git("add", "-A")
    git("commit", "-q", "-m", "changeset")
    const h = harness("update-baseline")
    const spawn = (command: string, args: string[], cwd: string): number | null => {
      if (args.includes("version")) {
        manifest({}, { version: "1.1.0" })
        rmSync(path.join(dir, ".changeset/one.md"))
        write("CHANGELOG.md", "# demo\n")
        write("NOTES.md", "x")
      }
      return h.spawn(command, args, cwd)
    }
    expect(runRelease(dir, PACKAGE_ROOT, h.io, spawn)).toBe(1)
    const advice = h.err.join("")
    expect(advice).toBe(
      [
        '[sync] stopped: "refresh the API and surface baselines" failed. Nothing is committed.',
        "The run changed these files: .changeset/one.md, package.json.",
        "Undo that with: git restore -- .changeset/one.md package.json",
        "It also created: CHANGELOG.md, NOTES.md. Delete them to undo it.",
        "",
      ].join("\n"),
    )
    expect(advice).not.toContain("git restore .\n")
    expect(advice).not.toContain("git restore . ")
  })

  it("quotes a changed path the shell would split, and names created files on their own", () => {
    releasable()
    const names = ["a b.txt", "it's.txt", "@s/a-b+c_1.txt"]
    for (const name of names) write(name, "1")
    git("add", "-A")
    git("commit", "-q", "-m", "odd names")
    const h = harness("changeset")
    const edit = (command: string, args: string[], cwd: string): number | null => {
      for (const name of names) write(name, "2")
      return h.spawn(command, args, cwd)
    }
    expect(runRelease(dir, PACKAGE_ROOT, h.io, edit)).toBe(1)
    expect(h.err.join("")).toBe(
      [
        '[sync] stopped: "version the package from its changesets" failed. Nothing is committed.',
        "The run changed these files: @s/a-b+c_1.txt, a b.txt, it's.txt.",
        "Undo that with: git restore -- @s/a-b+c_1.txt 'a b.txt' 'it'\\''s.txt'",
        "",
      ].join("\n"),
    )
    git("restore", "--", ...names)
    const created = harness("changeset")
    const add = (command: string, args: string[], cwd: string): number | null => {
      write("new/one.txt", "x")
      return created.spawn(command, args, cwd)
    }
    expect(runRelease(dir, PACKAGE_ROOT, created.io, add)).toBe(1)
    expect(created.err.join("")).toBe(
      '[sync] stopped: "version the package from its changesets" failed. Nothing is committed.\nThe run created: new. Delete them to undo it.\n',
    )
  })

  it("names paths from the package's own folder when it is not the repository's root", () => {
    releasable()
    const root = dir
    dir = path.join(root, "packages", "demo")
    try {
      manifest()
      write("node_modules/@changesets/cli/package.json", "{}")
      git("add", "-A")
      git("commit", "-q", "-m", "nested")
      const h = harness("changeset")
      const edit = (command: string, args: string[], cwd: string): number | null => {
        manifest({}, { version: "2.0.0" })
        writeFileSync(path.join(root, "package.json"), "{}")
        return h.spawn(command, args, cwd)
      }
      expect(runRelease(dir, PACKAGE_ROOT, h.io, edit)).toBe(1)
      expect(h.err.join("")).toContain(
        "Undo that with: git restore -- ../../package.json package.json\n",
      )
    } finally {
      dir = root
    }
  })

  it("counts a command that did not run to the end as a failure", () => {
    releasable()
    const h = harness("changeset", null)
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.calls).toHaveLength(1)
  })

  it("refuses a package.json that is not JSON, before running anything", () => {
    write("package.json", "{ not json")
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toMatch(/^\[sync\] package\.json is not valid JSON: /)
    expect(h.calls).toEqual([])
  })

  it("says package.json is missing, not that it is invalid, when there is none", () => {
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      "[sync] there is no package.json here; run it from the package's root.\n",
    )
    expect(h.calls).toEqual([])
  })

  it("refuses to start on a tree with uncommitted changes, naming them, and runs nothing", () => {
    releasable()
    manifest({ build: "edited" })
    write("notes.txt", "mine")
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      "[sync] commit or stash these first, so a failed run can be undone without losing them:\n- notes.txt\n- package.json\n",
    )
    expect(h.calls).toEqual([])
    expect(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).scripts).toEqual({
      build: "edited",
    })
  })

  it("lists both sides of a staged rename as whole paths", () => {
    releasable()
    write("CODEOWNERS", "* @a\n")
    git("add", "-A")
    git("commit", "-q", "-m", "owners")
    git("mv", "CODEOWNERS", "CODEOWNERS2")
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      "[sync] commit or stash these first, so a failed run can be undone without losing them:\n- CODEOWNERS\n- CODEOWNERS2\n",
    )
  })

  it("runs past the pending changesets the release workflow generates, and exits 0", () => {
    releasable()
    write(".changeset/config.json", "{}\n")
    write(".changeset/README.md", "# changesets\n")
    write(".changeset/.release-bump.json", '{ "bump": "patch" }\n')
    write(".changeset/old.md", "---\n---\n")
    write(".changeset/gone.md", "---\n---\n")
    write(".changeset/moved.md", "---\n---\n")
    git("add", "-A")
    git("commit", "-q", "-m", "changesets")
    write(".changeset/gen.md", '---\n"demo": minor\n---\n\nfeat: x\n')
    write(".changeset/.release-bump.json", '{ "bump": "minor" }\n')
    write(".changeset/old.md", "---\n---\n\nedited\n")
    rmSync(path.join(dir, ".changeset/gone.md"))
    git("mv", ".changeset/moved.md", ".changeset/renamed.md")
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(0)
    expect(h.calls).toHaveLength(3)
    expect(h.err).toEqual([])
  })

  // In a child process with a time limit: a read of /dev/zero never ends, and would hang this worker.
  it.skipIf(process.platform === "win32")(
    "finishes with a pending changeset that links to an endless device, without reading through the link",
    () => {
      releasable()
      write(".changeset/config.json", "{}\n")
      git("add", "-A")
      git("commit", "-q", "-m", "changesets")
      symlinkSync("/dev/zero", path.join(dir, ".changeset", "linked.md"))
      const release = pathToFileURL(
        path.join(PACKAGE_ROOT, "scripts", "managed-files", "release.mjs"),
      )
      // The paths arrive as arguments, never spliced into the code.
      const script = [
        `const { runRelease } = await import(process.argv[1])`,
        `const io = { out: () => {}, err: (text) => process.stderr.write(text) }`,
        `process.exitCode = runRelease(process.argv[2], process.argv[3], io, () => 0)`,
      ].join("\n")
      const args = ["--input-type=module", "-e", script, release.href, dir, PACKAGE_ROOT]
      const ran = spawnSync(process.execPath, args, {
        encoding: "utf8",
        timeout: 15_000,
      })
      expect(ran.signal).toBeNull()
      expect(ran.stderr).toBe("")
      expect(ran.status).toBe(0)
    },
    30_000,
  )

  it("still refuses changes to the changesets' own README and config, and to nested files", () => {
    // release-notes.md: a path outside .changeset/ whose tail past that prefix's length looks like a changeset.
    for (const file of [
      ".changeset/README.md",
      ".changeset/config.json",
      ".changeset/sub/a.md",
      "release-notes.md",
    ]) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir)
      releasable()
      write(".changeset/README.md", "# changesets\n")
      write(".changeset/config.json", "{}\n")
      write(".changeset/sub/a.md", "---\n---\n")
      git("add", "-A")
      git("commit", "-q", "-m", "changesets")
      write(file, "edited\n")
      const h = harness()
      expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn), file).toBe(1)
      expect(h.err.join(""), file).toBe(
        `[sync] commit or stash these first, so a failed run can be undone without losing them:\n- ${file}\n`,
      )
      expect(h.calls).toEqual([])
    }
  })

  it("refuses a .changeset folder git does not track yet, which it lists as one path", () => {
    releasable()
    write(".changeset/gen.md", "---\n---\n")
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      "[sync] commit or stash these first, so a failed run can be undone without losing them:\n- .changeset\n",
    )
  })

  it("names a pending changeset the failed run consumed, and says git restore cannot bring it back", () => {
    releasable()
    write(".changeset/config.json", "{}\n")
    write(".changeset/.release-bump.json", '{ "bump": "patch" }\n')
    git("add", "-A")
    git("commit", "-q", "-m", "changesets")
    write(".changeset/gen.md", '---\n"demo": minor\n---\n\nfeat: x\n')
    write(".changeset/kept.md", '---\n"demo": patch\n---\n\nfix: y\n')
    write(".changeset/.release-bump.json", '{ "bump": "minor" }\n')
    const h = harness("update-baseline")
    const spawn = (command: string, args: string[], cwd: string): number | null => {
      if (args.includes("version")) {
        manifest({}, { version: "1.1.0" })
        rmSync(path.join(dir, ".changeset/gen.md"))
        write(".changeset/kept.md", "rewritten\n")
        write("CHANGELOG.md", "# demo\n")
      }
      return h.spawn(command, args, cwd)
    }
    expect(runRelease(dir, PACKAGE_ROOT, h.io, spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      [
        '[sync] stopped: "refresh the API and surface baselines" failed. Nothing is committed.',
        "The run changed these files: package.json.",
        "Undo that with: git restore -- package.json",
        "It also created: CHANGELOG.md. Delete them to undo it.",
        "It also changed or deleted these uncommitted changesets: .changeset/gen.md, .changeset/kept.md.",
        "`changeset version` deletes the changesets it consumes, and git restore cannot bring back uncommitted ones. Generate or write them again.",
        "",
      ].join("\n"),
    )
  })

  it("names only the consumed changesets when the failed run changed nothing else", () => {
    releasable()
    write(".changeset/config.json", "{}\n")
    git("add", "-A")
    git("commit", "-q", "-m", "changesets")
    write(".changeset/gen.md", "---\n---\n")
    const h = harness("changeset")
    const spawn = (command: string, args: string[], cwd: string): number | null => {
      rmSync(path.join(dir, ".changeset/gen.md"))
      return h.spawn(command, args, cwd)
    }
    expect(runRelease(dir, PACKAGE_ROOT, h.io, spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      [
        '[sync] stopped: "version the package from its changesets" failed. Nothing is committed.',
        "The run changed or deleted these uncommitted changesets: .changeset/gen.md.",
        "`changeset version` deletes the changesets it consumes, and git restore cannot bring back uncommitted ones. Generate or write them again.",
        "",
      ].join("\n"),
    )
  })

  it("leaves out the pending changesets a failed run did not touch", () => {
    releasable()
    write(".changeset/config.json", "{}\n")
    git("add", "-A")
    git("commit", "-q", "-m", "changesets")
    write(".changeset/gen.md", "---\n---\n")
    const h = harness("changeset")
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      '[sync] stopped: "version the package from its changesets" failed. Nothing is committed, and the run changed no file.\n',
    )
  })

  it("refuses to start outside a git repository, since nothing could undo a failed run", () => {
    manifest()
    write("node_modules/@changesets/cli/package.json", "{}")
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      "[sync] --release runs in a git repository, so a failed run can be undone. This directory is not in one.\n",
    )
    expect(h.calls).toEqual([])
  })

  it("names @changesets/cli when it is not installed, instead of npm's own error", () => {
    releasable()
    rmSync(path.join(dir, "node_modules"), { recursive: true })
    const h = harness()
    expect(runRelease(dir, PACKAGE_ROOT, h.io, h.spawn)).toBe(1)
    expect(h.err.join("")).toBe(
      "[sync] @changesets/cli is not installed here. Add it as a dev dependency (npm install --save-dev @changesets/cli), then run sync --release again.\n",
    )
    expect(h.calls).toEqual([])
  })
})

describe("sync --release", () => {
  it("runs the release steps instead of comparing the managed files", () => {
    releasable()
    const h = harness()
    expect(run(["--release"], dir, PACKAGE_ROOT, h.io, undefined, { spawn: h.spawn })).toBe(0)
    expect(h.calls[0]).toEqual(["npx", "--no-install", "changeset", "version"])
    expect(h.out.join("")).not.toMatch(/^(current|missing|drifted) /m)
  })

  it("passes on a failing step's exit code", () => {
    releasable()
    const h = harness("update-baseline")
    expect(run(["--release"], dir, PACKAGE_ROOT, h.io, undefined, { spawn: h.spawn })).toBe(1)
  })

  it("exits 2, running nothing, when combined with --apply, --update or --add", () => {
    manifest()
    for (const argv of [
      ["--release", "--apply"],
      ["--apply", "--release"],
      ["--release", "--apply", "--update"],
      ["--release", "--add", "ci-jobs-test"],
    ]) {
      const h = harness()
      expect(
        run(argv, dir, PACKAGE_ROOT, h.io, undefined, { spawn: h.spawn }),
        argv.join(" "),
      ).toBe(2)
      expect(h.err.join("")).toBe(
        `[sync] --release runs alone: it cannot be combined with --apply, --update or --add.\n${USAGE}`,
      )
      expect(h.calls).toEqual([])
    }
    expect(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))).toEqual({
      name: "demo",
      version: "1.0.0",
      scripts: {},
    })
  })

  it("exits 2 with no package.json here", () => {
    const h = harness()
    expect(run(["--release"], dir, PACKAGE_ROOT, h.io, undefined, { spawn: h.spawn })).toBe(2)
    expect(h.err.join("")).toBe(
      "[sync] there is no package.json here; run it from the package's root.\n",
    )
    expect(h.calls).toEqual([])
  })

  it("still refuses an unknown argument next to it", () => {
    manifest()
    const h = harness()
    expect(
      run(["--release", "--nope"], dir, PACKAGE_ROOT, h.io, undefined, { spawn: h.spawn }),
    ).toBe(2)
    expect(h.err.join("")).toBe(`[sync] unknown argument: --nope\n${USAGE}`)
  })
})

describe("the release workflow's version job", () => {
  // A `changeset` stand-in that does what `changeset version` does to a single package: bump the version, write
  // the changelog and delete each changeset it consumed.
  const STUB = `#!/usr/bin/env node
const fs = require("node:fs")
const pending = fs.readdirSync(".changeset").filter((f) => f.endsWith(".md") && f !== "README.md")
const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"))
manifest.version = "1.1.0"
fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\\n")
fs.writeFileSync("CHANGELOG.md", "# demo\\n\\n" + pending.map((f) => fs.readFileSync(".changeset/" + f, "utf8")).join(""))
for (const f of pending) fs.rmSync(".changeset/" + f)
`
  const node = (args: string[]) =>
    spawnSync(process.execPath, args, {
      cwd: dir,
      encoding: "utf8",
      // npm must not reach the registry: the fixture has no dependencies to fetch or audit.
      env: {
        ...process.env,
        npm_config_offline: "true",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      },
    })

  it("generates changesets for a feat commit, then runs sync --release to the end", () => {
    manifest()
    write(".gitignore", "node_modules/\n")
    write(".changeset/config.json", "{}\n")
    write(".changeset/README.md", "# changesets\n")
    write("node_modules/@changesets/cli/package.json", JSON.stringify({ name: "@changesets/cli" }))
    write("node_modules/.bin/changeset", STUB)
    chmodSync(path.join(dir, "node_modules/.bin/changeset"), 0o755)
    git("init", "-q")
    git("add", "-A")
    git("commit", "-q", "-m", "chore: adopt changesets")
    write("src/a.txt", "a\n")
    git("add", "-A")
    git("commit", "-q", "-m", "feat: add a")

    const generated = node([
      path.join(PACKAGE_ROOT, "scripts", "generate-changeset-from-commits.mjs"),
    ])
    expect(generated.status, generated.stderr).toBe(0)
    expect(git("status", "--porcelain")).toMatch(/^\?\? \.changeset\/auto-[0-9a-f]{12}\.md$/m)
    expect(readFileSync(path.join(dir, ".changeset/.release-bump.json"), "utf8")).toBe(
      '{ "bump": "minor" }\n',
    )

    const released = node([BIN, "sync", "--release"])
    expect(released.stderr).toBe("")
    expect(released.status).toBe(0)
    expect(released.stdout).toContain(
      "[sync] done. Review the release's changes before they are committed.\n",
    )
    expect(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version).toBe("1.1.0")
    expect(readFileSync(path.join(dir, "CHANGELOG.md"), "utf8")).toContain("feat: add a")
    expect(existsSync(path.join(dir, "package-lock.json"))).toBe(true)
    expect(git("status", "--porcelain")).not.toContain("auto-")
  }, 60_000)
})

describe("the version scripts", () => {
  const scriptsOf = (file: string): Record<string, string> =>
    (
      JSON.parse(readFileSync(path.join(PACKAGE_ROOT, file), "utf8")) as {
        scripts: Record<string, string>
      }
    ).scripts

  it("is one command in a scaffolded package", () => {
    expect(scriptsOf("template/package/package.json")["version"]).toBe(
      "internal-package-contract sync --release",
    )
  })

  it("stays this repository's own in this repository, which has no build and runs its bin directly", () => {
    expect(scriptsOf("package.json")["version"]).toBe(
      "changeset version && npm install --package-lock-only --ignore-scripts && node bin/contract.mjs update-baseline",
    )
  })
})
