// `internal-package-contract init`: one command to start using this standard.
//
//   in an existing package:        internal-package-contract init [--tag vX.Y.Z] [--owner <owner>] [--dry-run]
//   in an empty directory:         internal-package-contract init --name <package> [--owner <owner>] [--description <text>]
//
// An existing package is adopted, or has its setup finished if it already is (see scripts/init/existing.mjs). A new package is scaffolded, installed, scaffolded
// again (the workflows that pin a commit can only be written once the lockfile names one), has its generated
// regions written, and ends with `doctor`. Either way the command ends by listing what is left, including the
// steps only a person can take.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { runCommand } from "../upgrade/run.mjs"
import { run as initExisting } from "./existing.mjs"

const USAGE =
  "Usage: internal-package-contract init [--name <package>] [--owner <owner>] [--description <text>] [--tag vX.Y.Z | --spec <dependency spec>] [--github] [--docs] [--strict] [--dry-run]\n"
const DEPENDENCY = "internal-package-contract"

/**
 * @param {readonly string[]} argv
 * @returns {{ name?: string, owner?: string, description?: string, tag?: string, spec?: string, dryRun: boolean, github: boolean, docs: boolean, strict: boolean, errors: string[] }}
 */
function parseArgs(argv) {
  /** @type {{ name?: string, owner?: string, description?: string, tag?: string, spec?: string, dryRun: boolean, github: boolean, docs: boolean, strict: boolean, errors: string[] }} */
  const args = { dryRun: false, github: false, docs: false, strict: false, errors: [] }
  const items = argv[Symbol.iterator]()
  for (const arg of items) {
    if (arg === "--dry-run") args.dryRun = true
    else if (arg === "--github") args.github = true
    else if (arg === "--docs") args.docs = true
    else if (arg === "--strict") args.strict = true
    else if (["--name", "--owner", "--description", "--tag", "--spec"].includes(arg)) {
      const value = items.next().value
      if (value === undefined || value === "") args.errors.push(`${arg} needs a value.`)
      else args[arg.slice(2)] = value
    } else args.errors.push(`unknown argument: ${arg}`)
  }
  return args
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{
 *   packageRoot: string,
 *   spawn?: (command: string, args: string[], cwd: string) => number | null,
 *   capture?: (command: string, args: string[], cwd: string) => { status: number, stdout: string },
 * }} hooks
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io, hooks) {
  const args = parseArgs(argv)
  if (args.errors.length > 0) {
    io.err(`[init] ${args.errors.join(" ")}\n${USAGE}`)
    return 2
  }
  if (existsSync(path.join(cwd, "package.json"))) {
    if (args.name !== undefined || args.description !== undefined) {
      io.err(
        "[init] this directory already has a package.json, so it is brought under the standard as it is; --name and --description are only for a new package.\n",
      )
      return 2
    }
    return initExisting(
      [
        ...(args.tag ? ["--tag", args.tag] : []),
        ...(args.spec ? ["--spec", args.spec] : []),
        ...(args.owner ? ["--owner", args.owner] : []),
        ...(args.github ? ["--github"] : []),
        ...(args.docs ? ["--docs"] : []),
        ...(args.strict ? ["--strict"] : []),
        ...(args.dryRun ? ["--dry-run"] : []),
      ],
      cwd,
      io,
      hooks,
    )
  }
  if (args.name === undefined) {
    io.err(
      "[init] there is no package.json here, so say what to start: `init --name <package>` makes a new package in this directory.\n",
    )
    return 2
  }
  if (args.dryRun) {
    io.out(
      `[init] would scaffold ${args.name} here, install, scaffold again with the pin the lockfile names, generate the API map, document the environment and run doctor. Nothing was changed (dry run).\n`,
    )
    return 0
  }

  const spawn = hooks.spawn ?? runCommand
  const init = [
    "--name",
    args.name,
    ...(args.owner ? ["--owner", args.owner] : []),
    ...(args.description ? ["--description", args.description] : []),
    ...(args.github ? [] : ["--no-github"]),
  ]
  const installedBin = (file) => `node_modules/${DEPENDENCY}/bin/${file}`
  /** @param {string} label @param {string} command @param {string[]} commandArgs */
  const command = (label, program, commandArgs) => ({
    label,
    run: () => spawn(program, commandArgs, cwd),
  })
  // `--spec` names the dependency outright (a fork, or a local copy while the standard itself is being
  // developed), instead of the release this checkout would otherwise pin.
  const pin = {
    label: `pin ${DEPENDENCY} to ${String(args.spec)}`,
    run: () => {
      const file = path.join(cwd, "package.json")
      const manifest = JSON.parse(readFileSync(file).toString())
      manifest.devDependencies = { ...manifest.devDependencies, [DEPENDENCY]: args.spec }
      writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
      return 0
    },
  }
  const steps = [
    command("start a git repository", "git", ["init", "-q"]),
    command("scaffold the package", "node", [
      path.join(hooks.packageRoot, "bin", "scaffold.mjs"),
      ...init,
    ]),
    ...(args.spec === undefined ? [] : [pin]),
    command("install", "npm", ["install", "--ignore-scripts"]),
    // The workflows that pin a commit were skipped the first time, because no lockfile named one yet.
    command("scaffold what needed the pin", "node", [installedBin("scaffold.mjs"), ...init]),
    command("generate the API map", "node", [installedBin("contract.mjs"), "generate"]),
    command("document the environment", "node", [installedBin("contract.mjs"), "env"]),
  ]
  // Already a repository (a cloned empty one, for instance): do not start another.
  if (existsSync(path.join(cwd, ".git"))) steps.shift()
  for (const { label, run: stepRun } of steps) {
    io.out(`[init] ${label}\n`)
    if (stepRun() !== 0) {
      io.err(`[init] stopped: "${label}" failed.\n`)
      return 1
    }
  }
  io.out("\n")
  spawn("node", [installedBin("contract.mjs"), "doctor"], cwd)
  io.out(
    "\n[init] done. Answer the prompts, review the files, run `npm run contract`, and make the first commit.\n",
  )
  return 0
}
