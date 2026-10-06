import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  bumpFor,
  generateChangesets,
  isPreOne,
} from "../scripts/generate-changeset-from-commits.mjs"

describe("isPreOne()", () => {
  it("reads the major version, whatever it is written as", () => {
    expect(isPreOne("0.9.9")).toBe(true)
    expect(isPreOne("0")).toBe(true)
    expect(isPreOne("1.0.0")).toBe(false)
    expect(isPreOne("01.0.0")).toBe(false)
    expect(isPreOne("10.0.0")).toBe(false)
    expect(isPreOne("2")).toBe(false)
    expect(isPreOne(0.5 as never)).toBe(true)
    expect(isPreOne(undefined as never)).toBe(false)
    expect(isPreOne("x.y.z")).toBe(false)
  })
})

describe("bumpFor() edge cases", () => {
  it("reads the Conventional Commit type only from the very start of the subject", () => {
    expect(bumpFor("feat: x", "")).toBe("minor")
    expect(bumpFor("feat(a-b): x", "")).toBe("minor")
    expect(bumpFor("feat(): x", "")).toBe("minor")
    expect(bumpFor("please fix: x", "")).toBeNull()
    expect(bumpFor(" fix: x", "")).toBeNull()
    expect(bumpFor("fix x", "")).toBeNull()
    expect(bumpFor("fix", "")).toBeNull()
    expect(bumpFor("", "")).toBeNull()
    expect(bumpFor("fix(a)b: x", "")).toBeNull()
  })

  it("treats ! as breaking only straight before the colon", () => {
    expect(bumpFor("fix!: x", "")).toBe("major")
    expect(bumpFor("fix(a)!: x", "")).toBe("major")
    expect(bumpFor("fix!x: x", "")).toBeNull()
  })

  it("reads a BREAKING CHANGE footer and a Changeset trailer from the body", () => {
    expect(bumpFor("fix: x", "BREAKING CHANGE: y")).toBe("major")
    expect(bumpFor("fix: x", "BREAKING CHANGE y")).toBe("patch")
    expect(bumpFor("chore: x", "Changeset: minor")).toBe("minor")
    expect(bumpFor("chore: x", "Changeset:minor")).toBe("minor")
    expect(bumpFor("chore: x", "Changeset: minor  ")).toBe("minor")
    expect(bumpFor("chore: x", "Changeset: minorish")).toBeNull()
    expect(bumpFor("chore: x", "see Changeset: minor")).toBeNull()
    expect(bumpFor("chore: x", "first\nChangeset: major\nlast")).toBe("major")
  })

  it("recognises bot authors by name", () => {
    for (const author of [
      "x[bot]",
      "github-actions",
      "GitHub-Actions[bot]",
      "dependabot",
      "Renovate",
    ])
      expect(bumpFor("fix: x", "", { author }), author).toBeNull()
    for (const author of ["", "someone", "my-github-actions", "not-dependabot", undefined as never])
      expect(bumpFor("fix: x", "", { author }), String(author)).toBe("patch")
  })
})

