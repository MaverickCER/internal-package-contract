// The options of a contract run that are not about which checks to run: how it reports.
//
//   --json            print the report as JSON on stdout and nothing else (for an editor or a script)
//   --changed         run only the checks the changed files can affect (see scripts/changed.mjs)
//   --logs <mode>     write a log file per check: all, failing or off
//
// The log mode can also be set once for a package, in package.json under "internal-package-contract":
// { "logs": "all" }, or per run with IPC_LOGS. A flag wins over the environment, which wins over the package.

import { readFileSync } from "node:fs"
import path from "node:path"

export const LOG_MODES = ["all", "failing", "off"]
/** What is written when nothing says otherwise: the logs worth opening, not one per passing check. */
export const DEFAULT_LOGS = "failing"

/**
 * @param {readonly string[]} argv
 * @param {string} name - the flag, without dashes.
 * @returns {string | undefined} its value in `--name value` or `--name=value` form, or undefined when absent.
 */
function valueOf(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (inline !== undefined) return inline.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? undefined : (argv[index + 1] ?? "")
}

/**
 * @param {string} cwd
 * @returns {string | undefined} the log mode the package's own package.json asks for.
 */
function configuredLogs(cwd) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  } catch {
    return undefined
  }
  return manifest["internal-package-contract"]?.logs
}

/**
 * @param {readonly string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @returns {{ json: boolean, changed: boolean, logs: "all" | "failing" | "off" }}
 * @throws {Error} when the log mode, from wherever it came, is not one of the three.
 */
export function parseRunOptions(argv, env, cwd) {
  const fromFlag = valueOf(argv, "logs")
  const requested =
    fromFlag ?? (env["IPC_LOGS"] || undefined) ?? configuredLogs(cwd) ?? DEFAULT_LOGS
  if (!LOG_MODES.includes(requested)) {
    throw new Error(
      `The log mode must be one of ${LOG_MODES.join(", ")}, not "${String(requested)}" (set by ${fromFlag !== undefined ? "--logs" : env["IPC_LOGS"] ? "IPC_LOGS" : "package.json"}).`,
    )
  }
  return {
    json: argv.includes("--json"),
    changed: argv.includes("--changed"),
    logs: /** @type {"all" | "failing" | "off"} */ (requested),
  }
}
