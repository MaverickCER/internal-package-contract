// The "dependencies" region: what installing a package adds, read from `package.json` itself, with the reason
// for each dependency kept once in `docs/surface.json`. A document can then no longer call a package
// dependency-free, or say it "bundles" something it installs, while `package.json` says otherwise; and a
// dependency added without a stated reason fails generation instead of shipping unexplained.
//
// What counts as installed follows npm 7 and later: `dependencies`, `optionalDependencies` (installed by default,
// a failure tolerated) and required `peerDependencies`. Only optional peers are left to the consumer.

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
 * @param {{ name: string, dependencies?: unknown, optionalDependencies?: unknown, peerDependencies?: unknown, peerDependenciesMeta?: unknown }} pkg
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
  const meta = isRecord(pkg.peerDependenciesMeta) ? pkg.peerDependenciesMeta : {}
  const isOptionalPeer = (name) => isRecord(meta[name]) && meta[name].optional === true
  const optional = entriesOf(pkg.optionalDependencies)
  // npm installs a name listed in both maps from optionalDependencies, so the plain entry is not a second package.
  const optionalNames = new Set(optional.map(([name]) => name))
  const runtime = entriesOf(pkg.dependencies).filter(([name]) => !optionalNames.has(name))
  const peers = entriesOf(pkg.peerDependencies)
  const requiredPeers = peers.filter(([name]) => !isOptionalPeer(name))
  const optionalPeers = peers.filter(([name]) => isOptionalPeer(name))
  const declared = new Set([...runtime, ...optional, ...peers].map(([name]) => name))

  /**
   * @param {string} name
   * @param {string} range
   * @param {string} kind
   * @param {string} field - where package.json declares it, for the problem text.
   * @returns {string[][]} the row, or none (with a problem) when the reason is missing or unusable.
   */
  const row = (name, range, kind, field) => {
    const reason = reasons[name]
    if (typeof reason !== "string" || reason.trim() === "") {
      problems.push(
        `docs/surface.json has no "dependencies" reason for "${name}", which package.json lists in ${field}.`,
      )
      return []
    }
    if (/[\r\n]/.test(reason)) {
      problems.push(
        `docs/surface.json "dependencies" reason for "${name}" spans more than one line; a table cell holds one line.`,
      )
      return []
    }
    return [[`\`${name}\``, kind, `\`${range}\``, reason]]
  }
  const rows = [
    ...runtime.flatMap(([name, range]) => row(name, range, "dependency", "dependencies")),
    ...optional.flatMap(([name, range]) =>
      row(name, range, "optional dependency", "optionalDependencies"),
    ),
    ...peers.flatMap(([name, range]) =>
      row(name, range, isOptionalPeer(name) ? "optional peer" : "peer", "peerDependencies"),
    ),
  ]
  for (const name of Object.keys(reasons)) {
    if (!declared.has(name)) {
      problems.push(
        `docs/surface.json gives a reason for "${name}", which package.json does not declare.`,
      )
    }
  }

  // One name declared as a dependency and as a required peer is one installed package.
  const installed = new Set([...runtime, ...optional, ...requiredPeers].map(([name]) => name)).size
  const viaPeers =
    requiredPeers.length === 0 ? "" : " (with npm 7 or later, which installs required peers)"
  const installs =
    installed === 0
      ? `Installing \`${pkg.name}\` installs no other packages.`
      : `Installing \`${pkg.name}\` installs ${plural(installed, "package", "packages")} directly${viaPeers}, and whatever ${installed === 1 ? "it depends" : "they depend"} on.`
  const leftToYou =
    optionalPeers.length === 0
      ? ""
      : ` It names ${plural(optionalPeers.length, "optional peer", "optional peers")}, which you install yourself when you use the part that needs ${optionalPeers.length === 1 ? "it" : "them"}.`
  if (declared.size === 0) return { problems, markdown: installs }
  return {
    problems,
    markdown: `${installs}${leftToYou}\n\n${toTable([["Package", "Kind", "Range", "Why"], ...rows])}`,
  }
}
