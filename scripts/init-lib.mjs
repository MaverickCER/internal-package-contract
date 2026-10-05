// Pure helpers for `internal-package-contract init` (bin/init.mjs): argument parsing, placeholder
// rendering and template discovery. Kept free of side effects so each piece is unit-testable.

import { readdirSync } from "node:fs"
import path from "node:path"

/**
 * Placeholders a template may use: `{{name}}`, `{{repo}}`, `{{owner}}`, `{{description}}`, `{{year}}`,
 * and the two pins of this package: `{{ipcRef}}` (the release tag, e.g. `v0.8.1`) and `{{ipcSha}}`
 * (the commit that tag points at -- what a workflow `uses:` line is pinned to).
 */
const PLACEHOLDER = /\{\{(name|repo|owner|description|year|ipcRef|ipcSha)\}\}/g

const VALUE_FLAGS = ["name", "owner", "description"]

/**
 * @param {readonly string[]} argv - the arguments after the script name.
 * @returns {{ force: boolean, name?: string, owner?: string, description?: string, errors: string[] }}
 */
export function parseInitArgs(argv) {
  const result = { force: false, errors: [] }
  let consumed = false
  for (const [index, arg] of argv.entries()) {
    // The previous flag took this argument as its value.
    if (consumed) {
      consumed = false
      continue
    }
    if (arg === "--force") {
      result.force = true
      continue
    }
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg)
    const flag = match?.[1]
    if (!VALUE_FLAGS.includes(flag)) {
      result.errors.push(`Unknown argument ${JSON.stringify(arg)}.`)
      continue
    }
    const inline = match[2]
    const value = inline ?? argv[index + 1]
    if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
      result.errors.push(`--${flag} needs a value.`)
      continue
    }
    if (inline === undefined) consumed = true
    result[flag] = value
  }
  return result
}

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/**
 * @param {string} name - a candidate npm package name.
 * @returns {string | undefined} a problem description, or `undefined` when valid.
 */
export function validatePackageName(name) {
  if (name.length > 214) return "A package name must be 214 characters or fewer."
  if (!PACKAGE_NAME.test(name)) {
    return `${JSON.stringify(name)} is not a valid npm package name (lowercase letters, digits, "-", ".", "_", "~", optionally scoped as @scope/name).`
  }
  return undefined
}

/**
 * @param {{ name: string, owner: string, description?: string, year?: number, ipcRef?: string, ipcSha?: string }} input
 * @returns {{ name: string, repo: string, owner: string, description: string, year: string, ipcRef: string, ipcSha: string }}
 */
export function buildVars({
  name,
  owner,
  description,
  year = new Date().getFullYear(),
  ipcRef = "main",
  ipcSha = "",
}) {
  return {
    name,
    // Without a slash `indexOf` is -1, so the whole name is kept.
    repo: name.slice(name.indexOf("/") + 1),
    owner,
    description: description ?? `TODO: describe ${name}.`,
    year: String(year),
    ipcRef,
    ipcSha,
  }
}

const FULL_SHA = /#([0-9a-f]{40})\b/

/**
 * The commit of this package a consumer's lockfile pinned, read from the lockfile entry for the
 * git dependency (`resolved: "git+ssh://git@github.com/.../internal-package-contract.git#<sha>"`).
 * @param {string | undefined} lockText - the consumer's `package-lock.json`, if it has one.
 * @returns {string | undefined} the 40-hex commit, or `undefined` when the lockfile does not pin one.
 */
export function shaFromLockfile(lockText) {
  try {
    // No lockfile (`undefined`) fails to parse, which is the same answer as no pin.
    const lock = JSON.parse(lockText)
    // Stryker disable next-line OptionalChaining: this whole block answers `undefined` for any failure, so a missing level that throws and one that is skipped are the same
    const entry = lock?.packages?.["node_modules/internal-package-contract"]
    // Stryker disable next-line OptionalChaining: as above
    return FULL_SHA.exec(entry?.resolved)?.[1]
  } catch {
    // Not JSON: no pin to read, below.
  }
  return undefined
}

/**
 * Builds the variables for the pins of this package a scaffolded workflow or `package.json` carries.
 * A workflow that calls a reusable workflow of this repository is pinned by commit SHA, never by a
 * branch: anyone who can push to `main` here could otherwise publish every consumer.
 * @param {{ version: string, sha: string | undefined }} input
 * @returns {{ ipcRef: string, ipcSha: string }} `ipcSha` is empty when no commit could be resolved.
 */
export function buildPinVars({ version, sha }) {
  return { ipcRef: `v${version}`, ipcSha: sha ?? "" }
}

/**
 * @param {string} text - template text containing `{{placeholder}}`s.
 * @param {Readonly<Record<string, string>>} vars - see {@link buildVars}.
 * @returns {string} the text with every known placeholder replaced; unknown `{{...}}` text is left alone.
 */
export function render(text, vars) {
  return text.replace(PLACEHOLDER, (_match, key) => vars[key])
}

/**
 * Renders a JSON template by substituting inside its string VALUES, so a description containing a
 * quote or backslash can never corrupt the document.
 * @param {string} text - JSON text.
 * @param {Readonly<Record<string, string>>} vars - see {@link buildVars}.
 * @returns {string} pretty-printed JSON with a trailing newline.
 */
export function renderJson(text, vars) {
  const walk = (value) => {
    if (typeof value === "string") return render(value, vars)
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, walk(entry)]))
    }
    return value
  }
  return `${JSON.stringify(walk(JSON.parse(text)), null, 2)}\n`
}

/**
 * @param {string} dir - an absolute directory.
 * @returns {string[]} every file below it as a posix-style relative path, sorted.
 */
export function listTemplateFiles(dir) {
  const walk = (current) =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name)
      return entry.isDirectory() ? walk(full) : [path.relative(dir, full).split(path.sep).join("/")]
    })
  return walk(dir).sort()
}
