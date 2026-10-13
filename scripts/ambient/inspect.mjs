// Reads a package's tarball and says what it reaches (see scan.mjs). Shared by the `AmbientCapabilities` check's
// entry shell and by `tool ambient`, so the two cannot disagree.

import { sync as spawnSync } from "cross-spawn"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readTarball } from "../packed-consumer/plan.mjs"
import { normalizeConfig, scanFiles } from "./scan.mjs"

/**
 * @param {string} cwd - the package's root.
 * @param {string} into - where to put the tarball.
 * @returns {string} the path of the tarball `npm pack` wrote.
 */
export function npmPack(cwd, into) {
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", into], {
    cwd,
    encoding: "utf8",
  })
  // Stryker disable next-line StringLiteral: equivalent -- `split` always yields an element, so the fallback is never used.
  return path.join(into, packed.stdout.trim().split("\n").at(-1) ?? "")
}

/**
 * @param {object} input
 * @param {string} input.cwd - the package's root.
 * @param {string} [input.tarball] - a tarball to read, instead of packing the package.
 * @param {(cwd: string, into: string) => string} [input.pack] - how the package is packed.
 * @returns {object} the report: its `state` (`exempt`, `misconfigured`, `unpacked`, `clean` or `violations`) and what goes with it.
 */
export function inspectAmbient({ cwd, tarball, pack = npmPack }) {
  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  if (manifest.private === true) return { state: "exempt" }
  const { config, problems } = normalizeConfig(
    manifest["internal-package-contract"]?.ambientCapabilities,
  )
  if (problems.length > 0) return { state: "misconfigured", problems }
  const work = mkdtempSync(path.join(tmpdir(), "ipc-ambient-"))
  try {
    const file = tarball === undefined ? pack(cwd, work) : path.resolve(cwd, tarball)
    if (!existsSync(file)) return { state: "unpacked", message: `no tarball to check at ${file}.` }
    const files = readTarball(readFileSync(file))
    const packed = files.find((entry) => entry.name === "package.json")
    const { violations, exempt, checked } = scanFiles({
      files,
      manifest: packed === undefined ? manifest : JSON.parse(packed.content.toString()),
      config,
    })
    return { state: violations.length === 0 ? "clean" : "violations", checked, violations, exempt }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
