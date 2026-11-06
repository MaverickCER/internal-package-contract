// What a sharded run changes about mutation testing: one slice of the package's sources is mutated, so that the
// slices can run as parallel jobs and finish where one job would not.
//
// `IPC_MUTATION_SHARD=i/n` selects slice `i` of `n`. The slices are the files the Stryker config's `mutate` patterns
// match, split heaviest-first (by size, a stand-in for how many mutants a file has) so they finish at about the same
// time, and the same files always give the same slices. Every file is in exactly one slice; `run-merge-mutation-reports.mjs`
// puts the slices' reports back together and refuses a missing or repeated one.

import { existsSync, globSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseShardSpec, planShards } from "repo-contract/affected"

/** What Stryker mutates when its config does not say. */
const DEFAULT_MUTATE = ["src/**/*.ts"]

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
 * Lists the files Stryker would mutate: each pattern adds the files it matches, a `!` pattern removes what it matches
 * from what the patterns before it added.
 * @param {string} cwd - the package.
 * @param {readonly string[]} patterns - Stryker `mutate` patterns.
 * @returns {string[]} the files, relative to the package, sorted.
 */
export function expandMutate(cwd, patterns) {
  const files = new Set()
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1)
      for (const file of files) if (path.matchesGlob(file, negated)) files.delete(file)
    } else {
      for (const file of globSync(pattern, { cwd })) {
        if (statSync(path.join(cwd, file)).isFile()) files.add(file.split(path.sep).join("/"))
      }
    }
  }
  return [...files].sort()
}

/**
 * @param {{ spec: string, files: readonly string[], sizeOf: (file: string) => number }} run - the selector, the files
 *   a full run would mutate, and how big each is.
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
