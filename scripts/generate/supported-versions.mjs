// The "supported-versions" region: what a package needs installed, read from `package.json`, so no document
// restates a version range by hand. The Node.js range comes from `engines.node`; each peer dependency comes
// from `peerDependencies`, marked optional when `peerDependenciesMeta` says so. A package.json with neither
// stops generation, since the region would say nothing.

import { toTable } from "./entry-points.mjs"

/**
 * @param {any} pkg - the parsed `package.json`.
 * @returns {{ problems: string[], markdown: string }} the region's body, or what stops it being written.
 */
export function supportedVersionsRegion(pkg) {
  const rows = [["Requirement", "Range", "Needed"]]
  const node = pkg?.engines?.node
  if (typeof node === "string") rows.push(["Node.js", `\`${node}\``, "always"])
  const peers = pkg?.peerDependencies ?? {}
  const meta = pkg?.peerDependenciesMeta ?? {}
  for (const name of Object.keys(peers).sort()) {
    rows.push([
      `\`${name}\``,
      `\`${String(peers[name])}\``,
      meta[name]?.optional === true ? "optional" : "always",
    ])
  }
  if (rows.length === 1) {
    return {
      problems: [
        'package.json has no "engines.node" and no "peerDependencies" for the "supported-versions" region.',
      ],
      markdown: toTable(rows),
    }
  }
  return { problems: [], markdown: toTable(rows) }
}