describe("generateChangesets() output", () => {
  let repo: string
  const lines: string[] = []
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
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
    return git("rev-parse", "HEAD").trim()
  }
  const run = () => {
    lines.length = 0
    return generateChangesets(repo, (line) => lines.push(line))
  }
  /** Runs, then removes what the run wrote so the next commit does not pick it up as its own. */
  const runClean = () => {
    const result = run()
    for (const file of result.files) rmSync(path.join(repo, file))
    rmSync(path.join(repo, ".changeset/.release-bump.json"), { force: true })
    return result
  }
  const read = (rel: string) => readFileSync(path.join(repo, rel), "utf8")
  const pkg = (version: string) => JSON.stringify({ name: "pkg", version })

  beforeEach(() => {
    repo = mkdtempSync(path.join(tmpdir(), "ipc-gen-exact-"))
    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    commit("chore: scaffold", { "package.json": pkg("1.2.0"), ".changeset/config.json": "{}" })
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  it("writes one changeset per release, named for the commit, and reports it exactly", () => {
    const feat = commit("feat: add a thing", { "src/a.ts": "1" })
    const fix = commit("fix: repair it\n\nBody text.", { "src/b.ts": "1" })
    const chore = commit("chore: tidy", { "src/c.ts": "1" })
    const result = run()
    const names = [
      `.changeset/auto-${feat.slice(0, 12)}.md`,
      `.changeset/auto-${fix.slice(0, 12)}.md`,
    ]
    expect(result).toEqual({ generated: 2, files: names })
    expect(read(names[0]!)).toBe('---\n"pkg": minor\n---\n\nfeat: add a thing\n')
    expect(read(names[1]!)).toBe('---\n"pkg": patch\n---\n\nfix: repair it\n')
    expect(lines).toEqual([
      `Generated ${names[0]!} (minor) for ${feat.slice(0, 12)}: feat: add a thing`,
      `Generated ${names[1]!} (patch) for ${fix.slice(0, 12)}: fix: repair it`,
      `Skipped ${chore.slice(0, 12)} (not a release): chore: tidy`,
      "Generated 2 changeset(s) from 3 commit(s) since anchor.",
      "Recorded overall bump severity: minor",
    ])
    expect(read(".changeset/.release-bump.json")).toBe('{ "bump": "minor" }\n')
  })

  it("says so below 1.0.0, and deflates", () => {
    commit("chore: pre-one", { "package.json": pkg("0.3.0") })
    const feat = commit("feat: add", { "src/a.ts": "1" })
    run()
    expect(read(`.changeset/auto-${feat.slice(0, 12)}.md`)).toContain('"pkg": patch')
    expect(lines).toContain("Below 1.0.0: breaking changes bump minor, features bump patch.")
    expect(lines.at(-1)).toBe("Recorded overall bump severity: patch")
  })

  it("records nothing about severity when no changeset exists", () => {
    commit("chore: tidy", { "src/a.ts": "1" })
    expect(run()).toEqual({ generated: 0, files: [] })
    expect(existsSync(path.join(repo, ".changeset/.release-bump.json"))).toBe(false)
    expect(lines.some((line) => line.startsWith("Recorded"))).toBe(false)
    expect(lines).toContain("Generated 0 changeset(s) from 1 commit(s) since anchor.")
  })

  it("works in a repository that has no .changeset folder at all", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "ipc-gen-nodir-"))
    try {
      const g = (...args: string[]) => execFileSync("git", args, { cwd: bare, stdio: "ignore" })
      g("init", "-q", "-b", "main")
      g("config", "user.email", "t@example.com")
      g("config", "user.name", "t")
      writeFileSync(path.join(bare, "package.json"), pkg("1.0.0"))
      g("add", "-A")
      g("commit", "-q", "-m", "chore: first")
      writeFileSync(path.join(bare, "a.txt"), "x")
      g("add", "-A")
      g("commit", "-q", "-m", "chore: second")
      expect(generateChangesets(bare, () => undefined)).toEqual({ generated: 0, files: [] })
      expect(existsSync(path.join(bare, ".changeset"))).toBe(false)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it("reports the highest severity across every changeset in the folder, however they are written", () => {
    commit("chore: add hand-written ones", {
      ".changeset/a.md": '---\n"pkg": major\n---\n\nbig\n',
      ".changeset/b.md": '---\n"pkg": patch\n"other": minor\n---\n\nsmall\n',
    })
    run()
    expect(read(".changeset/.release-bump.json")).toBe('{ "bump": "major" }\n')
    expect(lines.at(-1)).toBe("Recorded overall bump severity: major")
  })

  const severityOf = (files: Record<string, string>) => {
    commit("chore: add changesets", files)
    run()
    return existsSync(path.join(repo, ".changeset/.release-bump.json"))
      ? (JSON.parse(read(".changeset/.release-bump.json")) as { bump: string }).bump
      : null
  }

  it("keeps the highest, not the first or the last", () => {
    expect(
      severityOf({
        ".changeset/a.md": '---\n"p": minor\n---\n',
        ".changeset/b.md": '---\n"p": patch\n---\n',
      }),
    ).toBe("minor")
  })
  it("keeps the highest when it comes last", () => {
    expect(
      severityOf({
        ".changeset/a.md": '---\n"p": patch\n---\n',
        ".changeset/b.md": '---\n"p": minor\n---\n',
      }),
    ).toBe("minor")
  })
  it("keeps a major over a later minor and patch", () => {
    expect(
      severityOf({
        ".changeset/a.md": '---\n"p": major\n---\n',
        ".changeset/b.md": '---\n"p": minor\n---\n',
        ".changeset/c.md": '---\n"p": patch\n---\n',
      }),
    ).toBe("major")
  })
  it("takes a lone patch", () => {
    expect(severityOf({ ".changeset/a.md": '---\n"p": patch\n---\n' })).toBe("patch")
  })

  it("reads bump lines tolerantly, and only inside the frontmatter at the top", () => {
    expect(severityOf({ ".changeset/a.md": '---\n"p":minor\n---\n' })).toBe("minor")
    expect(severityOf({ ".changeset/b.md": '---\n"p":   major   \n---\n' })).toBe("major")
  })
  it("ignores a bump word that is only the start of a longer one", () => {
    expect(severityOf({ ".changeset/a.md": '---\n"p": majority\n---\n' })).toBeNull()
    expect(severityOf({ ".changeset/b.md": '---\n"p": minor x\n---\n' })).toBeNull()
  })
  it("ignores a file whose frontmatter does not open the file", () => {
    expect(severityOf({ ".changeset/a.md": 'intro\n---\n"p": major\n---\n' })).toBeNull()
    expect(severityOf({ ".changeset/b.md": '"p": major\n' })).toBeNull()
    expect(severityOf({ ".changeset/c.md": '---\n"p": major\n' })).toBeNull()
  })
  it("ignores the README, and files that are not markdown, in any case", () => {
    expect(
      severityOf({
        ".changeset/README.md": '---\n"p": major\n---\n',
        ".changeset/readme.md": '---\n"p": major\n---\n',
        ".changeset/notes.txt": '---\n"p": major\n---\n',
        ".changeset/config.json": "{}",
      }),
    ).toBeNull()
  })

  it("counts a commit whose own diff added a changeset as covered, but not the README or lookalikes", () => {
    commit("fix: covered", {
      "src/a.ts": "1",
      ".changeset/mine.md": '---\n"pkg": patch\n---\n\nMine.\n',
    })
    expect(runClean().generated).toBe(0)
    commit("fix: nested counts", { "src/b.ts": "1", ".changeset/sub/deep.md": "x" })
    expect(runClean().generated).toBe(0)
    const readme = commit("fix: readme only", { "src/c.ts": "1", ".changeset/README.md": "x" })
    expect(runClean().files).toContain(`.changeset/auto-${readme.slice(0, 12)}.md`)
    const lookalike = commit("fix: lookalikes", {
      "src/d.ts": "1",
      "docs/.changeset/x.md": "x",
      ".changeset/y.md.bak": "x",
    })
    expect(runClean().files).toContain(`.changeset/auto-${lookalike.slice(0, 12)}.md`)
  })

  it("exempts a commit only when every file it touches is exempt", () => {
    commit("fix: workflow only", { ".github/workflows/x.yml": "1", ".vscode/settings.json": "1" })
    expect(runClean().generated).toBe(0)
    const mixed = commit("fix: workflow and source", {
      ".github/workflows/y.yml": "1",
      "src/a.ts": "1",
    })
    expect(runClean().files).toContain(`.changeset/auto-${mixed.slice(0, 12)}.md`)
    const lookalike = commit("fix: not a prefix", { "x.github/z.yml": "1", ".githubby/z.yml": "1" })
    expect(runClean().files).toContain(`.changeset/auto-${lookalike.slice(0, 12)}.md`)
  })

  it("skips a commit with nothing in it", () => {
    git("commit", "-q", "--allow-empty", "-m", "fix: empty")
    expect(run().generated).toBe(0)
  })

  it("recognises the release commit with or without a pull request number, only exactly", () => {
    commit("feat: before", { "src/a.ts": "1" })
    commit("chore: version packages (#12)", { "package.json": pkg("1.3.0") })
    const after = commit("fix: after", { "src/b.ts": "1" })
    expect(runClean().files).toEqual([`.changeset/auto-${after.slice(0, 12)}.md`])
    commit("chore: version packages", { "package.json": pkg("1.4.0") })
    expect(runClean()).toEqual({ generated: 0, files: [] })
    commit("fix: more", { "src/c.ts": "1" })
    commit("chore: version packagesX", { "src/d.ts": "1" })
    const found = runClean()
    expect(found.generated).toBe(1)
  })

  it("starts from the commit that adopted Changesets when there is no release commit", () => {
    const first = commit("feat: after adoption", { "src/a.ts": "1" })
    expect(run().files).toEqual([`.changeset/auto-${first.slice(0, 12)}.md`])
    expect(lines).toContain("Generated 1 changeset(s) from 1 commit(s) since anchor.")
  })

  it("scans the whole history when nothing anchors it", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "ipc-gen-whole-"))
    try {
      const g = (...args: string[]) => execFileSync("git", args, { cwd: bare, stdio: "ignore" })
      g("init", "-q", "-b", "main")
      g("config", "user.email", "t@example.com")
      g("config", "user.name", "t")
      writeFileSync(path.join(bare, "package.json"), pkg("1.0.0"))
      g("add", "-A")
      g("commit", "-q", "-m", "feat: first")
      writeFileSync(path.join(bare, "a.txt"), "x")
      g("add", "-A")
      g("commit", "-q", "-m", "fix: second")
      const collected: string[] = []
      const result = generateChangesets(bare, (line) => collected.push(line))
      // `git diff-tree` lists nothing for a root commit, so the first commit is never a release.
      expect(result.generated).toBe(1)
      expect(collected).toContain("Generated 1 changeset(s) from 2 commit(s) since anchor.")
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it("never turns a merge commit into a release of its own", () => {
    git("checkout", "-q", "-b", "side")
    const sideCommit = commit("fix: on a branch", { "src/a.ts": "1" })
    git("checkout", "-q", "main")
    commit("chore: on main", { "src/b.ts": "1" })
    git("merge", "-q", "--no-ff", "-m", "Merge branch side", "side")
    const result = run()
    expect(result.files).toEqual([`.changeset/auto-${sideCommit.slice(0, 12)}.md`])
  })

  it("keeps a body that is more than one line, and reads its trailer", () => {
    commit("docs: explain\n\nFirst paragraph.\n\nSecond.\nChangeset: minor", { "docs/a.md": "x" })
    expect(run().generated).toBe(1)
    expect(lines.some((line) => line.includes("(minor)"))).toBe(true)
  })
})
