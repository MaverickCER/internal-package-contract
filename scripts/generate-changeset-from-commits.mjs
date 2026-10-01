#!/usr/bin/env node
// Guarantees every commit on `main` since the last release gets a changeset --
// either the hand-written one its own PR already added, or one generated here --
// so `changeset version` never runs with a silent "no changeset needed" gap. Run
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

const RECORD_SEP = "\x1e"
const FIELD_SEP = "\x1f"

// Commits that touch ONLY these path prefixes never ship in the published
// package -- kept deliberately short (per the plan's own "can't become a
// loophole" instruction) so it can never quietly swallow a real behavior change.
const EXEMPT_PATH_PREFIXES = [".github/", ".vscode/"]

const SEVERITY = { patch: 0, minor: 1, major: 2 }

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" })
}

function readPackageName() {
  return JSON.parse(readFileSync("package.json", "utf8")).name
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

function bumpFor(subject, body) {
  const match = subject.match(/^(\w+)(\([^)]*\))?(!)?:/)
  if (match?.[3] === "!") return "major"
  if (/BREAKING CHANGE:/.test(body)) return "major"
  if (match?.[1] === "feat") return "minor"
  return "patch"
}

function listCommits(range) {
  const revRange = range.anchor ? `${range.anchor}..HEAD` : "HEAD"
  const raw = git([
    "log",
    "--no-merges",
    "--reverse",
    `--format=%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`,
    revRange,
  ])
  return raw
    .split(RECORD_SEP)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body = ""] = entry.split(FIELD_SEP)
      return { sha, subject, body }
    })
}

function writeChangeset(pkgName, sha, bump, subject) {
  const dir = ".changeset"
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `auto-${sha.slice(0, 12)}.md`)
  const content = `---\n"${pkgName}": ${bump}\n---\n\n${subject}\n`
  writeFileSync(file, content)
  return file
}

function highestSeverityAcrossChangesets() {
  const dir = ".changeset"
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

function main() {
  const range = findRange()
  if (range.skip) {
    console.log("HEAD is the release commit itself -- nothing to generate.")
    return
  }

  const pkgName = readPackageName()
  const commits = listCommits(range)
  let generated = 0

  for (const { sha, subject, body } of commits) {
    const files = changedFiles(sha)
    if (files.length === 0) continue
    if (isExempt(files)) continue
    if (alreadyCovered(files)) continue

    const bump = bumpFor(subject, body)
    const file = writeChangeset(pkgName, sha, bump, subject)
    generated++
    console.log(`Generated ${file} (${bump}) for ${sha.slice(0, 12)}: ${subject}`)
  }

  console.log(`Generated ${generated} changeset(s) from ${commits.length} commit(s) since anchor.`)

  const overallBump = highestSeverityAcrossChangesets()
  if (overallBump) {
    writeFileSync(".changeset/.release-bump.json", `{ "bump": "${overallBump}" }\n`)
    console.log(`Recorded overall bump severity: ${overallBump}`)
  }
}

main()
