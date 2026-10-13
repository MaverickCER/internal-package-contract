// `internal-package-contract verify-consumers <path>...`: does this change to the standard still work for the
// packages that depend on it?
//
// A consumer is only ever as reliable as the last time someone remembered to run its contract against a new version of
// the standard. This runs it, mechanically, and says what the change did: for each consumer checkout it runs the
// contract's fast, offline checks twice in throwaway copies of the checkout, once with the version of the standard the
// consumer has installed and once with this one, and reports every check that got worse. A check that fails both ways
// was already failing and is not blamed on the change.
//
// The consumer's own working tree and node_modules are never touched: the copies share its installed packages through
// symbolic links and replace only the standard.

import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { filesOf } from "../checkout-files.mjs"

/** The package whose installed copy is swapped. */
export const STANDARD = "internal-package-contract"

/**
 * The checks left out, because they need the network or a service (so they say the same thing whatever the standard
 * does, and fail offline) or a long run that CI makes anyway.
 */
export const NOT_RUN = [
  "BranchProtection",
  "CodeRabbit",
  "CodeScanning",
  "Coverage",
  "Crap",
  "DocsLinks",
  "Mutation",
  "SecurityDeps",
  "SecurityDevDeps",
  "SecuritySocket",
]

/** How bad each outcome is; a check regressed when its rank went up. */
const RANK = { pass: 0, skipped: 0, "not-evaluated": 1, warn: 1, fail: 2 }

/** @param {string | undefined} outcome @returns {number} how bad it is; an outcome nobody knows is as bad as a failure. */
const rank = (outcome) => RANK[/** @type {keyof typeof RANK} */ (outcome)] ?? 2

/**
 * @param {string} file - a contract's `reports/contract/report.json`.
 * @returns {Map<string, { outcome: string, rationale: string }>} every check in it, by id.
 */
export function outcomesOf(file) {
  const { checks } = JSON.parse(readFileSync(file).toString())
  return new Map(
    checks.map((/** @type {{ id: string, outcome: string, rationale?: string }} */ check) => [
      check.id,
      { outcome: check.outcome, rationale: check.rationale ?? "" },
    ]),
  )
}

/**
 * @param {Map<string, { outcome: string, rationale: string }>} before - the contract with the installed standard.
 * @param {Map<string, { outcome: string, rationale: string }>} after - the contract with this one.
 * @returns {{ regressions: { id: string, from: string, to: string, rationale: string }[], improvements: string[] }}
 *   what got worse (a check absent before counts as passing, so a new check that fails is a regression) and what got better.
 */
export function compare(before, after) {
  const regressions = []
  const improvements = []
  for (const [id, now] of after) {
    const was = before.get(id)?.outcome ?? "pass"
    if (rank(now.outcome) > rank(was)) {
      regressions.push({ id, from: was, to: now.outcome, rationale: now.rationale })
    } else if (rank(now.outcome) < rank(was)) improvements.push(id)
  }
  return { regressions, improvements }
}

/**
 * @param {string} version - an installed version, `major.minor.patch`.
 * @param {string} range - a dependency range of the standard: `^x.y.z`, `~x.y.z` or `x.y.z`.
 * @returns {boolean} whether the version satisfies it. A pre-release never does, and a range of another kind is
 *   treated as not satisfied, so it errs toward giving the standard its own copy.
 */
export function satisfies(version, range) {
  const wanted = /^([\^~]?)(\d+)\.(\d+)\.(\d+)$/.exec(range)
  const have = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (wanted === null || have === null) return false
  const [, kind, ...rest] = wanted
  const [major, minor, patch] = rest.map(Number)
  const [haveMajor, haveMinor, havePatch] = have.slice(1).map(Number)
  if (kind === "") return haveMajor === major && haveMinor === minor && havePatch === patch
  const sameMinor = haveMajor === major && haveMinor === minor
  // At least the version named, within the same major.
  const atLeast =
    haveMajor === major && (haveMinor > minor || (haveMinor === minor && havePatch >= patch))
  if (kind === "~") return sameMinor && havePatch >= patch
  if (major > 0) return atLeast
  if (minor > 0) return sameMinor && havePatch >= patch
  return sameMinor && havePatch === patch
}

