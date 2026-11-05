// The "dependencies" region: what installing a package adds, read from `package.json` itself, with the reason
// for each dependency kept once in `docs/surface.json`. A document can then no longer call a package
// dependency-free, or say it "bundles" something it installs, while `package.json` says otherwise; and a
// dependency added without a stated reason fails generation instead of shipping unexplained.

import { toTable } from "./entry-points.mjs"

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * @param {unknown} value - one dependency map from `package.json`.
 * @returns {[string, string][]} its entries with string ranges, sorted by name.
 */
function entriesOf(value) {
  if (!isRecord(value)) return []
  return Object.entries(value)
    .filter((entry) => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b, "en"))
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 * @returns {string} "1 one" or "N many".
 */
const plural = (count, one, many) => `${String(count)} ${count === 1 ? one : many}`

/**
 * @param {{ name: string, dependencies?: unknown, peerDependencies?: unknown, peerDependenciesMeta?: unknown }} pkg
 * @param {unknown} surface - the parsed `docs/surface.json`.
 * @returns {{ problems: string[], markdown: string }} the region's body, or what stops it being written.
 */
export function dependencyRegion(pkg, surface) {
  /** @type {string[]} */
  const problems = []
  const given = isRecord(surface) ? surface.dependencies : undefined
  if (given !== undefined && !isRecord(given)) {
    problems.push(
      'docs/surface.json "dependencies" must be an object from package name to the reason it is there.',
    )
  }
  const reasons = isRecord(given) ? given : {}
  const runtime = entriesOf(pkg.dependencies)
  const peers = entriesOf(pkg.peerDependencies)
  const meta = isRecord(pkg.peerDependenciesMeta) ? pkg.peerDependenciesMeta : {}
  const declared = new Set([...runtime, ...peers].map(([name]) => name))

  /**
   * @param {string} name
   * @param {string} range
   * @param {string} kind
   * @param {string} field - where package.json declares it, for the problem text.
   * @returns {string[][]} the row, or none (with a problem) when the reason is missing.
   */
  const row = (name, range, kind, field) => {
    const reason = reasons[name]
    if (typeof reason === "string" && reason.trim() !== "") {
      return [[`\`${name}\``, kind, `\`${range}\``, reason]]
    }
    problems.push(
      `docs/surface.json has no "dependencies" reason for "${name}", which package.json lists in ${field}.`,
    )
    return []
  }
  const rows = [
    ...runtime.flatMap(([name, range]) => row(name, range, "dependency", "dependencies")),
    ...peers.flatMap(([name, range]) =>
      row(
        name,
        range,
        isRecord(meta[name]) && meta[name].optional === true ? "optional peer" : "peer",
        "peerDependencies",
      ),
    ),
  ]
  for (const name of Object.keys(reasons)) {
    if (!declared.has(name)) {
      problems.push(
        `docs/surface.json gives a reason for "${name}", which package.json does not declare.`,
      )
    }
  }

  const installs =
    runtime.length === 0
      ? `Installing \`${pkg.name}\` installs no other packages: \`package.json\` declares no dependencies.`
      : `Installing \`${pkg.name}\` installs ${plural(runtime.length, "direct dependency", "direct dependencies")}, and whatever ${runtime.length === 1 ? "it depends" : "they depend"} on.`
  const peersLine =
    peers.length === 0
      ? ""
      : ` It names ${plural(peers.length, "peer dependency", "peer dependencies")}, which you install yourself when you use the part that needs ${peers.length === 1 ? "it" : "them"}.`
  if (runtime.length + peers.length === 0) return { problems, markdown: installs }
  return {
    problems,
    markdown: `${installs}${peersLine}\n\n${toTable([["Package", "Kind", "Range", "Why"], ...rows])}`,
  }
}
