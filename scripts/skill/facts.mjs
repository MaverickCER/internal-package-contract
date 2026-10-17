// What a package's agent skill is made of. Almost all of it is read from what the package already holds: its
// manifest, the entry points it documents in `docs/surface.json`, the public API its committed baselines record, and its
// scripts. The rest is the few things only the author knows, written in `docs/skill.json`: when the skill applies, one
// worked example, the rules and invariants an agent cannot infer from the types, and the mistakes that matter.

import { readFileSync } from "node:fs"
import path from "node:path"

/** The author's own part. */
export const SKILL_FILE = "docs/skill.json"

/**
 * @param {string} file
 * @returns {any} the parsed JSON, or undefined when the file is not there or does not parse.
 */
// Stryker disable BlockStatement: equivalent -- leaving the catch without a return also gives undefined.
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file).toString())
  } catch {
    // Not there, or not JSON: the caller decides what that means.
    return undefined
  }
}
// Stryker restore BlockStatement

/** @param {string} url @returns {string} a repository URL as a browsable address, without `git+` or `.git`. */
const browsable = (url) => url.replace(/^git\+/, "").replace(/\.git$/, "")

/**
 * @param {string} subpath - a `package.json` export key, `.` or `./x/y`.
 * @param {Record<string, string> | undefined} aliases - `internal-package-contract.apiTargets`.
 * @returns {string} the folder under `.repo-contract/api-contract/` that records its API.
 */
export function baselineFolder(subpath, aliases) {
  const target = aliases?.[subpath]
  if (subpath === "." && target === undefined) return "index"
  if (target !== undefined) {
    // The same naming the API contract gives a target: its source path without `src/` and without `index.ts` or `.ts`.
    const name = target
      .replace(/^\.?\/?src\//, "")
      .replace(/\/index\.tsx?$/, "")
      .replace(/\.tsx?$/, "")
    return name === "" ? "index" : name
  }
  // A subpath is `./` and a name, which may itself be nested (`./runtime/cache` is the folder `runtime/cache`).
  return subpath.slice(2)
}

/**
 * @param {string} cwd - the package.
 * @param {string} folder - a folder under `.repo-contract/api-contract/`.
 * @returns {{ name: string, kind: string, tag: string, signature: string }[]} what the entry point exports publicly,
 *   each by one line of its declaration; nothing when the package records no API for it.
 */
function exportsOf(cwd, folder) {
  const model = readJson(
    path.join(cwd, ".repo-contract", "api-contract", folder, "baseline.api.json"),
  )
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder member has no release tag, so it is filtered out below.
  /** @type {any[]} */
  const members = model?.members?.[0]?.members ?? []
  return members
    .filter((member) => ["Public", "Beta"].includes(member.releaseTag))
    .map((member) => ({
      name: String(member.name),
      kind: String(member.kind),
      tag: String(member.releaseTag),
      signature: member.excerptTokens
        .map((/** @type {{ text: string }} */ token) => token.text)
        .join("")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^export (?:declare )?/, "")
        .replace(/\s*;$/, ""),
    }))
}

/**
 * @param {string} cwd - the package.
 * @returns {object | undefined} everything a skill is made of; undefined when the package has no manifest.
 */
export function readFacts(cwd) {
  const manifest = readJson(path.join(cwd, "package.json"))
  if (manifest === undefined) return undefined
  const surface = readJson(path.join(cwd, "docs", "surface.json"))?.entries ?? {}
  const aliases = manifest["internal-package-contract"]?.apiTargets
  const subpaths = Object.keys(manifest.exports ?? {}).filter(
    (key) => key.startsWith(".") && !key.includes("*") && key !== "./package.json",
  )
  const repository = browsable(
    String(
      manifest.repository?.url ?? readJson(path.join(cwd, "docs", "site.json"))?.repoUrl ?? "",
    ),
  )
  return {
    name: String(manifest.name),
    version: String(manifest.version),
    description: String(manifest.description ?? ""),
    repository,
    entries: subpaths.map((subpath) => ({
      specifier:
        subpath === "." ? String(manifest.name) : `${String(manifest.name)}/${subpath.slice(2)}`,
      purpose: String(surface[subpath]?.purpose ?? ""),
      tier: String(surface[subpath]?.tier ?? ""),
      api: exportsOf(cwd, baselineFolder(subpath, aliases)),
    })),
    skill: readJson(path.join(cwd, SKILL_FILE)),
  }
}
