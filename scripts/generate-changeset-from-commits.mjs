#!/usr/bin/env node
// Guarantees every RELEASABLE commit on `main` since the last release gets a changeset --
// either the hand-written one its own PR already added, or one generated here --
// so `changeset version` never runs with a silent "no changeset needed" gap. A commit is
// releasable when its Conventional Commit type changes what a user gets (`feat`, `fix`, `perf`,
// `revert`), when it is marked breaking, or when it carries an explicit `Changeset: <bump>`
// trailer; `chore`, `ci`, `docs`, `test`, `build`, `refactor`, `style` -- and anything a bot
// authored, such as a benchmark-results refresh or a dependency re-pin -- never becomes a
// release, so a changelog lists what changed for users and npm gets no empty releases. Run
// from a CONSUMER's own repo root (this package is a devDependency; every
// consumer's release-npm-changesets.yml invokes this exact file from
// node_modules), never from internal-package-contract's own repo, so nothing
// here assumes anything beyond a normal git checkout + package.json.
//
// Left alone on purpose: any `.changeset/*.md` file a commit's own diff already
// added. It can carry a richer description or force a higher bump than a commit
// prefix implies, and always takes precedence over what this script would have
// inferred.
//
// See specs/decisions in the "Standardize npm release + GitHub Pages deploy"
// plan, part B, for the full design rationale (bump-derivation rules, the
// first-adoption bootstrap, and why this must never run on a publish-triggered
// checkout).

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const RECORD_SEP = "\x1e"
const FIELD_SEP = "\x1f"

// Commits that touch ONLY these path prefixes never ship in the published
// package -- kept deliberately short (per the plan's own "can't become a
// loophole" instruction) so it can never quietly swallow a real behavior change.
const EXEMPT_PATH_PREFIXES = [".github/", ".vscode/"]

const SEVERITY = { patch: 0, minor: 1, major: 2 }

/** The repository being processed; set by {@link generateChangesets} so the script is testable in-process. */
let root = process.cwd()

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", cwd: root })
}

function readPackageName() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name
}

// A squash merge (this workflow's own auto-merge step uses `gh pr merge --squash`)
// appends " (#123)" to the PR title when it becomes the commit subject on main --
// matching by prefix, not exact equality, is what actually finds these commits.
function isReleaseCommitSubject(subject) {
  return subject === "chore: version packages" || subject.startsWith("chore: version packages (#")
}

/**
 * Finds the commit range to scan: everything since the last "chore: version
 * packages" release commit, excluding HEAD itself. When HEAD IS that commit
 * (a publish-triggered run, immediately after the Version Packages PR merged),
 * returns `{ skip: true }` -- there is nothing new to generate, and generating
 * anyway would reintroduce pending changesets that would wrongly turn this
 * publish run back into another version-bump run.
 */
function findRange() {
  const headSubject = git(["log", "-1", "--format=%s"]).trim()
  if (isReleaseCommitSubject(headSubject)) {
    return { skip: true }
  }

  const history = git(["log", "--format=%H" + FIELD_SEP + "%s", "HEAD"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(FIELD_SEP))

  for (let i = 1; i < history.length; i++) {
    if (isReleaseCommitSubject(history[i][1])) {
      return { anchor: history[i][0] }
    }
  }

  // No prior release commit exists at all -- the first cycle since Changesets
  // was adopted here. Anchor on whichever commit added .changeset/config.json
  // so history predating this mechanism (already versioned some other way,
  // e.g. release-please) is never retroactively re-bumped.
  const adoptionLog = git(["log", "--diff-filter=A", "--format=%H", "--", ".changeset/config.json"])
    .trim()
    .split("\n")
    .filter(Boolean)
  const anchor = adoptionLog.length > 0 ? adoptionLog[adoptionLog.length - 1] : null
  return { anchor }
}

function changedFiles(sha) {
  return git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
    .trim()
    .split("\n")
    .filter(Boolean)
}

function isExempt(files) {
  return files.every((file) => EXEMPT_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)))
}

function alreadyCovered(files) {
  return files.some((file) => /^\.changeset\/.*\.md$/.test(file) && !file.endsWith("README.md"))
}

/** Conventional Commit types that change what a user gets. Everything else is housekeeping. */
const RELEASABLE_TYPES = new Set(["feat", "fix", "perf", "revert"])

/** An author that is automation: its commits are bookkeeping unless they opt in explicitly. */
const BOT_AUTHOR = /\[bot\]|^github-actions|^dependabot|^renovate/i

/** `Changeset: patch|minor|major` in a commit body: an explicit, human opt-in to a release. */
const OPT_IN = /^Changeset:\s*(patch|minor|major)\s*$/im

