// Reads, offline, whether every pin of this package in a consumer names the same revision.
//
// A consumer pins this package in three places that must agree: the `devDependency` ref in
// `package.json`, the commit `package-lock.json` resolved it to, and the commit SHA (with a `# vX`
// comment) of every reusable workflow it calls. They drift apart when one is bumped by hand, and
// the symptom is a repository that runs one revision's checks and another revision's release.
// This module only compares; it never rewrites (`--repin` and `dependency-pin-sync.yml` do that).
//
// It cannot tell whether the commit is reachable from this repository's default branch -- that needs
// the network and is a separate, scheduled audit.

import { shaFromLockfile } from "./init-lib.mjs"

const FULL_SHA = /^[0-9a-f]{40}$/
const PIN =
  /uses:\s*[\w.-]+\/internal-package-contract\/\.github\/workflows\/[\w.-]+\.ya?ml@([^\s#]+)(?:[ \t]*#[ \t]*([^\n]*))?/g

/**
 * @param {string} packageJson - the consumer's `package.json` text.
 * @returns {string | undefined} the ref after `#` in the git dependency on this package, if there is one.
 */
export function devDependencyRef(packageJson) {
  try {
    // A missing `devDependencies`, a missing entry and a spec that is not `github:...#ref` all throw
    // here, and a throw is the same answer as no ref, below.
    const spec = JSON.parse(packageJson).devDependencies["internal-package-contract"]
    return /^github:[^#]+#(.+)/.exec(spec)[1]
  } catch {
    // Not JSON, or not a git dependency on this package: no ref to read.
  }
  return undefined
}

/**
 * @param {string} text - a workflow file.
 * @returns {{ line: number, ref: string, comment: string }[]} each call of one of this package's
 *   reusable workflows: the 1-based line, what follows `@`, and the trailing `# ...` comment.
 */
export function workflowPins(text) {
  return [...text.matchAll(PIN)].map((match) => ({
    line: text.slice(0, match.index).split("\n").length,
    ref: match[1],
    comment: (match[2] ?? "").trim(),
  }))
}

/**
 * @param {{ packageJson: string, lockfile: string | undefined, workflows: readonly { file: string, text: string }[] }} input
 * @returns {{ applies: boolean, problems: string[] }} `applies` is false for a repository that neither
 *   depends on this package nor calls its workflows (including this repository itself).
 */
export function checkPins({ packageJson, lockfile, workflows }) {
  const ref = devDependencyRef(packageJson)
  const pins = workflows.flatMap(({ file, text }) =>
    workflowPins(text).map((pin) => ({ ...pin, file })),
  )
  if (ref === undefined && pins.length === 0) return { applies: false, problems: [] }
  if (ref === undefined) {
    return {
      applies: true,
      problems: [
        "package.json: workflows call internal-package-contract but it is not a git devDependency, so the installed checks and the workflows cannot be the same revision.",
      ],
    }
  }

  const locked = shaFromLockfile(lockfile)
  if (locked === undefined) {
    return {
      applies: true,
      problems: [
        "package-lock.json: no commit is recorded for internal-package-contract; run `npm install` so the lockfile pins one.",
      ],
    }
  }

  const problems = []
  if (FULL_SHA.test(ref) && ref !== locked) {
    problems.push(
      `package.json: devDependency is pinned to ${ref.slice(0, 7)} but package-lock.json resolved ${locked.slice(0, 7)}.`,
    )
  }
  for (const pin of pins) {
    const where = `${pin.file}:${pin.line}`
    if (!FULL_SHA.test(pin.ref)) {
      problems.push(
        `${where}: workflow is pinned to "${pin.ref}"; pin a full 40-character commit SHA, never a branch or tag.`,
      )
    } else if (pin.ref !== locked) {
      problems.push(
        `${where}: workflow is pinned to ${pin.ref.slice(0, 7)} but package-lock.json resolved ${locked.slice(0, 7)}.`,
      )
    } else if (pin.comment === "") {
      problems.push(
        `${where}: add a trailing "# <release>" comment naming the release this commit is.`,
      )
    } else if (/^v\d/.test(ref) && pin.comment !== ref) {
      problems.push(`${where}: comment says ${pin.comment} but the devDependency is ${ref}.`)
    }
  }
  return { applies: true, problems }
}
