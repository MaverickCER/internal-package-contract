import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { baselinesEditedWithoutRelease } from "../scripts/baseline-guard.mjs"

let root: string
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
const write = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}
const SURFACE = ".repo-contract/surface-contract/baseline.json"
const META = ".repo-contract/api-contract/index/baseline.meta.json"
const API = ".repo-contract/api-contract/index/baseline.api.json"
const surface = (version: string, body = "a"): string =>
  JSON.stringify({ packageVersion: version, surface: body })

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "baseline-guard-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  git("config", "commit.gpgsign", "false")
  write("package.json", JSON.stringify({ name: "p", version: "1.0.0" }))
  write(SURFACE, surface("1.0.0"))
  write(META, JSON.stringify({ packageVersion: "1.0.0" }))
  write(API, '{"api":1}')
  git("add", "-A")
  git("commit", "-q", "-m", "base", "--no-verify")
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  git("checkout", "-q", "-b", "feature")
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const judge = (
  version: string,
  current: Record<string, string>,
  env: Record<string, string> = {},
) =>
  baselinesEditedWithoutRelease({
    cwd: root,
    version,
    env,
    baselines: [
      { path: SURFACE, versionFile: SURFACE, current: current[SURFACE] },
      { path: API, versionFile: META, current: current[API] },
    ],
  })

