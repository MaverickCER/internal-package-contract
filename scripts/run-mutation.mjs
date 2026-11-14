// The script behind the `Mutation` check: it runs Stryker and leaves the report the policy judges.
//
// It reads the package's own `stryker.config.*` when there is one, else the bundled baseline passed as
// `--fallback-config`. It also reads the scope document of the run (`reports/contract/scope.json`), and
// `IPC_MUTATION_REPORT`, `IPC_MUTATION_SHARD`, `IPC_MUTATION_MEMO` and `CI` from the environment. Every file git
// does not ignore is hashed as the inputs of the run. It writes `reports/mutation/mutation.json` and the memo
// beside it.
//
// Every mutant is run (`--force`), whatever an incremental file says: a result carried over from a loaded machine
// could pass a local gate that CI, starting cold, then fails. A narrowed run (`--scope affected`) mutates only the
// sources the change affects, and skips when there are none (scripts/mutation/narrow.mjs). A sharded run mutates
// one slice (scripts/mutation/shard.mjs). `IPC_MUTATION_REPORT` judges a report made elsewhere instead of mutating
// (scripts/mutation/adopt.mjs). A clean run is reused while nothing it depends on has changed, never under CI
// (scripts/mutation/memo.mjs). A timeout is run again alone before it counts (scripts/mutation/confirm-timeouts.mjs).
//
// Nothing here lets a package skip mutation testing. The pre-push hook leaves the check out by name; the pre-commit
// hook and the consumer `contract` job run it. Stryker's sandbox under `.stryker-tmp` is removed afterwards, as far
// as the file system allows; `bin/contract.mjs` removes it again.
//
// The exit code is Stryker's. The verdict is the policy's, in checks/mutation.ts.
//
// Usage: node run-mutation.mjs --fallback-config <abs path>

import { sync as spawnSync } from "cross-spawn"
import { existsSync, rmSync, statSync } from "node:fs"
import path from "node:path"

import { confirmEvidence, strykerRerun } from "./mutation/confirm-timeouts.mjs"
import { readScope } from "./affected-scope.mjs"
import { MEMO_DIRECTORY, inputsHash, recall, remember } from "./mutation/memo.mjs"
import { adoptReport, reportToAdopt } from "./mutation/adopt.mjs"
import { narrowMutation } from "./mutation/narrow.mjs"
import {
  expandMutate,
  fileOfTarget,
  filesOfTargets,
  loadStrykerConfig,
  mutateGlobsOf,
  shardMutation,
  shardSpecOf,
} from "./mutation/shard.mjs"
import { ensureStrykerVitest5Compat } from "./stryker-vitest5-compat.mjs"

for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

const CONFIG_CANDIDATES = [
  "stryker.config.mjs",
  "stryker.config.js",
  "stryker.config.cjs",
  "stryker.config.json",
  "stryker.conf.mjs",
  "stryker.conf.js",
  "stryker.conf.json",
  ".stryker.conf.json",
]

const fallbackIdx = process.argv.indexOf("--fallback-config")
const fallbackConfig = fallbackIdx === -1 ? undefined : process.argv[fallbackIdx + 1]

const ownConfig = CONFIG_CANDIDATES.some((c) => existsSync(path.join(process.cwd(), c)))

// Always every mutant, whatever an incremental file says. A package may keep `incremental` on for a developer
// iterating by hand, but the check's evidence must be a full analysis. A result carried over from a run made under
// other conditions (another concurrency, a loaded machine whose tests timed out and so counted as kills) can stand in
// for a run that would not have said the same. CI, starting cold, would then fail what a local gate passed.
// A narrowed run mutates only the sources a change affects (see scripts/mutation/narrow.mjs).
const scope = readScope(process.cwd())
let narrowed = narrowMutation(scope)
// `IPC_MUTATION_REPORT=<file>` judges a report made elsewhere (the merged slices of a sharded run) instead of mutating,
// and takes precedence over `IPC_MUTATION_SHARD`: a job that judges a report mutates nothing, whatever else it inherits.
const adopted = reportToAdopt(process.env, process.cwd())
// What a full run mutates, as targets (see scripts/mutation/shard.mjs): the sources a change affects when the run is
// narrowed, else what the Stryker config selects.
const strykerConfig = () => loadStrykerConfig(process.cwd(), CONFIG_CANDIDATES, fallbackConfig)
const targets = async () =>
  scope?.scope === "affected"
    ? [...(scope.mutate ?? [])]
    : expandMutate(process.cwd(), mutateGlobsOf(await strykerConfig()))
