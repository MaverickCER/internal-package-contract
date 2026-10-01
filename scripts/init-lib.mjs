// Pure helpers for `internal-package-contract init` (bin/init.mjs): argument parsing, placeholder
// rendering and template discovery. Kept free of side effects so each piece is unit-testable.

import { readdirSync } from "node:fs"
import path from "node:path"

/** Placeholders a template may use: `{{name}}`, `{{repo}}`, `{{owner}}`, `{{description}}`, `{{year}}`. */
const PLACEHOLDER = /\{\{(name|repo|owner|description|year)\}\}/g

const VALUE_FLAGS = ["name", "owner", "description"]

/**
 * @param {readonly string[]} argv - the arguments after the script name.
 * @returns {{ force: boolean, name?: string, owner?: string, description?: string, errors: string[] }}
 */
export function parseInitArgs(argv) {
  const result = { force: false, errors: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--force") {
      result.force = true
      continue
    }
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(arg ?? "")
    const flag = match?.[1]
    if (flag === undefined || !VALUE_FLAGS.includes(flag)) {
      result.errors.push(`Unknown argument ${JSON.stringify(arg)}.`)
      continue
    }
    const inline = match?.[2]
    const value = inline ?? argv[index + 1]
    if (value === undefined || value === "" || (inline === undefined && value.startsWith("--"))) {
      result.errors.push(`--${flag} needs a value.`)
      continue
    }
    if (inline === undefined) index += 1
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
 * @param {{ name: string, owner: string, description?: string, year?: number }} input
 * @returns {{ name: string, repo: string, owner: string, description: string, year: string }}
 */
export function buildVars({ name, owner, description, year = new Date().getFullYear() }) {
  return {
    name,
    repo: name.includes("/") ? name.slice(name.indexOf("/") + 1) : name,
    owner,
    description: description ?? `TODO: describe ${name}.`,
    year: String(year),
  }
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
