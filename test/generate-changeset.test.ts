import { describe, expect, it } from "vitest"
import { bumpFor, isPreOne } from "../scripts/generate-changeset-from-commits.mjs"

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
