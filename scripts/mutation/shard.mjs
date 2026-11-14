// What a sharded run changes about mutation testing: one slice of the sources is mutated, so that the slices can
// run as parallel jobs and finish where one job would not.
//
// `IPC_MUTATION_SHARD=i/n` selects slice `i` of `n`. The slices are cut from the files the Stryker config's `mutate`
// patterns match (or the sources a narrowed run selected), heaviest first by file size so they finish at about the
// same time. The same files always give the same slices, and every file is in exactly one. A selector that is not
// `i/n`, or asks for more slices than there are files, throws, and the check fails. `run-merge-mutation-reports.mjs`
// puts the slices' reports back together and refuses a missing or repeated one.

import { existsSync, globSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseShardSpec, planShards } from "repo-contract/affected"

/** The extensions Stryker mutates by default. */
const DEFAULT_EXTENSIONS = "+(cjs|mjs|js|ts|mts|cts|jsx|tsx|html|vue|svelte)"

/** What Stryker mutates when its config does not say: its own default `mutate`, test files and `__tests__` left out. */
const DEFAULT_MUTATE = [
  `{src,lib}/**/!(*.+(s|S)pec|*.+(t|T)est).${DEFAULT_EXTENSIONS}`,
  `!{src,lib}/**/__tests__/**/*.${DEFAULT_EXTENSIONS}`,
]

/** A line range after a file in a `mutate` pattern: `:1-10`, `:1:5-10:20`. */
const RANGE = /^(.*?)(:\d+(?::\d+)?-\d+(?::\d+)?)$/

/**
 * @param {string} entry - a `mutate` entry: a file or pattern, with a line range after it or without.
 * @returns {{ file: string, range: string }} the file part and the range, which is empty when the entry has none.
 */
function splitRange(entry) {
  const match = RANGE.exec(entry)
  return match === null ? { file: entry, range: "" } : { file: match[1], range: match[2] }
}

/**
 * @param {string} target - a target from `expandMutate`.
 * @returns {string} the file it is in (the first, when it lists several ranges of one file).
 */
export function fileOfTarget(target) {
  return splitRange(target.split(",")[0]).file
}

/**
 * @param {readonly string[]} targets - targets from `expandMutate`.
 * @returns {string[]} the files they are in, sorted, each once.
 */
export function filesOfTargets(targets) {
  return [...new Set(targets.map(fileOfTarget))].sort()
}

/**
 * @param {Record<string, string | undefined>} env - the environment of the run.
 * @returns {string | undefined} the selector the run was asked for, or `undefined` when it was not asked to shard.
 */
export function shardSpecOf(env) {
  const spec = env.IPC_MUTATION_SHARD?.trim() ?? ""
  return spec === "" ? undefined : spec
}

/**
 * @param {string} cwd - the package.
 * @param {readonly string[]} candidates - the names a Stryker config may have in the package, in order of preference.
 * @param {string | undefined} fallback - the config to use when the package has none.
 * @returns {Promise<{ mutate?: readonly string[] } | undefined>} the config, or `undefined` when there is none.
 */
export async function loadStrykerConfig(cwd, candidates, fallback) {
  const own = candidates.map((name) => path.join(cwd, name)).find((file) => existsSync(file))
  const file = own ?? fallback
  if (file === undefined) return undefined
  // Stryker disable next-line ConditionalExpression,MethodExpression: equivalent under Vitest, whose module loader
  // resolves a JSON import to the same object this reads; a real Node import of it fails, which
  // test/mutation-shard.test.ts checks in a child process.
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file))
  const loaded = await import(pathToFileURL(file).href)
  return loaded.default ?? loaded
}

/**
 * @param {{ mutate?: readonly string[] } | undefined} config - a Stryker config.
 * @returns {readonly string[]} the patterns it mutates, in order.
 */
export function mutateGlobsOf(config) {
  return config?.mutate ?? DEFAULT_MUTATE
}

/**
 * Lists what Stryker would mutate: each pattern adds the files it matches, a `!` pattern removes what it matches
 * from what the patterns before it added. A pattern may carry a line range (`src/a.ts:1-10`); a file is then mutated
 * only there, unless another pattern names it whole.
 * @param {string} cwd - the package.
 * @param {readonly string[]} patterns - Stryker `mutate` patterns.
 * @returns {string[]} one target per file, sorted by file: the file, or the file's ranges joined by commas.
 */
export function expandMutate(cwd, patterns) {
  /** @type {Map<string, string[] | null>} a file's ranges, or `null` when the whole file is mutated. */
  const ranges = new Map()
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1)
      for (const file of ranges.keys()) if (path.matchesGlob(file, negated)) ranges.delete(file)
    } else {
      const { file: glob, range } = splitRange(pattern)
      for (const match of globSync(glob, { cwd })) {
        if (!statSync(path.join(cwd, match)).isFile()) continue
        const file = match.split(path.sep).join("/")
        const held = ranges.get(file)
        if (range === "") ranges.set(file, null)
        else if (held === undefined) ranges.set(file, [range])
        else if (held !== null) held.push(range)
      }
    }
  }
  return [...ranges.keys()].sort().map(
    (file) =>
      ranges
        .get(file)
        ?.map((range) => `${file}${range}`)
        .join(",") ?? file,
  )
}

/**
 * @param {{ spec: string, files: readonly string[], sizeOf: (target: string) => number }} run - the selector, the targets
 *   a full run would mutate (see `expandMutate`), and how big each is.
 * @returns {{ skip: false, args: string[], key: string }} the Stryker arguments that restrict the run to its slice, and a
 *   key naming the restriction, which the reuse of an earlier run must take into account.
 * @throws {Error} when the selector is not `i/n`, or the package cannot be cut into `n` slices that each have a file.
 */
export function shardMutation({ spec, files, sizeOf }) {
  const parsed = parseShardSpec(spec)
  if (!parsed.ok) throw new Error(`IPC_MUTATION_SHARD: ${parsed.error}`)
  if (files.length === 0)
    throw new Error("IPC_MUTATION_SHARD: there is nothing to mutate to split.")
  if (parsed.total > files.length) {
    throw new Error(
      `IPC_MUTATION_SHARD: ${spec} asks for ${String(parsed.total)} slices but only ${String(files.length)} file(s) are mutated, so a slice would have none.`,
    )
  }
  const timingsMs = Object.fromEntries(files.map((file) => [file, sizeOf(file)]))
  const plan = planShards({ targets: files, timingsMs, shards: parsed.total })
  const list = plan.shards[parsed.index - 1].join(",")
  return { skip: false, args: ["--mutate", list], key: `shard ${spec}: ${list}` }
}
