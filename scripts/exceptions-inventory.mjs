#!/usr/bin/env node
// "What rules are we currently breaking, and why?" -- one answer, across every exception registry.
//
//   internal-package-contract exceptions [--json]
//
// Reads every `.repo-contract/exceptions/*.json` and reports, per registry, how many records it holds,
// how they break down by `exceptionType`, how many are still the legacy `version: 1` shape (which
// cannot say what rule is broken or when to revisit it), how many have expired, and how many are blank
// stubs waiting to be written. The same inventory is attached to the contract's `report.json` and shown
// in its step summary, so the answer travels with every run.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** Where a repository keeps its exception registries. */
export const REGISTRY_DIR = path.join(".repo-contract", "exceptions")

const V2_FIELDS = [
  "ruleBroken",
  "attempted",
  "constraint",
  "whyPreferable",
  "residualRisk",
  "revisitWhen",
]

/** @param {unknown} value @returns {boolean} */
function blank(value) {
  return typeof value !== "string" || value.trim() === ""
}

/**
 * @param {unknown} record
 * @param {Date} now
 * @returns {{ type: string, legacy: boolean, expired: boolean, incomplete: boolean }}
 */
function describeRecord(record, now) {
  const flat = typeof record === "object" && record !== null ? record : {}
  const legacy = flat.version !== 2
  const type =
    typeof flat.exceptionType === "string" && flat.exceptionType !== ""
      ? flat.exceptionType
      : "(untyped)"
  const expired =
    typeof flat.expires === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(flat.expires) &&
    flat.expires < now.toISOString().slice(0, 10)
  const incomplete =
    blank(flat.justification) || (!legacy && V2_FIELDS.some((key) => blank(flat[key])))
  return { type, legacy, expired, incomplete }
}

/**
 * @param {readonly { name: string, records: readonly unknown[] }[]} registries
 * @param {Date} [now]
 */
export function summarizeRegistries(registries, now = new Date()) {
  const summaries = registries.map(({ name, records }) => {
    const byType = {}
    let legacy = 0
    let expired = 0
    let incomplete = 0
    for (const record of records) {
      const described = describeRecord(record, now)
      byType[described.type] = (byType[described.type] ?? 0) + 1
      if (described.legacy) legacy += 1
      if (described.expired) expired += 1
      if (described.incomplete) incomplete += 1
    }
    return { name, total: records.length, byType, legacy, expired, incomplete }
  })
  return {
    registries: summaries,
    total: summaries.reduce((sum, r) => sum + r.total, 0),
    legacy: summaries.reduce((sum, r) => sum + r.legacy, 0),
    expired: summaries.reduce((sum, r) => sum + r.expired, 0),
    incomplete: summaries.reduce((sum, r) => sum + r.incomplete, 0),
  }
}

/**
 * Reads the registries under `cwd`. An unreadable or malformed file is reported as an `error` row,
 * never thrown: the check that owns that registry fails on it; the inventory just says it is there.
 * @param {string} cwd
 * @param {Date} [now]
 */
export function collectInventory(cwd, now = new Date()) {
  const dir = path.join(cwd, REGISTRY_DIR)
  if (!existsSync(dir)) return summarizeRegistries([], now)
  const registries = []
  const errors = []
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const name = file.replace(/\.json$/, "")
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, file), "utf8"))
      const records = Array.isArray(parsed?.exceptions) ? parsed.exceptions : undefined
      if (records === undefined) throw new Error('no "exceptions" array')
      registries.push({ name, records })
    } catch (error) {
      errors.push({ name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { ...summarizeRegistries(registries, now), errors }
}

/** @param {ReturnType<typeof collectInventory>} inventory */
export function renderInventory(inventory) {
  if (inventory.registries.length === 0 && (inventory.errors ?? []).length === 0) {
    return "No exceptions recorded: nothing in this repository is breaking a rule on purpose.\n"
  }
  const lines = [
    `${String(inventory.total)} exception(s) across ${String(inventory.registries.length)} registr${inventory.registries.length === 1 ? "y" : "ies"}` +
      ` (${String(inventory.legacy)} legacy version 1, ${String(inventory.expired)} expired, ${String(inventory.incomplete)} incomplete).`,
    "",
  ]
  for (const registry of inventory.registries) {
    const types = Object.entries(registry.byType)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([type, count]) => `${type} ${String(count)}`)
      .join(", ")
    lines.push(
      `- ${registry.name}: ${String(registry.total)}${types ? ` (${types})` : ""}` +
        `${registry.legacy > 0 ? `; ${String(registry.legacy)} legacy` : ""}` +
        `${registry.expired > 0 ? `; ${String(registry.expired)} expired` : ""}` +
        `${registry.incomplete > 0 ? `; ${String(registry.incomplete)} incomplete` : ""}`,
    )
  }
  for (const failure of inventory.errors ?? [])
    lines.push(`- ${failure.name}: UNREADABLE -- ${failure.error}`)
  return `${lines.join("\n")}\n`
}

/**
 * Prints the inventory.
 * @param {readonly string[]} argv - the arguments after the subcommand (`--json` for machine output).
 * @param {string} cwd
 * @param {{ write(text: string): unknown }} out
 */
export function runInventory(argv, cwd, out) {
  const inventory = collectInventory(cwd)
  out.write(
    argv.includes("--json")
      ? `${JSON.stringify(inventory, null, 2)}\n`
      : renderInventory(inventory),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runInventory(process.argv.slice(2), process.cwd(), process.stdout)
}
