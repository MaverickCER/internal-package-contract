import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { declaredLevelFromChangesets } from "../scripts/api-contract/changesets.js"
import { maxLevel, rankAtLeast } from "../scripts/api-contract/levels.js"
import {
  compareVersions,
  computeMinimumRequiredVersion,
  formatVersion,
  parseVersion,
} from "../scripts/api-contract/semver.js"
import {
  summarizeChanges,
  summarizeLowerTierChanges,
} from "../scripts/api-contract/summarize-changes.js"

const LEVELS = ["none", "patch", "minor", "major"] as const

describe("levels", () => {
  it("maxLevel is the larger of any two, and a missing one is the identity", () => {
    for (const [i, a] of LEVELS.entries())
      for (const [j, b] of LEVELS.entries()) expect(maxLevel(a, b)).toBe(LEVELS[Math.max(i, j)])
    for (const level of LEVELS) {
      expect(maxLevel(level, undefined)).toBe(level)
      expect(maxLevel(undefined, level)).toBe(level)
    }
    expect(maxLevel(undefined, undefined)).toBeUndefined()
  })

  it("rankAtLeast holds exactly when declared is as large as required", () => {
    for (const [i, declared] of LEVELS.entries())
      for (const [j, required] of LEVELS.entries())
        expect(rankAtLeast(declared, required), `${declared} vs ${required}`).toBe(i >= j)
  })
})

describe("semver", () => {
  it("parses a strict triple, tolerating a suffix and outer whitespace, and rejects the rest", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion("  10.20.30  ")).toEqual({ major: 10, minor: 20, patch: 30 })
    expect(parseVersion("0.1.0-rc.1")).toEqual({ major: 0, minor: 1, patch: 0 })
    expect(parseVersion("0.1.0+build.5")).toEqual({ major: 0, minor: 1, patch: 0 })
    for (const bad of ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "", "a1.2.3", "1.2.3 4"])
      expect(parseVersion(bad), bad).toBeUndefined()
  })

  it("orders by major, then minor, then patch, returning the difference", () => {
    const v = (major: number, minor: number, patch: number) => ({ major, minor, patch })
    expect(compareVersions(v(2, 0, 0), v(1, 9, 9))).toBe(1)
    expect(compareVersions(v(1, 9, 9), v(2, 0, 0))).toBe(-1)
    expect(compareVersions(v(5, 0, 0), v(2, 9, 9))).toBe(3)
    expect(compareVersions(v(1, 3, 0), v(1, 1, 9))).toBe(2)
    expect(compareVersions(v(1, 1, 0), v(1, 3, 9))).toBe(-2)
    expect(compareVersions(v(1, 1, 7), v(1, 1, 2))).toBe(5)
    expect(compareVersions(v(1, 1, 2), v(1, 1, 7))).toBe(-5)
    expect(compareVersions(v(1, 1, 1), v(1, 1, 1))).toBe(0)
  })

  it("formats a version", () => {
    expect(formatVersion({ major: 1, minor: 20, patch: 3 })).toBe("1.20.3")
  })

  it("derives the minimum version from a baseline and a level", () => {
    const base = { major: 1, minor: 2, patch: 3 }
    expect(computeMinimumRequiredVersion(base, "none")).toBe("1.2.3")
    expect(computeMinimumRequiredVersion(base, "patch")).toBe("1.2.4")
    expect(computeMinimumRequiredVersion(base, "minor")).toBe("1.3.0")
    expect(computeMinimumRequiredVersion(base, "major")).toBe("2.0.0")
    for (const level of LEVELS)
      expect(computeMinimumRequiredVersion(undefined, level)).toBe("0.1.0")
  })
})

describe("summaries", () => {
  const change = (explanation: string) => ({ explanation }) as never

  it("explains an initial baseline, no change, and a list of changes", () => {
    expect(summarizeChanges([], "unchanged", true)).toBe(
      "No historical public API contract exists for this target. This run establishes the initial contract baseline; v0.1.0 is recommended as the initial package version.",
    )
    expect(summarizeChanges([], "unchanged", false)).toBe("No public API changes detected.")
    expect(summarizeChanges([change("a"), change("b")], "breaking", false)).toBe(
      "2 public contract change(s) detected:\n- a\n- b",
    )
    expect(summarizeChanges([change("c")], "unknown", false)).toBe(
      "The public contract changed, but one or more changes could not be classified deterministically:\n- c",
    )
  })

  it("labels changes below the release tag as informational, or says nothing", () => {
    expect(summarizeLowerTierChanges([])).toBeUndefined()
    expect(summarizeLowerTierChanges([change("x"), change("y")])).toBe(
      "2 non-public contract change(s) also detected (informational only -- does not affect the required release level):\n- x\n- y",
    )
  })
})

describe("changesets", () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ipc-changesets-exact-"))
    mkdirSync(path.join(root, ".changeset"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const put = (name: string, text: string) =>
    writeFileSync(path.join(root, ".changeset", name), text)

  it("counts only .md files that name the package, and keeps the largest bump", async () => {
    put("a.md", '---\n"pkg": patch\n---\n\nfix\n')
    put("b.md", "---\n'pkg': minor\nother: major\n---\n")
    put("c.md", "---\nother: major\n---\n")
    put("README.md", '---\n"pkg": major\n---\n')
    put("notes.txt", '---\n"pkg": major\n---\n')
    put("d.markdown", '---\n"pkg": major\n---\n')
    expect(await declaredLevelFromChangesets(root, "pkg")).toEqual({
      changesetCount: 2,
      declaredLevel: "minor",
    })
  })

  it("needs frontmatter that opens on the first line and closes, reading CRLF files too", async () => {
    put("no-open.md", 'text\n---\n"pkg": major\n---\n')
    put("no-close.md", '---\n"pkg": major\n')
    put("crlf.md", '---\r\n"pkg": patch\r\n---\r\n')
    put("spaced.md", ' ---\n  "pkg" : minor  \n ---\n')
    expect(await declaredLevelFromChangesets(root, "pkg")).toEqual({
      changesetCount: 2,
      declaredLevel: "minor",
    })
  })

  it("matches the package name exactly, quoted or not, and only major, minor or patch", async () => {
    put("a.md", "---\n@scope/pkg: patch\n---\n")
    put("b.md", "---\n@scope/pkg2: major\n---\n")
    put("c.md", "---\n@scope/pkg: huge\n---\n")
    expect(await declaredLevelFromChangesets(root, "@scope/pkg")).toEqual({
      changesetCount: 1,
      declaredLevel: "patch",
    })
  })

  it("is none for no pending changesets, or no changeset directory at all", async () => {
    expect(await declaredLevelFromChangesets(root, "pkg")).toEqual({
      changesetCount: 0,
      declaredLevel: "none",
    })
    expect(await declaredLevelFromChangesets(path.join(root, "absent"), "pkg")).toEqual({
      changesetCount: 0,
      declaredLevel: "none",
    })
  })

  it("reads non-ASCII changeset text", async () => {
    put("a.md", '---\n"pkg": patch\n---\n\nfixé\n')
    expect((await declaredLevelFromChangesets(root, "pkg")).changesetCount).toBe(1)
  })
})
