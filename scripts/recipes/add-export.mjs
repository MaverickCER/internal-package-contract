// The recipe behind `internal-package-contract add export <name>`: everything a new subpath export needs,
// worked out as data. Adding an entry point to a package means keeping eight places in step (the module, the
// `exports` map, the bundler entry, the declaration shim list, two TypeDoc configs, the dead-code entry list
// and a test, plus a changeset), and the API-compatibility gate then fails if any of them disagrees. This
// computes every new file and every edited file first, from the current text, and reports a problem instead
// of a guess when a file is not shaped the way it expects, so nothing is ever half applied.
//
// It never decides a version bump: the changeset it drafts leaves the bump unset, which the release tooling
// rejects until a person chooses one.

const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const RESERVED = new Set(["package", "index"])

/**
 * @param {string} name - the subpath, without `./`.
 * @returns {string | undefined} what is wrong with it, or undefined when it can be an export.
 */
export function validateExportName(name) {
  if (!NAME.test(name)) {
    return `${JSON.stringify(name)} is not a usable export name: use lowercase letters, digits and single hyphens, starting with a letter.`
  }
  if (RESERVED.has(name)) {
    return `${JSON.stringify(name)} is reserved: "index" is the root entry and "package" would shadow package.json.`
  }
  return undefined
}

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

/** Quotes a property key only when it needs it: a name made of letters and digits is a plain identifier. */
const key = (name) => (name.includes("-") ? JSON.stringify(name) : name)

/**
 * @param {string} inner - the text between a list's or object's brackets.
 * @param {string} item - what to add after the last item.
 * @returns {string} `inner` with `item` appended, whether or not `inner` was empty or ended in a comma.
 */
function append(inner, item) {
  const kept = inner.trim().replace(/,$/, "")
  return kept === "" ? item : `${kept}, ${item}`
}

/**
 * @param {string} text - JSON that may carry `//` and block comments, as tool configuration often does.
 * @returns {string} the same text without them. A string is matched first, so comment-like text inside one
 *   (a URL, say) is kept.
 */
export function stripJsonComments(text) {
  return text.replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
    (_whole, string) => string ?? "",
  )
}

function json(text, file, problems) {
  try {
    return JSON.parse(stripJsonComments(text))
  } catch {
    problems.push(`${file} is not valid JSON, so the new entry cannot be added to it.`)
    return undefined
  }
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`

function addExportsEntry(manifest, name, problems) {
  const root = manifest.exports?.["."]
  if (!isRecord(root)) {
    problems.push('package.json has no object `exports["."]` to copy the entry shape from.')
    return undefined
  }
  if (manifest.exports[`./${name}`] !== undefined) {
    problems.push(`package.json already exports "./${name}".`)
    return undefined
  }
  const entry = JSON.parse(JSON.stringify(root).replaceAll("/index.", `/${name}.`))
  // The new entry goes straight after the root one, ahead of the rest.
  const rest = { ...manifest.exports }
  // Stryker disable next-line StringLiteral: equivalent -- a root entry left in `rest` is assigned over by the same value in the same position.
  delete rest["."]
  return { ...manifest, exports: { ".": root, [`./${name}`]: entry, ...rest } }
}

function addToList(text, file, listKey, value, problems) {
  const config = json(text, file, problems)
  if (config === undefined) return undefined
  // A configuration that extends another inherits its entry points, so there is nothing to add to it.
  if (config[listKey] === undefined && config.extends !== undefined) return text
  if (!Array.isArray(config[listKey])) {
    problems.push(`${file} has no \`${listKey}\` list to add ${JSON.stringify(value)} to.`)
    return undefined
  }
  // Inserted into the text rather than re-serialized, so every other line of the file stays as it was.
  const list = new RegExp(`("${listKey}"\\s*:\\s*\\[)([^\\]]*)(\\])`).exec(text)
  return text.replace(list[0], `${list[1]}${append(list[2], JSON.stringify(value))}${list[3]}`)
}

function addTsupEntry(text, name, problems) {
  const blocks = Array.from(text.matchAll(/entry:\s*\{/g))
  if (blocks.length > 1) {
    problems.push(
      `tsup.config.ts has ${String(blocks.length)} \`entry\` blocks (several builds), and which one gets the new entry is a decision, so wire it by hand.`,
    )
    return undefined
  }
  const match = /entry:\s*\{([^}]*)\}/.exec(text)
  if (match === null) {
    problems.push("tsup.config.ts has no `entry: { ... }` object to add the new entry to.")
    return undefined
  }
  return text.replace(
    match[0],
    `entry: { ${append(match[1], `${key(name)}: "src/${name}/index.ts"`)} }`,
  )
}

