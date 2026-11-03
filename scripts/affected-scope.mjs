// The scope of a contract run: everything, or only what the changes can affect.
//
// `--scope affected|full|auto` (and `--base <ref>`) choose it. Nothing is narrowed unless asked for: a bare run
// is a full one, `auto` lets the environment decide (a pull request narrows, a push and a release do not), and
// a release is full whatever is asked. When the analysis cannot be sure, it says "everything" and so does this.
// The answer is written to `reports/contract/scope.json`, where the checks that can use it read it from; the
// run's cleanup leaves that directory alone.

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { computeAffectedFromGit, parseScopeArgs, resolveScope } from "repo-contract/affected"

/** Where the scope of the current run is kept, relative to the repository. */
export const SCOPE_PATH = path.join("reports", "contract", "scope.json")

/** Output beyond this is an operational failure, never silently treated as "no changes". */
const MAX_BUFFER = 512 * 1024 * 1024

const EMPTY = { changedFiles: [], tests: [], sources: [], mutate: [] }

/** Why a run that did not ask for less covers everything. */
const UNLESS_ASKED = "nothing asked for less (--scope affected or auto does)"

/**
 * @param {string} cwd - the repository.
 * @returns {{ git: (args: readonly string[]) => Promise<string | undefined>, readFile: (file: string) => Promise<string | undefined> }} what the analysis reads the repository with.
 */
export function capabilities(cwd) {
  return {
    git: async (args) => {
      const result = spawnSync("git", [...args], { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER })
      // git missing, or output too large: not "git said no" -- the analysis cannot run.
      if (result.error) throw result.error
      return result.status === 0 ? result.stdout : undefined
    },
    readFile: (file) => readFile(path.resolve(cwd, file), "utf8").catch(() => undefined),
  }
}

/**
 * @param {string} cwd - the project, whose own TypeScript is the one to use.
 * @returns {unknown} the `typescript` module the project has installed.
 */
function projectTypeScript(cwd) {
  return createRequire(path.join(cwd, "package.json"))("typescript")
}

/**
 * Asks the affected analysis what the working tree's changes can affect, compared with a base.
 * @param {string} cwd - the repository.
 * @param {string | undefined} base - the ref to compare with; the upstream branch, then origin/main, when absent.
 * @param {(cwd: string) => unknown} [loadTypeScript] - loads the project's TypeScript; a test seam.
 * @returns {Promise<import("repo-contract/affected").AffectedResult>} the analysis.
 * @throws {Error} when the project has no usable TypeScript, or git cannot run.
 */
