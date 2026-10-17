// `internal-package-contract upgrade <vX.Y.Z>`: moves a package to a release of this one and brings everything
// that release owns up to date, in one command.
//
// Moving the pin is the easy half. The release also changes files the package carries: the workflows that
// call its reusable workflows (pinned by commit), the managed copies and documents, the generated landing
// page, and the benchmark guides. Done by hand that is six commands in the right order, and a package that
// misses one fails its own contract on the next run. This runs them, stops at the first that fails, and
// leaves the result as ordinary uncommitted changes for a person to review and commit.

import { sync as spawnSync } from "cross-spawn"
import { spawnSync as gitSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { spawnOptions } from "../contract-prepare.mjs"

const USAGE = "Usage: internal-package-contract upgrade <vX.Y.Z>\n"
const DEPENDENCY = "internal-package-contract"
const TAG = /^v\d+\.\d+\.\d+$/

/** What a run must not overwrite: files it rewrites that a person may have edited and not committed. */
const REWRITTEN = ["package.json", "package-lock.json", ".github/workflows"]

/**
 * @param {string} cwd
 * @returns {string[]} the paths among {@link REWRITTEN} with uncommitted changes (empty outside a repository).
 */
function uncommitted(cwd) {
  const result = gitSync("git", ["status", "--porcelain", "--", ...REWRITTEN], {
    cwd,
    encoding: "utf8",
  })
  // Stryker disable next-line StringLiteral: equivalent -- stdout is null only when git could not start, which a test cannot cause.
  return (result.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3))
}

/**
 * @param {string} cwd
 * @returns {string | undefined} the repository slug (`owner/name`) the package's dependency on this one points at.
 */
function sourceSlug(cwd) {
  const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
  const spec = manifest.devDependencies?.[DEPENDENCY] ?? manifest.dependencies?.[DEPENDENCY]
  return spec?.match(/^github:([^#]+)#/)?.[1]
}

/**
 * @param {string} cwd
 * @returns {string} the commit the lockfile now pins this package to, or an empty string.
 */
function lockedSha(cwd) {
  const lock = JSON.parse(readFileSync(path.join(cwd, "package-lock.json")).toString())
  return (
    lock.packages?.[`node_modules/${DEPENDENCY}`]?.resolved?.match(/#([0-9a-f]{40})$/)?.[1] ?? ""
  )
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} where - the folder to run in.
 * @param {(command: string, args: string[], options: object) => { status: number | null, error?: unknown }} [spawn] - how
 *   to run it; a test seam.
 * @returns {number | null} the exit code, or `null` when the command did not run to the end.
 */
export function runCommand(command, args, where, spawn = spawnSync) {
  const ran = spawn(command, args, spawnOptions(where))
  // On Windows a command that is not there is reported as exit code 1 together with an error; it did not run.
  return ran.error ? null : ran.status
}

/**
 * @param {readonly string[]} argv - what follows `upgrade`.
 * @param {string} cwd - the package root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {{ spawn?: (command: string, args: string[], cwd: string) => number | null }} [hooks] - a test seam for running commands.
 * @returns {number} the exit code.
 */
export function run(argv, cwd, io, hooks = {}) {
  const spawn = hooks.spawn ?? runCommand
  const tag = argv[0]
  if (argv.length !== 1 || !TAG.test(tag)) {
    io.err(`[upgrade] expected one release tag such as v0.12.0.\n${USAGE}`)
    return 2
  }
  if (
    !existsSync(path.join(cwd, "package.json")) ||
    !existsSync(path.join(cwd, "package-lock.json"))
  ) {
    io.err("[upgrade] needs a package.json and a package-lock.json in this directory.\n")
    return 1
  }
  const slug = sourceSlug(cwd)
  if (slug === undefined) {
    io.err(
      `[upgrade] ${DEPENDENCY} is not a github: dependency here, so there is no release to move it to.\n`,
    )
    return 1
  }
  const dirty = uncommitted(cwd)
  if (dirty.length > 0) {
    io.err(
      `[upgrade] commit or stash these first, since the upgrade rewrites them:\n${dirty.map((file) => `- ${file}`).join("\n")}\n`,
    )
    return 1
  }

  const bin = path.join("node_modules", DEPENDENCY, "bin", "contract.mjs")
  /** @type {[string, string, string[]][]} */
  const steps = [
    [
      `install ${DEPENDENCY} ${tag}`,
      "npm",
      ["install", "--save-dev", "--ignore-scripts", `${DEPENDENCY}@github:${slug}#${tag}`],
    ],
  ]
  /** @param {string} label @param {string[]} args */
  const contract = (label, args) => steps.push([label, "node", [bin, ...args]])

  const execute = (/** @type {[string, string, string[]]} */ [label, command, args]) => {
    io.out(`[upgrade] ${label}\n`)
    if (spawn(command, args, cwd) === 0) return true
    io.err(
      `[upgrade] stopped: "${label}" failed. Nothing is committed; \`git restore .\` undoes the run.\n`,
    )
    return false
  }
  if (!execute(steps[0])) return 1

  const sha = lockedSha(cwd)
  const rest = []
  if (sha !== "" && existsSync(path.join(cwd, ".github", "workflows"))) {
    rest.push([
      "re-pin the workflows that call its reusable workflows",
      "node",
      [
        path.join("node_modules", DEPENDENCY, "scripts", "repin-workflows.mjs"),
        DEPENDENCY,
        sha,
        tag,
      ],
    ])
  }
  contract("bring the managed files up to date", ["sync", "--apply", "--update"])
  if (existsSync(path.join(cwd, "docs", "site.json"))) {
    contract("regenerate the landing page", ["site"])
  }
  if (existsSync(path.join(cwd, "benchmarks"))) {
    contract("copy the benchmark guides", ["sync-benchmark-guides"])
  }
  for (const step of [...rest, ...steps.slice(1)]) if (!execute(step)) return 1

  io.out(`[upgrade] done. Review the changes, add a changeset, run the contract, and commit.\n`)
  return 0
}