// `IPC_MUTATION_SHARD=i/n` mutates one slice, so that the slices can run as parallel jobs and finish where one job
// would not; a narrowed run is cut into slices of the sources it narrowed to.
const shard = adopted === undefined ? shardSpecOf(process.env) : undefined
if (shard !== undefined && !narrowed.skip) {
  narrowed = shardMutation({
    spec: shard,
    files: await targets(),
    sizeOf: (target) => statSync(path.join(process.cwd(), fileOfTarget(target))).size,
  })
}
const args = ["run", "--reporters", "json,clear-text", "--force", ...narrowed.args]
if (!ownConfig && fallbackConfig) args.push(fallbackConfig)

const inputs = inputsHash(process.cwd(), process.version, narrowed.key)

if (adopted !== undefined) {
  // A report cannot be judged against a change that affects no source: there is nothing it could be evidence of.
  if (narrowed.skip)
    rmSync(path.join(process.cwd(), MEMO_DIRECTORY, "mutation.json"), { force: true })
  const result = narrowed.skip
    ? {
        ok: false,
        error:
          "IPC_MUTATION_REPORT: no source file is affected by this change, so there is no report to judge.",
      }
    : await adoptReport(process.cwd(), adopted, filesOfTargets(await targets()))
  process.stderr.write(
    result.ok
      ? `[mutation] judging the report in ${adopted}; no mutant was run here.\n`
      : `[mutation] ${result.error}\n`,
  )
  process.exitCode = result.ok ? 0 : 1
} else if (narrowed.skip) {
  process.stderr.write("[mutation] skipped: no source file is affected by this change.\n")
} else if (recall(process.cwd(), inputs, process.env)) {
  process.stderr.write(
    `[mutation] reused: nothing a mutation run depends on has changed since the last clean run (inputs ${inputs.slice(0, 12)}). Set IPC_MUTATION_MEMO=0 to run it anyway.\n`,
  )
} else {
  // Vitest 5 changed how test names are matched; until the Stryker runner ships its own fix every mutant
  // would run zero tests and survive (stryker-js#6210). See scripts/stryker-vitest5-compat.mjs.
  const compat = ensureStrykerVitest5Compat(process.cwd())
  if (compat.status === "patched") {
    process.stderr.write(
      `[mutation] Vitest ${compat.vitestVersion}: aligned @stryker-mutator/vitest-runner's test-name separator with Vitest 5 (stryker-js#6210).\n`,
    )
  } else if (compat.status === "unrecognised") {
    process.stderr.write(
      `[mutation] Vitest ${compat.vitestVersion} with an @stryker-mutator/vitest-runner this package does not recognise: if every mutant survives having run 0 tests, see stryker-js#6210.\n`,
    )
  }

  const result = spawnSync("stryker", args, { stdio: "inherit" })

  try {
    rmSync(path.join(process.cwd(), ".stryker-tmp"), { recursive: true, force: true })
  } catch {
    // best effort; bin/contract.mjs cleans it too
  }

  if (result.error) throw result.error
  // A timeout that is a stalled machine and not a loop is caught when its mutant is run alone; see the module.
  const evidence = path.join(process.cwd(), MEMO_DIRECTORY, "mutation.json")
  const confirmed = confirmEvidence(
    evidence,
    strykerRerun(
      process.cwd(),
      ["run", ...(!ownConfig && fallbackConfig ? [fallbackConfig] : [])],
      evidence,
    ),
  )
  if (confirmed.confirmed > 0) {
    process.stderr.write(
      `[mutation] ${String(confirmed.confirmed)} mutant(s) timed out in the full run and were run again alone: ${String(confirmed.caught)} caught, ${String(confirmed.confirmed - confirmed.caught)} still time out.\n`,
    )
  }
  remember(process.cwd(), inputs, result.status)
  process.exitCode = typeof result.status === "number" ? result.status : 1
}
