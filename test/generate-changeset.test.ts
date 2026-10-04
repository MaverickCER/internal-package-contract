import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  bumpFor,
  generateChangesets,
  isPreOne,
} from "../scripts/generate-changeset-from-commits.mjs"

describe("isPreOne()", () => {
  it("is true only below 1.0.0", () => {
    expect(isPreOne("0.8.8")).toBe(true)
    expect(isPreOne("1.0.0")).toBe(false)
    expect(isPreOne("12.2.0")).toBe(false)
  })
})

describe("bumpFor()", () => {
  it("maps feat/fix/perf/revert to minor/patch at 1.0.0 and above", () => {
    expect(bumpFor("feat: add x", "")).toBe("minor")
    expect(bumpFor("fix(scope): y", "")).toBe("patch")
    expect(bumpFor("perf: z", "")).toBe("patch")
    expect(bumpFor("revert: w", "")).toBe("patch")
  })

  it("maps a breaking change to major at 1.0.0 and above, by `!` or by a BREAKING CHANGE footer", () => {
    expect(bumpFor("feat!: drop x", "")).toBe("major")
    expect(bumpFor("fix(api)!: y", "")).toBe("major")
    expect(bumpFor("fix: y", "BREAKING CHANGE: the shape moved")).toBe("major")
    expect(bumpFor("chore!: drop node 20", "")).toBe("major")
  })

  it("DEFLATES one level below 1.0.0, so a stray breaking commit can never publish 1.0.0", () => {
    const pre = { preOne: true }
    expect(bumpFor("feat!: drop x", "", pre)).toBe("minor")
    expect(bumpFor("fix: y", "BREAKING CHANGE: z", pre)).toBe("minor")
    expect(bumpFor("feat: add x", "", pre)).toBe("patch")
    expect(bumpFor("fix: y", "", pre)).toBe("patch")
  })

  it("never turns housekeeping into a release", () => {
    for (const type of ["chore", "ci", "docs", "test", "build", "refactor", "style"]) {
      expect(bumpFor(`${type}: something`, ""), type).toBeNull()
    }
    expect(bumpFor("chore(benchmarks): refresh results.json", "")).toBeNull()
    expect(bumpFor("not a conventional commit", "")).toBeNull()
  })

  it("never lets a bot-authored commit release, even a feat, unless it opts in", () => {
    for (const author of ["dependabot[bot]", "github-actions[bot]", "renovate[bot]"]) {
      expect(bumpFor("fix(deps): bump x", "", { author }), author).toBeNull()
    }
    expect(bumpFor("fix: y", "", { author: "Maverick" })).toBe("patch")
  })

  it("honours an explicit `Changeset:` trailer, even on housekeeping or a bot", () => {
    expect(bumpFor("docs: explain x", "Changeset: patch")).toBe("patch")
    expect(bumpFor("chore: y", "Body.\n\nChangeset: minor")).toBe("minor")
    expect(bumpFor("chore: y", "Changeset: major", { preOne: true })).toBe("major")
    expect(bumpFor("chore: y", "changeset: patch", { author: "dependabot[bot]" })).toBe("patch")
  })
})

