// Puts the reports of a sharded mutation run back together (see ./shard.mjs): the report an unsharded run would
// have written, or nothing at all. A missing, repeated or unreadable shard is a failure, never a smaller report that
// looks complete.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { mergeMutationReports } from "repo-contract/affected"

/**
 * @param {readonly string[]} args - the command line: `--total <n> --out <file> <shard>=<report>...`.
 * @returns {{ ok: true, total: number, out: string, entries: { shard: number, path: string }[] } | { ok: false, error: string }}
 *   what was asked for, or what is wrong with the command line.
 */
export function parseArguments(args) {
  let total
  let out
  const entries = []
  // One iterator, advanced by the loop and by an option that takes a value: no index to step the wrong way.
  const rest = args[Symbol.iterator]()
  for (const arg of rest) {
    if (arg === "--total" || arg === "--out") {
      const next = rest.next()
      if (next.done) return { ok: false, error: `${arg} needs a value.` }
      if (arg === "--total") total = next.value
      else out = next.value
    } else if (arg.startsWith("--")) {
      return { ok: false, error: `Unknown option ${arg}.` }
    } else {
      const match = /^(\d+)=(.+)$/.exec(arg)
      if (match === null) {
        return { ok: false, error: `Each report must be written <shard>=<path>, not "${arg}".` }
      }
      entries.push({ shard: Number(match[1]), path: match[2] })
    }
  }
  if (!/^\d+$/.test(total) || Number(total) < 1) {
    return { ok: false, error: "--total must be a whole number of at least 1." }
  }
  if (out === undefined) return { ok: false, error: "--out <file> is required." }
  return { ok: true, total: Number(total), out, entries }
}

/**
 * @param {readonly string[]} args - the command line, without the program.
 * @param {string} cwd - the directory relative paths are read from and written to.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io - where to say what happened.
 * @returns {number} the exit code: 0 merged, 1 could not be merged, 2 the command line is wrong.
 */
export function run(args, cwd, io) {
  const parsed = parseArguments(args)
  if (!parsed.ok) {
    io.err(`merge-mutation-reports: ${parsed.error}\n`)
    return 2
  }
  const reports = []
  for (const entry of parsed.entries) {
    const file = path.resolve(cwd, entry.path)
    try {
      reports.push({ shard: entry.shard, report: JSON.parse(readFileSync(file)) })
    } catch (error) {
      io.err(
        `merge-mutation-reports: ${file} cannot be read as a mutation report (${error.message}).\n`,
      )
      return 1
    }
  }
  const merged = mergeMutationReports(reports, parsed.total)
  if (!merged.ok) {
    io.err(`merge-mutation-reports: ${merged.error}\n`)
    return 1
  }
  const target = path.resolve(cwd, parsed.out)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(merged.report))
  io.out(`merge-mutation-reports: merged ${String(parsed.total)} shard report(s) into ${target}\n`)
  return 0
}