function parseSubject(subject) {
  const match = subject.match(/^(\w+)(\([^)]*\))?(!)?:/)
  return { type: match?.[1], breaking: match?.[3] === "!" }
}

/**
 * The bump a commit asks for, or `null` when it is not releasable.
 *
 * While the package is below 1.0.0 the bump is DEFLATED one level -- a breaking change is `minor`,
 * a `feat` is `patch` -- the usual 0.x convention, and the reason a stray `feat!:` can never
 * publish 1.0.0 by itself. Crossing to 1.0.0 is a decision: it takes a human-authored `major`
 * changeset (or a `Changeset: major` trailer), and the release workflow then refuses to auto-merge
 * the version PR.
 * @param {string} subject
 * @param {string} body
 * @param {{ author?: string, preOne?: boolean }} [context]
 * @returns {"patch" | "minor" | "major" | null}
 */
export function bumpFor(subject, body, { author = "", preOne = false } = {}) {
  const optIn = OPT_IN.exec(body)?.[1]
  if (optIn) return optIn
  if (BOT_AUTHOR.test(author)) return null
  const { type, breaking } = parseSubject(subject)
  if (breaking || /BREAKING CHANGE:/.test(body)) return preOne ? "minor" : "major"
  if (type === "feat") return preOne ? "patch" : "minor"
  if (type !== undefined && RELEASABLE_TYPES.has(type)) return "patch"
  return null
}

function listCommits(range) {
  const revRange = range.anchor ? `${range.anchor}..HEAD` : "HEAD"
  const raw = git([
    "log",
    "--no-merges",
    "--reverse",
    `--format=%H${FIELD_SEP}%an${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`,
    revRange,
  ])
  return raw
    .split(RECORD_SEP)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, author, subject, body = ""] = entry.split(FIELD_SEP)
      return { sha, author, subject, body }
    })
}

function writeChangeset(pkgName, sha, bump, subject) {
  const dir = path.join(root, ".changeset")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const name = `auto-${sha.slice(0, 12)}.md`
  const content = `---\n"${pkgName}": ${bump}\n---\n\n${subject}\n`
  writeFileSync(path.join(dir, name), content)
  return path.join(".changeset", name)
}

function highestSeverityAcrossChangesets() {
  const dir = path.join(root, ".changeset")
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
  let max = null
  for (const file of files) {
    const content = readFileSync(path.join(dir, file), "utf8")
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (!frontmatterMatch) continue
    for (const line of frontmatterMatch[1].split("\n")) {
      const bumpMatch = line.match(/:\s*(major|minor|patch)\s*$/)
      if (bumpMatch && (max === null || SEVERITY[bumpMatch[1]] > SEVERITY[max])) {
        max = bumpMatch[1]
      }
    }
  }
  return max
}

/** Whether the package is still below 1.0.0, where bumps are deflated. */
export function isPreOne(version) {
  return Number.parseInt(String(version).split(".")[0], 10) < 1
}

/**
 * Generates a changeset for each releasable commit that lacks one.
 * @param {string} [cwd] - the repository root.
 * @param {(line: string) => void} [log]
 * @returns {{ generated: number, files: string[] }}
 */
export function generateChangesets(cwd = process.cwd(), log = console.log) {
  root = cwd
  return main(log)
}

function main(log) {
  const range = findRange()
  if (range.skip) {
    log("HEAD is the release commit itself -- nothing to generate.")
    return { generated: 0, files: [] }
  }

  const pkgName = readPackageName()
  const preOne = isPreOne(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version)
  const commits = listCommits(range)
  const files = []

  for (const { sha, author, subject, body } of commits) {
    const changed = changedFiles(sha)
    if (changed.length === 0) continue
    if (isExempt(changed)) continue
    if (alreadyCovered(changed)) continue

    const bump = bumpFor(subject, body, { author, preOne })
    if (bump === null) {
      log(`Skipped ${sha.slice(0, 12)} (not a release): ${subject}`)
      continue
    }
    const file = writeChangeset(pkgName, sha, bump, subject)
    files.push(file)
    log(`Generated ${file} (${bump}) for ${sha.slice(0, 12)}: ${subject}`)
  }

  log(
    `Generated ${String(files.length)} changeset(s) from ${String(commits.length)} commit(s) since anchor.`,
  )
  if (preOne) log("Below 1.0.0: breaking changes bump minor, features bump patch.")

  const overallBump = highestSeverityAcrossChangesets()
  if (overallBump) {
    writeFileSync(
      path.join(root, ".changeset", ".release-bump.json"),
      `{ "bump": "${overallBump}" }\n`,
    )
    log(`Recorded overall bump severity: ${overallBump}`)
  }
  return { generated: files.length, files }
}

// Run only as a script, so the bump rules above can be imported and tested.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  generateChangesets()
}