describe("generateChangesets() on a real repository", () => {
  let repo: string
  const lines: string[] = []
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" })
  const commit = (
    message: string,
    files: Record<string, string>,
    author = "Maverick <m@example.com>",
  ) => {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true })
      writeFileSync(path.join(repo, rel), text)
    }
    git("add", "-A")
    git("commit", "-q", "--author", author, "-m", message)
  }
  const run = () => {
    lines.length = 0
    return generateChangesets(repo, (line) => lines.push(line))
  }
  const changesets = () =>
    readdirSync(path.join(repo, ".changeset"))
      .filter((f) => f.startsWith("auto-"))
      .sort()

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "ipc-gen-changeset-"))
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    commit("chore: scaffold", {
      "package.json": JSON.stringify({ name: "pkg", version: "0.4.0" }),
      ".changeset/config.json": "{}",
    })
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("writes a changeset only for commits that change what a user gets, deflated below 1.0.0", () => {
    commit("feat: add a thing", { "src/a.ts": "1" })
    commit("fix: repair it", { "src/b.ts": "1" })
    commit("feat!: drop the old thing", { "src/c.ts": "1" })
    commit("chore: tidy", { "src/d.ts": "1" })
    commit("docs: explain", { "README.md": "x" })
    const result = run()
    expect(result.generated).toBe(3)
    const bumps = changesets().map(
      (f) =>
        /: (patch|minor|major)/.exec(readFileSync(path.join(repo, ".changeset", f), "utf8"))?.[1],
    )
    expect(bumps.sort()).toEqual(["minor", "patch", "patch"])
    expect(lines.join("\n")).toContain("Skipped")
    expect(lines.join("\n")).toContain("Below 1.0.0")
    expect(
      JSON.parse(readFileSync(path.join(repo, ".changeset/.release-bump.json"), "utf8")),
    ).toEqual({ bump: "minor" })
  })

  it("never generates for a bot commit, a commit that only touches .github, or one a hand-written changeset covers", () => {
    commit("fix(deps): bump x", { "src/a.ts": "1" }, "dependabot[bot] <b@example.com>")
    commit("fix: workflow", { ".github/workflows/ci.yml": "x" })
    commit("fix: covered", {
      "src/b.ts": "1",
      ".changeset/mine.md": '---\n"pkg": patch\n---\n\nMine.\n',
    })
    expect(run().generated).toBe(0)
  })

  it("honours a Changeset: trailer on housekeeping", () => {
    commit("docs: explain\n\nChangeset: patch", { "README.md": "x" })
    expect(run().generated).toBe(1)
  })

  it("does nothing when HEAD is the release commit itself", () => {
    commit("feat: add", { "src/a.ts": "1" })
    commit("chore: version packages", {
      "package.json": JSON.stringify({ name: "pkg", version: "0.5.0" }),
    })
    expect(run()).toEqual({ generated: 0, files: [] })
    expect(lines).toEqual(["HEAD is the release commit itself -- nothing to generate."])
  })

  it("scans only the commits since the last release commit", () => {
    commit("feat: old", { "src/a.ts": "1" })
    commit("chore: version packages (#3)", {
      "package.json": JSON.stringify({ name: "pkg", version: "0.5.0" }),
    })
    commit("fix: new", { "src/b.ts": "1" })
    const result = run()
    expect(result.generated).toBe(1)
    expect(lines.join("\n")).toContain("fix: new")
    expect(lines.join("\n")).not.toContain("feat: old")
  })

  it("anchors on the commit that adopted Changesets when no release commit exists, and without one scans everything", () => {
    commit("feat: after adoption", { "src/a.ts": "1" })
    expect(run().generated).toBe(1)
    const bare = mkdtempSync(path.join(tmpdir(), "ipc-gen-bare-"))
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: bare })
      execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: bare })
      execFileSync("git", ["config", "user.name", "t"], { cwd: bare })
      writeFileSync(
        path.join(bare, "package.json"),
        JSON.stringify({ name: "bare", version: "1.0.0" }),
      )
      execFileSync("git", ["add", "-A"], { cwd: bare })
      execFileSync("git", ["commit", "-q", "-m", "chore: first"], { cwd: bare })
      writeFileSync(path.join(bare, "a.ts"), "1")
      execFileSync("git", ["add", "-A"], { cwd: bare })
      execFileSync("git", ["commit", "-q", "-m", "feat: second"], { cwd: bare })
      const result = generateChangesets(bare, () => undefined)
      expect(result.generated).toBe(1)
      expect(readFileSync(path.join(bare, result.files[0]!), "utf8")).toContain('"bare": minor')
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})