function addShimEntry(text, name, problems) {
  const match = /const ENTRIES = \[([\s\S]*?)\]\n/.exec(text)
  if (match === null) {
    problems.push(
      "scripts/emit-dts-shims.mjs has no `const ENTRIES = [ ... ]` list to add the new entry to.",
    )
    return undefined
  }
  const item = `{ name: "${name}", dtsPath: "./.dts/${name}/index.js" }`
  return text.replace(match[0], `const ENTRIES = [${append(match[1], item)}]\n`)
}

const moduleText = (pkg, name) => `/**
 * The \`${pkg}/${name}\` entry point.
 * @packageDocumentation
 */

/**
 * Placeholder so the new entry builds and its test passes; replace it with the real exports.
 * @returns the name of this entry point.
 * @public
 */
export function entryName(): string {
  return "${name}"
}
`

const testText = (pkg, name) => `import { describe, expect, it } from "vitest"
import { entryName } from "../src/${name}/index.js"

describe("${pkg}/${name}", () => {
  it("names itself", () => {
    expect(entryName()).toBe("${name}")
  })
})
`

const changesetText = (pkg, name) => `---
"${pkg}": unset
---

Add the \`${pkg}/${name}\` entry point. Replace \`unset\` above with \`patch\`, \`minor\` or \`major\`, and describe the change here.
`

/**
 * @param {{ name: string, files: Record<string, string | undefined> }} input - `files` maps a repo-relative
 *   path to its current text, or undefined when the file does not exist.
 * @returns {{ writes: { path: string, text: string, created: boolean }[], problems: string[] }} every file to
 *   write, with its complete new text, or the reasons nothing can be written.
 */
/**
 * @param {string} text - `docs/surface.json`.
 * @param {string} name - the new entry point's folder name.
 * @param {string[]} problems
 * @returns {string} the text with the new entry added, or the text unchanged when a problem was recorded.
 */
function addSurfaceEntry(text, name, problems) {
  const surface = json(text, "docs/surface.json", problems)
  if (surface === undefined) return text
  const entries = surface.entries
  if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
    problems.push('docs/surface.json has no "entries" object to add the new entry point to.')
    return text
  }
  if (`./${name}` in entries) {
    problems.push(`docs/surface.json already describes "./${name}".`)
    return text
  }
  entries[`./${name}`] = {
    source: `src/${name}/`,
    environment: "isomorphic",
    // The tier is the maintainer's decision to change; a new entry point starts as the safer one.
    tier: "Experimental",
    purpose: "TODO: say what a reader gets from this entry point.",
  }
  return serialize(surface)
}

export function planAddExport({ name, files }) {
  const problems = []
  const nameProblem = validateExportName(name)
  if (nameProblem !== undefined) return { writes: [], problems: [nameProblem] }

  const writes = []
  const edit = (file, build) => {
    const text = files[file]
    if (text === undefined) {
      problems.push(`${file} does not exist, and the new entry has to be added to it.`)
      return
    }
    const next = build(text)
    // A file that needs no change is not rewritten; a refusal is recorded as a problem and voids the plan.
    if (next !== text) writes.push({ path: file, text: next, created: false })
  }
  const optional = (file, build) => {
    if (files[file] !== undefined) edit(file, build)
  }
  const create = (file, text) => {
    if (files[file] !== undefined) problems.push(`${file} already exists.`)
    else writes.push({ path: file, text, created: true })
  }

  const manifestText = files["package.json"]
  const manifest =
    manifestText === undefined ? undefined : json(manifestText, "package.json", problems)
  if (manifest === undefined) {
    if (manifestText === undefined) problems.push("package.json does not exist.")
    return { writes: [], problems }
  }
  const pkg = manifest.name
  if (typeof pkg !== "string") problems.push("package.json has no `name`.")

  const updated = addExportsEntry(manifest, name, problems)
  // `updated` is undefined only when a problem was recorded above, and a problem voids the plan.
  writes.push({ path: "package.json", text: serialize(updated), created: false })

  edit("tsup.config.ts", (text) => addTsupEntry(text, name, problems))
  edit("scripts/emit-dts-shims.mjs", (text) => addShimEntry(text, name, problems))
  edit("typedoc.json", (text) =>
    addToList(text, "typedoc.json", "entryPoints", `src/${name}/index.ts`, problems),
  )
  optional("typedoc.markdown.json", (text) =>
    addToList(text, "typedoc.markdown.json", "entryPoints", `src/${name}/index.ts`, problems),
  )
  edit("knip.json", (text) =>
    addToList(text, "knip.json", "entry", `src/${name}/index.ts!`, problems),
  )

  optional("docs/surface.json", (text) => addSurfaceEntry(text, name, problems))

  create(`src/${name}/index.ts`, moduleText(pkg, name))
  create(`test/${name}.test.ts`, testText(pkg, name))
  create(`.changeset/add-${name}-export.md`, changesetText(pkg, name))
  return problems.length > 0 ? { writes: [], problems } : { writes, problems }
}
