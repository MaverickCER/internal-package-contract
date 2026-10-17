// The facts a change report is made of, read from what the repository and the contract already hold: git, the
// pending changesets, the exception registries, the decision records, the manifest, and the last contract run's report.
// Nothing is computed that is not already evidence, so a reader can check any line against its source.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

/** Where the contract's last run wrote what each check found. */
export const REPORT_PATH = "reports/contract/report.json"

/**
 * @param {string} cwd - the repository.
 * @param {string[]} args - what to ask git.
 * @returns {string} what git printed; nothing when it failed, so a ref or a file that is not there reads as empty.
 */
function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 }).stdout
}

/** @param {string} cwd @param {string} ref @returns {boolean} whether git knows the ref. */
const refExists = (cwd, ref) =>
  spawnSync("git", ["rev-parse", "--verify", "-q", ref], { cwd }).status === 0

/**
 * @param {string} cwd - the repository.
 * @returns {string | undefined} the branch changes are measured against: `origin/main`, else `main`.
 */
export function defaultBase(cwd) {
  return ["origin/main", "main"].find((ref) => refExists(cwd, ref))
}

/**
 * Which part of a package a path belongs to; the order is the order a reader looks at them.
 * @type {readonly { area: string, test: (file: string) => boolean }[]}
 */
export const AREAS = [
  { area: "Source", test: (file) => /^(src|checks|runtime|bin)\//.test(file) },
  {
    area: "Tests",
    test: (file) => /^test\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file),
  },
  { area: "Benchmarks", test: (file) => /^benchmarks\//.test(file) },
  {
    area: "Decisions and documents",
    test: (file) => /^(specs|docs)\//.test(file) || /\.md$/.test(file),
  },
  { area: "Exceptions and baselines", test: (file) => file.startsWith(".repo-contract/") },
  { area: "Workflows", test: (file) => file.startsWith(".github/") },
  { area: "Scripts and tooling", test: (file) => /^(scripts|ci)\//.test(file) },
]

/** @param {string} file @returns {string} the area of it; anything else is configuration. */
export const areaOf = (file) => AREAS.find(({ test }) => test(file))?.area ?? "Configuration"

/** @param {string} text @returns {number} how many lines it has, a final newline not starting another. */
const lineCount = (text) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)

/**
 * @param {string} cwd - the repository.
 * @param {string} base - the ref to measure against.
 * @returns {{ path: string, status: string, added: number, removed: number }[]} each file that differs from the base,
 *   with how it changed, for committed changes and the working tree alike, in path order.
 */
export function changedFiles(cwd, base) {
  // Both listings are of the same files in the same order, so a file's line counts are the row at its position. A
  // binary file has no line counts, which git prints as "-".
  const counts = git(cwd, ["diff", "--numstat", "--no-renames", base])
    .split("\n")
    .map((row) => row.split("\t"))
  const tracked = git(cwd, ["diff", "--name-status", "--no-renames", base])
    .split("\n")
    .filter(Boolean)
    .map((row, index) => {
      const [status, file] = row.split("\t")
      return {
        path: String(file),
        status: String(status),
        // Stryker disable next-line OptionalChaining: equivalent -- git lists every changed file in both listings.
        added: Number(counts[index]?.[0]) || 0,
        // Stryker disable next-line OptionalChaining: equivalent -- git lists every changed file in both listings.
        removed: Number(counts[index]?.[1]) || 0,
      }
    })
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .map((file) => ({
      path: file,
      status: "A",
      added: lineCount(readFileSync(path.join(cwd, file)).toString()),
      removed: 0,
    }))
  return [...tracked, ...untracked].sort((a, b) => a.path.localeCompare(b.path))
}

/** What opens a changeset, between two lines of dashes, and what follows it. */
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)/
/** One line of a changeset's header: a package and how much it changes. */
const ENTRY = /^"([^"]+)": (\w+)$/

/**
 * @param {string} cwd - the repository.
 * @returns {{ package: string, bump: string, summary: string, file: string }[]} each pending changeset.
 */
export function changesets(cwd) {
  const directory = path.join(cwd, ".changeset")
  if (!existsSync(directory)) return []
  const pending = readdirSync(directory).filter(
    (name) => name.endsWith(".md") && name !== "README.md",
  )
  // Stryker disable next-line MethodExpression: equivalent -- the listing is already in order on the filesystems in use, and sorting only makes the order the same on all of them.
  return pending.sort().flatMap((file) => {
    const match = FRONTMATTER.exec(readFileSync(path.join(directory, file)).toString())
    if (match === null) return []
    const summary = String(match[2]).trim()
    return String(match[1])
      .split("\n")
      .flatMap((line) => {
        const entry = ENTRY.exec(line.trim())
        return entry === null
          ? []
          : [{ package: String(entry[1]), bump: String(entry[2]), summary, file }]
      })
  })
}

/**
 * @param {() => string} read - how to read a registry's text; it may throw, or give nothing, when there is none.
 * @returns {Map<string, string>} each record's id and its reason; nothing for text that is not a registry.
 */
function recordsOf(read) {
  try {
    return new Map(
      JSON.parse(read()).exceptions.map(
        (/** @type {{ id: string, justification?: string }} */ record) => [
          record.id,
          record.justification ?? "",
        ],
      ),
    )
  } catch {
    // Nothing there, or nothing that reads as a registry.
    return new Map()
  }
}