/**
 * What an install of the standard would put next to its own copy rather than share with the checkout: the packages
 * the standard depends on that the checkout has not installed, or has installed at a version that does not satisfy what
 * the standard asks for.
 * @param {string} standard - the standard's checkout.
 * @param {string} consumer - the consumer's checkout.
 * @returns {{ name: string, wanted: string, installed: string | undefined }[]}
 */
export function nestedDependencies(standard, consumer) {
  const { dependencies } = JSON.parse(readFileSync(path.join(standard, "package.json")).toString())
  return Object.entries(/** @type {Record<string, string>} */ (dependencies ?? {})).flatMap(
    ([name, wanted]) => {
      const manifest = path.join(consumer, "node_modules", name, "package.json")
      const installed = existsSync(manifest)
        ? JSON.parse(readFileSync(manifest).toString()).version
        : undefined
      // Stryker disable next-line ConditionalExpression: equivalent -- a package that is not installed satisfies nothing, so testing for it first is only a shortcut.
      return installed !== undefined && satisfies(installed, wanted)
        ? []
        : [{ name, wanted, installed }]
    },
  )
}

/**
 * Makes a throwaway copy of a checkout that can run its contract.
 * @param {object} input
 * @param {string} input.consumer - the checkout.
 * @param {string | undefined} input.standard - the standard to install in the copy; the consumer's own when undefined.
 * @returns {string} the copy's directory.
 */
export function workspaceOf({ consumer, standard }) {
  const work = mkdtempSync(path.join(tmpdir(), "ipc-verify-consumers-"))
  for (const file of filesOf(consumer)) {
    // Installed packages are shared, not copied, even in a checkout that forgot to ignore them. A file git lists
    // may also have been deleted from the working tree and not yet committed.
    if (file.split(/[\\/]/)[0] === "node_modules" || !existsSync(path.join(consumer, file)))
      continue
    mkdirSync(path.dirname(path.join(work, file)), { recursive: true })
    cpSync(path.join(consumer, file), path.join(work, file))
  }
  const modules = path.join(work, "node_modules")
  mkdirSync(modules)
  for (const entry of readdirSync(path.join(consumer, "node_modules"))) {
    if (entry === STANDARD && standard !== undefined) continue
    symlinkSync(realpathSync(path.join(consumer, "node_modules", entry)), path.join(modules, entry))
  }
  if (standard !== undefined) {
    installStandard(standard, path.join(modules, STANDARD), nestedDependencies(standard, consumer))
  }
  return work
}

/**
 * Copies what the standard publishes, and gives the copy its own copy of each package that an install would have
 * nested beside it rather than shared.
 * @param {string} root - the standard's own checkout.
 * @param {string} into - where the copy goes.
 * @param {{ name: string }[]} nested - the packages to give it.
 */
function installStandard(root, into, nested) {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json")).toString())
  for (const entry of ["package.json", ...manifest.files]) {
    cpSync(path.join(root, entry), path.join(into, entry), { recursive: true })
  }
  for (const { name } of nested) {
    mkdirSync(path.dirname(path.join(into, "node_modules", name)), { recursive: true })
    symlinkSync(
      realpathSync(path.join(root, "node_modules", name)),
      path.join(into, "node_modules", name),
    )
  }
}

/**
 * @param {string} work - a copy made by {@link workspaceOf}.
 * @param {string[]} skip - the checks to leave out.
 * @returns {{ report: string | undefined, status: number | null }} where it wrote its report (if it got that far),
 *   and how it exited.
 */
