#!/usr/bin/env node
// Re-pins every workflow that calls one of a dependency's reusable workflows.
//
//   node repin-workflows.mjs <dependency> <commit-sha> <release-tag>
//
// A caller pins a reusable workflow by commit SHA -- never by a branch, because whoever can push to
// that branch could otherwise run code with the caller's permissions (and, for the release workflow,
// publish the caller). The pin carries the release it corresponds to in a trailing comment:
//
//   uses: MaverickCER/internal-package-contract/.github/workflows/release-npm-changesets.yml@<sha> # v0.8.1
//
// `dependency-pin-sync.yml` runs this right after it moves the devDependency, so the workflow code a
// repository runs never drifts from the version of the package it installs.

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const FULL_SHA = /^[0-9a-f]{40}$/

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * @param {string} text - a workflow file.
 * @param {string} dependency - the package whose workflows are pinned, e.g. `internal-package-contract`.
 * @param {string} sha - the 40-hex commit to pin to.
 * @param {string} ref - the release tag that commit is, written in the trailing comment.
 * @returns {{ text: string, changed: number }} the rewritten text and how many `uses:` lines changed.
 */
export function repinWorkflowText(text, dependency, sha, ref) {
  if (!FULL_SHA.test(sha)) throw new Error(`Not a full commit SHA: ${JSON.stringify(sha)}`)
  const pattern = new RegExp(
    `(uses:\\s*[\\w.-]+/${escapeRegExp(dependency)}/\\.github/workflows/[\\w.-]+\\.ya?ml@)[^\\s#]+(?:[ \\t]*#[^\\n]*)?`,
    "g",
  )
  let changed = 0
  const next = text.replace(pattern, (match, head) => {
    const rewritten = `${head}${sha} # ${ref}`
    if (rewritten !== match) changed += 1
    return rewritten
  })
  return { text: next, changed }
}

/**
 * @param {string} dir - the repository root.
 * @param {string} dependency
 * @param {string} sha
 * @param {string} ref
 * @returns {string[]} the workflow files that were rewritten.
 */
export function repinWorkflows(dir, dependency, sha, ref) {
  const workflows = path.join(dir, ".github", "workflows")
  const rewritten = []
  let entries
  try {
    entries = readdirSync(workflows)
  } catch {
    return rewritten
  }
  for (const entry of entries.filter((name) => /\.ya?ml$/.test(name))) {
    const file = path.join(workflows, entry)
    const before = readFileSync(file, "utf8")
    const { text, changed } = repinWorkflowText(before, dependency, sha, ref)
    if (changed > 0) {
      writeFileSync(file, text)
      rewritten.push(path.join(".github", "workflows", entry))
    }
  }
  return rewritten
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [dependency, sha, ref] = process.argv.slice(2)
  if (!dependency || !sha || !ref) {
    process.stderr.write("Usage: repin-workflows.mjs <dependency> <commit-sha> <release-tag>\n")
    process.exitCode = 1
  } else {
    const files = repinWorkflows(process.cwd(), dependency, sha, ref)
    process.stdout.write(
      files.length === 0
        ? "No workflow pins this dependency; nothing re-pinned.\n"
        : `Re-pinned ${files.join(", ")} to ${sha.slice(0, 7)} (${ref}).\n`,
    )
  }
}