/**
 * @param {string} cwd - the repository.
 * @param {string} base - the ref to measure against.
 * @returns {{ registry: string, id: string, justification: string, change: "added" | "removed" }[]} the exceptions the
 *   change records or retires, with the reason given for each, registry by registry.
 */
export function exceptionChanges(cwd, base) {
  const directory = path.join(cwd, ".repo-contract", "exceptions")
  const names = new Set([
    // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder name is not a registry anywhere, so it reads as none.
    ...(existsSync(directory) ? readdirSync(directory) : []),
    ...git(cwd, ["ls-tree", "--name-only", base, ".repo-contract/exceptions/"])
      .split("\n")
      .map((name) => path.basename(name)),
  ])
  return [...names].sort().flatMap((name) => {
    const now = recordsOf(() => readFileSync(path.join(directory, name)).toString())
    const before = recordsOf(() => git(cwd, ["show", `${base}:.repo-contract/exceptions/${name}`]))
    const registry = path.basename(name, ".json")
    return [
      ...[...now]
        .filter(([id]) => !before.has(id))
        .map(([id, justification]) => ({
          registry,
          id,
          justification,
          change: /** @type {const} */ ("added"),
        })),
      ...[...before]
        .filter(([id]) => !now.has(id))
        .map(([id, justification]) => ({
          registry,
          id,
          justification,
          change: /** @type {const} */ ("removed"),
        })),
    ]
  })
}

/**
 * @param {string} cwd - the repository.
 * @param {string} base - the ref to measure against.
 * @returns {{ file: string, title: string }[]} the decision records the change adds, by their first heading.
 */
export function newDecisions(cwd, base) {
  const added = git(cwd, [
    "diff",
    "--name-only",
    "--diff-filter=A",
    "--no-renames",
    base,
    "--",
    "specs/decisions/",
  ])
  const untracked = git(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "specs/decisions/",
  ])
  return [...new Set([...added.split("\n"), ...untracked.split("\n")])]
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((file) => ({
      file,
      title:
        /^# (.+)/m.exec(readFileSync(path.join(cwd, file)).toString())?.[1] ??
        path.basename(file, ".md"),
    }))
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]

/**
 * @param {() => string} read - how to read a manifest's text; it may throw, or give nothing, when there is none.
 * @returns {Map<string, { field: string, name: string, range: string }>} each dependency, by its field and name.
 */
function dependenciesOf(read) {
  try {
    const manifest = JSON.parse(read())
    return new Map(
      DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {}).map(([name, range]) => [
          `${field}\0${name}`,
          { field, name, range: String(range) },
        ]),
      ),
    )
  } catch {
    // No manifest, or one that does not parse.
    return new Map()
  }
}

/**
 * @param {string} cwd - the repository.
 * @param {string} base - the ref to measure against.
 * @returns {{ name: string, field: string, from: string | undefined, to: string | undefined }[]} each dependency added,
 *   removed or moved to another range, by field and name.
 */
export function dependencyChanges(cwd, base) {
  const now = dependenciesOf(() => readFileSync(path.join(cwd, "package.json")).toString())
  const before = dependenciesOf(() => git(cwd, ["show", `${base}:package.json`]))
  return [...new Set([...now.keys(), ...before.keys()])]
    .sort()
    .filter((key) => now.get(key)?.range !== before.get(key)?.range)
    .map((key) => {
      const { field, name } = /** @type {{ field: string, name: string }} */ (
        now.get(key) ?? before.get(key)
      )
      return { name, field, from: before.get(key)?.range, to: now.get(key)?.range }
    })
}

/**
 * @param {string} cwd - the repository.
 * @returns {{ id: string, outcome: string, rationale: string }[] | undefined} what each check found in the last run, or
 *   undefined when the contract has not been run here, or its report cannot be read.
 */
// Stryker disable BlockStatement: equivalent -- leaving the catch without a return also gives undefined.
export function contractChecks(cwd) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, REPORT_PATH)).toString()).checks.map(
      (/** @type {{ id: string, outcome: string, rationale?: string }} */ check) => ({
        id: check.id,
        outcome: check.outcome,
        rationale: check.rationale ?? "",
      }),
    )
  } catch {
    // The contract has not been run, or its report is not one.
    return undefined
  }
}
// Stryker restore BlockStatement

/**
 * @param {string} cwd - the repository.
 * @param {string} base - the ref to measure against.
 * @returns {import("./collect.mjs").ChangeFacts} every fact the report is made of.
 */
export function collect(cwd, base) {
  const manifest = path.join(cwd, "package.json")
  const { name, version } = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest).toString())
    : {}
  const files = changedFiles(cwd, base)
  return {
    package: name ?? path.basename(cwd),
    version,
    base,
    head: git(cwd, ["rev-parse", "--short", "HEAD"]).trim(),
    files,
    // Only the changesets this change adds or edits (one it removes is no longer listed): the ones already waiting on
    // the base are not part of it.
    changesets: changesets(cwd).filter(({ file }) =>
      files.some((changed) => changed.path === `.changeset/${file}`),
    ),
    exceptions: exceptionChanges(cwd, base),
    decisions: newDecisions(cwd, base),
    dependencies: dependencyChanges(cwd, base),
    checks: contractChecks(cwd),
  }
}
