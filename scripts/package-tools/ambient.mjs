// Says what the package that would be published reaches that it must be handed (see scripts/ambient/scan.mjs),
// for a build step or a CI job that wants this one answer without running the contract.
//
//   ambient [--tarball <file.tgz>]

import { inspectAmbient } from "../ambient/inspect.mjs"

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{ inspect?: typeof inspectAmbient }} [hooks]
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io, hooks = {}) {
  const flag = argv.indexOf("--tarball")
  const report = (hooks.inspect ?? inspectAmbient)({
    cwd,
    tarball: flag === -1 ? undefined : argv[flag + 1],
  })
  switch (report.state) {
    case "exempt":
      io.out("[ambient] this package is private, so nothing it ships is received.\n")
      return 0
    case "clean":
      io.out(
        `[ambient] none of the ${String(report.checked)} shipped file(s) reaches what it must be handed.\n`,
      )
      return 0
    case "violations":
      io.err(
        `[ambient] the package reaches what it must be handed:\n${report.violations
          .map(({ file, capability, hit }) => `- ${file}: ${capability} (${hit})`)
          .join("\n")}\n`,
      )
      return 1
    case "misconfigured":
      io.err(
        `[ambient] ambientCapabilities in package.json is not valid:\n${report.problems.map((line) => `- ${line}`).join("\n")}\n`,
      )
      return 1
    default:
      io.err(`[ambient] ${report.message}\n`)
      return 1
  }
}