export async function computeFromGit(cwd, base, loadTypeScript = projectTypeScript) {
  let ts
  try {
    ts = loadTypeScript(cwd)
  } catch (error) {
    throw new Error(
      `TypeScript could not be loaded from the project (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    )
  }
  if (typeof ts?.createSourceFile !== "function") {
    throw new Error("the installed TypeScript has no compiler API (TypeScript 7 does not)")
  }
  return computeAffectedFromGit({ ts, capabilities: capabilities(cwd), base })
}

/**
 * @param {{ reason: string, file: string, detail?: string }} because - why the analysis went wide.
 * @returns {string} that as one line.
 */
const becauseText = ({ reason, file, detail }) =>
  `${reason}: ${file}${detail === undefined ? "" : ` -- ${detail}`}`

/**
 * @param {string} reason - why everything runs.
 * @returns {object} a scope document for a full run.
 */
const full = (reason) => ({ schemaVersion: 1, scope: "full", reason, ...EMPTY })

/**
 * Decides the scope of a run from its arguments and environment, and asks the analysis when it is narrow.
 * @param {object} input
 * @param {readonly string[]} input.argv - the command line.
 * @param {NodeJS.ProcessEnv} input.env - the environment.
 * @param {string} input.cwd - the repository.
 * @param {(cwd: string, base: string | undefined) => Promise<import("repo-contract/affected").AffectedResult>} [input.compute] - the analysis; a test seam.
 * @returns {Promise<object>} the scope document.
 * @throws {Error} with `usage: true` when `--scope` or `--base` is misused.
 */
export async function resolveRunScope({ argv, env, cwd, compute = computeFromGit }) {
  const parsed = parseScopeArgs(argv)
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { usage: true })
  // A bare run is a full one; an environment setting is still honoured below a flag.
  if (parsed.scope === undefined && !env["REPO_CONTRACT_SCOPE"]) return full(UNLESS_ASKED)
  const decision = resolveScope({ requested: parsed.scope, env })
  if (decision.scope === "full") return full(decision.reason)

  let result
  try {
    result = await compute(cwd, parsed.base)
  } catch (error) {
    return full(
      `the affected analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (result.scope === "full") return full(becauseText(result.fullBecause))
  return {
    schemaVersion: 1,
    scope: "affected",
    reason: decision.reason,
    ...(parsed.base === undefined ? {} : { base: parsed.base }),
    changedFiles: [...result.changedFiles],
    tests: [...result.affectedTests],
    sources: [...result.affectedSources],
    mutate: [...result.mutateTargets],
  }
}

/**
 * @param {string} cwd - the repository.
 * @param {object} doc - the scope document.
 */
export function writeScope(cwd, doc) {
  mkdirSync(path.dirname(path.join(cwd, SCOPE_PATH)), { recursive: true })
  writeFileSync(path.join(cwd, SCOPE_PATH), `${JSON.stringify(doc, null, 2)}\n`)
}

const isTextList = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

/**
 * @param {string} cwd - the repository.
 * @returns {object | undefined} the scope of the current run, or `undefined` when there is none or it is not one.
 */
export function readScope(cwd) {
  let doc
  try {
    doc = JSON.parse(readFileSync(path.join(cwd, SCOPE_PATH)).toString())
  } catch {
    // No file, or text that is not JSON: `doc` stays undefined and is refused below.
  }
  if (doc?.schemaVersion !== 1) return undefined
  if (doc.scope === "full") {
    return full(typeof doc.reason === "string" ? doc.reason : "")
  }
  if (
    doc.scope !== "affected" ||
    !["changedFiles", "tests", "sources", "mutate"].every((name) => isTextList(doc[name]))
  ) {
    return undefined
  }
  return doc
}

/**
 * @param {number} count - how many.
 * @param {string} noun - what, singular.
 * @returns {string} the count with its noun.
 */
const counted = (count, noun) => `${String(count)} ${noun}${count === 1 ? "" : "s"}`

/**
 * @param {{ scope: string, reason: string, changedFiles: string[], tests: string[], mutate: string[] }} doc - the scope document.
 * @returns {string} one line saying what the run will do.
 */
export function describeScope(doc) {
  const head = `scope: ${doc.scope} (${doc.reason})`
  return doc.scope === "full"
    ? head
    : `${head} -- ${counted(doc.changedFiles.length, "changed file")}, ${counted(doc.tests.length, "test file")}, ${counted(doc.mutate.length, "mutation target")}`
}

/** The check that runs the package's tests, whose command is narrowed to the affected test files. */
const TESTS_CHECK = "Tests"
/** What runs instead of the test suite when no test file is affected; its policy says so. */
const NOTHING_TO_RUN = ["node", "--version"]

/**
 * Narrows a narrowed run's checks. Every policy is handed the scope, as `ctx.scope`, so a check that can judge only
 * what the run covered knows what that was; the test command names only the affected test files (or does nothing when
 * there are none). A full run's config is returned as it is: nothing about it changes.
 * @template {{ checks: Record<string, { run?: unknown, policy: (ctx: any) => unknown }> }} Config
 * @param {Config} config - the contract's configuration.
 * @param {{ scope: string, tests?: string[] }} doc - the scope document.
 * @returns {Config} the configuration the run uses.
 */
export function withScope(config, doc) {
  if (doc.scope !== "affected") return config
  return {
    ...config,
    checks: Object.fromEntries(
      Object.entries(config.checks).map(([id, check]) => [
        id,
        {
          ...check,
          ...(id === TESTS_CHECK && Array.isArray(check.run)
            ? { run: doc.tests.length === 0 ? NOTHING_TO_RUN : [...check.run, ...doc.tests] }
            : {}),
          policy: (ctx) => check.policy({ ...ctx, scope: doc }),
        },
      ]),
    ),
  }
}
