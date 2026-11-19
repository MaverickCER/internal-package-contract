// Writes the package's CycloneDX 1.6 SBOMs, `docs/sbom.cdx.json` (every locked package) and
// `docs/sbom.production.cdx.json` (what installing the package brings in), from `package-lock.json`.
// It runs repo-contract's `sbom` preset in write mode: the same generator the optional `Sbom` check
// runs in check mode, so what this writes is what that check expects. Run it after the lockfile
// changes, and commit the result.
//
//   sbom                    write both documents

import { spawnSync } from "node:child_process"
import { sbom } from "repo-contract/presets"

/**
 * @param {readonly string[]} argv - none are accepted.
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {(command: string, args: readonly string[], options: { cwd: string }) => { stdout: string | Uint8Array, stderr: string | Uint8Array }} [spawn] - a test seam.
 * @returns {Promise<number>} the exit code.
 */
export async function run(argv, cwd, io, spawn = spawnSync) {
  if (argv.length > 0) {
    io.err(`[sbom] takes no arguments; got: ${argv.join(" ")}\n`)
    return 2
  }
  // The preset's command is `node -e <generator> ...`; run it under the node running this tool.
  const [, ...args] = /** @type {readonly string[]} */ (sbom({ write: true }).run)
  const child = spawn(process.execPath, args, { cwd })
  let report
  try {
    report = JSON.parse(String(child.stdout))
  } catch {
    io.err(`[sbom] the SBOM generator printed no report: ${String(child.stderr).trim()}\n`)
    return 1
  }
  if (!report.ok) {
    io.err(`[sbom] ${report.error}\n`)
    return 1
  }
  for (const document of report.documents) {
    io.out(`[sbom] wrote ${document.file} (${String(document.components)} components)\n`)
  }
  return 0
}
