// Adoption mode: a package that is moving to this standard starts with every check reporting its errors but
// only the promoted ones deciding the exit code, and promotes checks one at a time.
//
// Adopting a package at once is rarely possible: the first run finds Lint, Coverage, Docs and Security issues
// that have been there for years. Failing the build on all of them on day one makes people turn the standard
// off. `.repo-contract/adoption.json` says the package is adopting; while it is active a failing check is still
// reported as a failure, with its full reason, but only the checks listed under `enforce` decide the exit code.
// The policies are not softened, so what each one finds is exactly what it will find when it is enforced;
// `promote` moves checks across as they are fixed. The mode has an end date, so
// "adopting" cannot become permanent: once it has passed, the `AdoptionMode` check fails until the file is
// removed (`promote --all`).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

export const ADOPTION_FILE = ".repo-contract/adoption.json"
/** How long a package gets before every check enforces. */
export const DEFAULT_DAYS = 90
const DAY = 86_400_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * @typedef {object} Adoption
 * @property {"absent" | "active" | "expired" | "invalid"} state
 * @property {string} [startedAt]
 * @property {string} [expiresAt]
 * @property {string[]} [enforce]
 * @property {number} [daysLeft]
 * @property {string} [problem]
 */

/**
 * @param {string} cwd - the package root.
 * @param {Date} [now]
 * @returns {Adoption}
 */
export function readAdoption(cwd, now = new Date()) {
  const file = path.join(cwd, ADOPTION_FILE)
  if (!existsSync(file)) return { state: "absent" }
  let value
  try {
    value = JSON.parse(readFileSync(file).toString())
  } catch {
    return { state: "invalid", problem: `${ADOPTION_FILE} is not valid JSON.` }
  }
  const shapeProblem =
    value?.version !== 1
      ? "needs version 1."
      : !DATE.test(value.startedAt) || !DATE.test(value.expiresAt)
        ? 'needs "startedAt" and "expiresAt" dates (YYYY-MM-DD).'
        : !Array.isArray(value.enforce) || value.enforce.some((id) => typeof id !== "string")
          ? '"enforce" must be a list of check ids.'
          : undefined
  if (shapeProblem !== undefined) {
    return { state: "invalid", problem: `${ADOPTION_FILE} ${shapeProblem}` }
  }
  const end = Date.parse(`${value.expiresAt}T23:59:59.999Z`)
  const daysLeft = Math.ceil((end - now.getTime()) / DAY)
  return {
    state: end < now.getTime() ? "expired" : "active",
    startedAt: value.startedAt,
    expiresAt: value.expiresAt,
    enforce: value.enforce,
    daysLeft,
  }
}

/**
 * @param {Date} [now]
 * @param {number} [days]
 * @returns {{ version: 1, startedAt: string, expiresAt: string, enforce: string[] }} a new adoption: nothing enforced yet.
 */
export function newAdoption(now = new Date(), days = DEFAULT_DAYS) {
  const date = (time) => new Date(time).toISOString().slice(0, 10)
  return {
    version: 1,
    startedAt: date(now.getTime()),
    expiresAt: date(now.getTime() + days * DAY),
    enforce: [],
  }
}

/**
 * @param {string} cwd
 * @param {{ version: 1, startedAt: string, expiresAt: string, enforce: string[] }} adoption
 */
export function writeAdoption(cwd, adoption) {
  const file = path.join(cwd, ADOPTION_FILE)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(adoption, null, 2)}\n`)
}

/**
 * The checks whose failure does not fail the run: they still report an error, and are listed as advisory.
 * @param {Record<string, { outcome: string }>} results - each check's verdict.
 * @param {Adoption} adoption
 * @returns {string[]} the ids of failing checks the package has not promoted; empty unless adoption mode is active.
 */
export function advisoryFailures(results, adoption) {
  if (adoption.state !== "active") return []
  const enforced = new Set(adoption.enforce)
  return Object.entries(results)
    .filter(
      ([id, result]) => result.outcome === "fail" && !enforced.has(id) && id !== "AdoptionMode",
    )
    .map(([id]) => id)
}

/**
 * @param {readonly string[]} argv - what follows `promote`.
 * @param {string} cwd
 * @param {readonly string[]} available - every check id the contract declares.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {Date} [now]
 * @returns {number} the exit code.
 */
export function promote(argv, cwd, available, io, now = new Date()) {
  const usage = "Usage: internal-package-contract promote <Check> [<Check>...] | --all\n"
  const adoption = readAdoption(cwd, now)
  if (adoption.state === "absent") {
    io.err(`[promote] this package is not in adoption mode: every check already enforces.\n`)
    return 1
  }
  if (adoption.state === "invalid") {
    io.err(`[promote] ${adoption.problem}\n`)
    return 1
  }
  if (argv.length === 0) {
    io.err(`[promote] name the checks to enforce, or --all.\n${usage}`)
    return 2
  }
  if (argv.includes("--all")) {
    if (argv.length > 1) {
      io.err(`[promote] --all stands alone.\n${usage}`)
      return 2
    }
    rmSync(path.join(cwd, ADOPTION_FILE))
    io.out("[promote] adoption mode is over: every check enforces from now on.\n")
    return 0
  }
  const unknown = argv.filter((id) => !available.includes(id))
  if (unknown.length > 0) {
    io.err(`[promote] not a check: ${unknown.join(", ")}. Checks: ${available.join(", ")}.\n`)
    return 2
  }
  const enforce = [...new Set([...adoption.enforce, ...argv])].sort()
  writeAdoption(cwd, {
    version: 1,
    startedAt: adoption.startedAt,
    expiresAt: adoption.expiresAt,
    enforce,
  })
  io.out(
    `[promote] now enforcing: ${argv.join(", ")}. ${String(available.length - enforce.length)} check(s) still report failures without failing the run.\n`,
  )
  return 0
}