export function runContract(work, skip) {
  const bin = path.join(work, "node_modules", STANDARD, "bin", "contract.mjs")
  const run = spawnSync(process.execPath, [bin, "--skip", skip.join(",")], {
    cwd: work,
    maxBuffer: 1 << 28,
    timeout: 20 * 60 * 1000,
  })
  const report = path.join(work, "reports", "contract", "report.json")
  return { report: existsSync(report) ? report : undefined, status: run.status }
}

/**
 * @param {object} input
 * @param {string} input.consumer - a checkout.
 * @param {string} input.standard - this standard's checkout.
 * @param {string[]} input.skip - the checks to leave out.
 * @param {boolean} input.keep - leave the copies in place, to look at.
 * @param {{ out: (text: string) => void }} input.io
 * @returns {{ regressions: { id: string, from: string, to: string, rationale: string }[], problem?: string }}
 */
export function verifyConsumer({ consumer, standard, skip, keep, io }) {
  if (!existsSync(path.join(consumer, "node_modules"))) {
    return { regressions: [], problem: "it has no node_modules; run `npm install` there first" }
  }
  for (const { name, wanted, installed } of nestedDependencies(standard, consumer)) {
    io.out(
      `  note: this standard wants ${name} ${wanted}; the checkout has ${installed ?? "no copy"}, so an install would add its own.\n`,
    )
  }
  const copies = [
    workspaceOf({ consumer, standard: undefined }),
    workspaceOf({ consumer, standard }),
  ]
  try {
    io.out(`  running its contract with the installed standard...\n`)
    const before = runContract(copies[0], skip)
    io.out(`  running its contract with this one...\n`)
    const after = runContract(copies[1], skip)
    if (before.report === undefined || after.report === undefined) {
      return {
        regressions: [],
        problem: `the contract did not write a report (${before.report === undefined ? "installed" : "this"} standard)`,
      }
    }
    return compare(outcomesOf(before.report), outcomesOf(after.report))
  } finally {
    if (keep) io.out(`  copies kept: ${copies.join(", ")}\n`)
    else for (const copy of copies) rmSync(copy, { recursive: true })
  }
}

const USAGE =
  "Usage: internal-package-contract verify-consumers <checkout>... [--skip a,b] [--keep]\n"

/**
 * @param {string[]} argv - the arguments after the command: checkouts of the packages that depend on this standard.
 * @param {string} cwd - the standard's own checkout.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @returns {number} the exit code: 1 when any consumer got worse, or could not be checked.
 */
export function run(argv, cwd, io) {
  const consumers = []
  /** @type {string[]} */
  let extra = []
  let keep = false
  let skipping = false
  for (const [index, arg] of argv.entries()) {
    if (skipping) {
      skipping = false
    } else if (arg === "--keep") {
      keep = true
    } else if (arg === "--skip") {
      extra = (argv[index + 1] ?? "").split(",").filter(Boolean)
      skipping = true
    } else if (arg.startsWith("--")) {
      io.err(`verify-consumers: unknown option ${arg}.\n${USAGE}`)
      return 1
    } else {
      consumers.push(path.resolve(cwd, arg))
    }
  }
  if (consumers.length === 0) {
    io.err(USAGE)
    return 1
  }
  const skip = [...new Set([...NOT_RUN, ...extra])]
  let failed = false
  for (const consumer of consumers) {
    io.out(`${path.basename(consumer)}\n`)
    const result = verifyConsumer({ consumer, standard: cwd, skip, keep, io })
    if (result.problem !== undefined) {
      io.err(`  could not be checked: ${result.problem}.\n`)
      failed = true
    } else if (result.regressions.length === 0) {
      io.out(`  no check got worse.\n`)
    } else {
      failed = true
      for (const { id, from, to, rationale } of result.regressions) {
        io.err(`  ${id}: ${from} -> ${to}. ${rationale.replace(/\n[\s\S]*/, "")}\n`)
      }
    }
  }
  io.out(failed ? "A consumer got worse or could not be checked.\n" : "No consumer got worse.\n")
  return failed ? 1 : 0
}