describe("baselinesEditedWithoutRelease", () => {
  it("names each baseline a branch rewrote while keeping the base's version", () => {
    write("x.txt", "change")
    git("add", "-A")
    git("commit", "-q", "-m", "work", "--no-verify")
    expect(judge("1.0.0", { [SURFACE]: surface("1.0.0", "b"), [API]: '{"api":2}' })).toEqual({
      compared: true,
      edited: [SURFACE, API],
    })
    expect(judge("1.0.0", { [SURFACE]: surface("1.0.0"), [API]: '{"api":1}' })).toEqual({
      compared: true,
      edited: [],
    })
  })

  it("allows a release (a new version on the release branch), a baseline the base lacked, and a base baseline that was stale", () => {
    write("x.txt", "change")
    git("add", "-A")
    git("commit", "-q", "-m", "work", "--no-verify")
    const bumped = { [SURFACE]: surface("1.1.0", "b"), [API]: '{"api":2}' }
    expect(judge("1.1.0", bumped, { GITHUB_HEAD_REF: "changeset-release/main" }).edited).toEqual([])
    // Off the release branch a new version is not a release: the rewritten baselines are refused.
    expect(judge("1.1.0", bumped).edited).toEqual([SURFACE, API])
    expect(judge("1.1.0", bumped, { GITHUB_HEAD_REF: "feature" }).edited).toEqual([SURFACE, API])
    rmSync(path.join(root, ".repo-contract"), { recursive: true })
    git("checkout", "-q", "main")
    write(SURFACE, surface("0.9.0"))
    write(META, JSON.stringify({ packageVersion: "0.9.0" }))
    git("add", "-A")
    git("commit", "-q", "-m", "stale base", "--no-verify")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "-b", "refresh")
    write("y.txt", "1")
    git("add", "-A")
    git("commit", "-q", "-m", "refresh", "--no-verify")
    expect(judge("1.0.0", { [SURFACE]: surface("1.0.0", "b"), [API]: '{"api":2}' }).edited).toEqual(
      [],
    )
    // Refreshing a stale baseline does not also excuse a version change made off the release branch.
    // (This base has no API baseline, so only the surface one is judged.)
    expect(judge("1.1.0", { [SURFACE]: surface("1.1.0", "b"), [API]: '{"api":2}' }).edited).toEqual(
      [SURFACE],
    )
    const fresh = baselinesEditedWithoutRelease({
      cwd: root,
      version: "1.0.0",
      env: {},
      baselines: [{ path: "new/baseline.json", versionFile: "new/baseline.json", current: "{}" }],
    })
    expect(fresh).toEqual({ compared: true, edited: [] })
  })

  it("trusts the release branch name only when a pull request's head is in this repository", () => {
    write("x.txt", "change")
    git("add", "-A")
    git("commit", "-q", "-m", "work", "--no-verify")
    const bumped = { [SURFACE]: surface("1.1.0", "b"), [API]: '{"api":2}' }
    const payload = (event: unknown): string => {
      const file = path.join(root, "event.json")
      writeFileSync(file, typeof event === "string" ? event : JSON.stringify(event))
      return file
    }
    const pullRequestFrom = (fullName: string): string =>
      payload({ pull_request: { head: { repo: { full_name: fullName } } } })
    const release = (eventPath: string): Record<string, string> => ({
      GITHUB_HEAD_REF: "changeset-release/main",
      GITHUB_REPOSITORY: "owner/package",
      GITHUB_EVENT_PATH: eventPath,
    })
    // A fork can name its branch like the release branch: its baseline edits are refused.
    expect(judge("1.1.0", bumped, release(pullRequestFrom("someone/package"))).edited).toEqual([
      SURFACE,
      API,
    ])
    // A payload with no head repository is not proof of a same-repository branch either.
    expect(judge("1.1.0", bumped, release(payload({ pull_request: {} }))).edited).toEqual([
      SURFACE,
      API,
    ])
    expect(judge("1.1.0", bumped, release(pullRequestFrom("owner/package"))).edited).toEqual([])
    // Without a pull request payload (a push or a dispatch, or no file), the branch name decides.
    expect(judge("1.1.0", bumped, release(payload({ ref: "refs/heads/x" }))).edited).toEqual([])
    expect(judge("1.1.0", bumped, release(path.join(root, "missing.json"))).edited).toEqual([])
    expect(judge("1.1.0", bumped, release(payload("{not json"))).edited).toEqual([])
    expect(judge("1.1.0", bumped, release(payload("null"))).edited).toEqual([])
    // A head with no repository is not proof either.
    expect(judge("1.1.0", bumped, release(payload({ pull_request: { head: {} } }))).edited).toEqual(
      [SURFACE, API],
    )
    expect(
      judge("1.1.0", bumped, { GITHUB_HEAD_REF: "changeset-release/main", GITHUB_EVENT_PATH: "" })
        .edited,
    ).toEqual([])
  })

  it("reads the release branch from git when GITHUB_HEAD_REF is unset, and needs the version to change there too", () => {
    git("checkout", "-q", "-b", "changeset-release/main")
    write("x.txt", "change")
    git("add", "-A")
    git("commit", "-q", "-m", "work", "--no-verify")
    const rewritten = { [SURFACE]: surface("1.1.0", "b"), [API]: '{"api":2}' }
    expect(judge("1.1.0", rewritten)).toEqual({ compared: true, edited: [] })
    // The release branch keeping the base's version is no release: its rewritten baselines are refused.
    expect(judge("1.0.0", rewritten)).toEqual({ compared: true, edited: [SURFACE, API] })
  })

  it("treats a base baseline whose version file is missing as stale, so rewriting it is allowed", () => {
    git("checkout", "-q", "main")
    rmSync(path.join(root, META))
    git("add", "-A")
    git("commit", "-q", "-m", "no meta", "--no-verify")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "-b", "refresh")
    write("x.txt", "change")
    git("add", "-A")
    git("commit", "-q", "-m", "work", "--no-verify")
    expect(judge("1.0.0", { [SURFACE]: surface("1.0.0"), [API]: '{"api":2}' })).toEqual({
      compared: true,
      edited: [],
    })
  })

  it("keeps git's error output off this process's stderr", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "baseline-guard-quiet-"))
    const stderr = vi.spyOn(process.stderr, "write")
    try {
      baselinesEditedWithoutRelease({ cwd: outside, version: "1.0.0", env: {}, baselines: [] })
      expect(stderr).not.toHaveBeenCalled()
    } finally {
      stderr.mockRestore()
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("compares nothing on the base branch itself, and says so when the base ref is missing", () => {
    git("checkout", "-q", "main")
    expect(judge("1.0.0", { [SURFACE]: "changed" })).toEqual({ compared: true, edited: [] })
    expect(judge("1.0.0", { [SURFACE]: "changed" }, { GITHUB_BASE_REF: "release" })).toEqual({
      compared: false,
      edited: [],
    })
  })

  it("follows GITHUB_BASE_REF, and gives up when the base's package.json is unreadable", () => {
    git("branch", "release", "main")
    git("update-ref", "refs/remotes/origin/release", "main")
    write("x.txt", "change")
    git("add", "-A")
    git("commit", "-q", "-m", "work", "--no-verify")
    expect(
      judge("1.0.0", { [SURFACE]: "changed", [API]: '{"api":1}' }, { GITHUB_BASE_REF: "release" })
        .edited,
    ).toEqual([SURFACE])
    // Deleting a baseline is an edit too: the check would otherwise write a fresh one from this branch.
    expect(judge("1.0.0", { [SURFACE]: surface("1.0.0") }).edited).toEqual([API])
    git("checkout", "-q", "main")
    write("package.json", "{not json")
    git("add", "-A")
    git("commit", "-q", "-m", "broken", "--no-verify")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "-b", "after")
    write("z.txt", "1")
    git("add", "-A")
    git("commit", "-q", "-m", "z", "--no-verify")
    expect(judge("1.0.0", { [SURFACE]: "changed" })).toEqual({ compared: false, edited: [] })
  })

  it("gives up outside a git repository", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "baseline-guard-nogit-"))
    try {
      expect(
        baselinesEditedWithoutRelease({ cwd: outside, version: "1.0.0", env: {}, baselines: [] }),
      ).toEqual({ compared: false, edited: [] })
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
