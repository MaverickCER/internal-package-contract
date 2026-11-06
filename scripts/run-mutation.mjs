// Stryker runner for the `Mutation` check.
//
// Mutation testing is part of the standard contract and runs on every
// `npm run contract` -- it is NOT opt-in, and a package cannot satisfy the contract by leaving
// out a `stryker.config.*`. It is expensive (minutes to tens of minutes on a large `src/`), so the
// fast hook subsets (pre-commit, pre-push) skip it by name; a consumer that wants a fast local
// loop runs an explicit subset (`internal-package-contract --skip Mutation`). The full contract --
// CI and a bare `npm run contract` -- always includes it.
//
// Uses the consumer's own `stryker.config.*` when present; otherwise the bundled baseline passed as
// `--fallback-config`. On a package with nothing to mutate yet, Stryker's own dry run fails
// ("No tests were executed") and so does the check: like Lint, Typecheck and Build, Mutation is
// not something a new package gets to skip.
//
// Stryker copies the whole project into `.stryker-tmp/sandbox-*/` (hundreds of
// MB); this wrapper always cleans it, and `bin/contract.mjs` cleans it again.
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
// iterating by hand, but the check's evidence must be a full analysis: a result carried over from a run made under other
// conditions (another concurrency, a loaded machine whose tests timed out and so counted as kills) can stand in for
// a run that would not have said the same, and CI, starting cold, would then fail what a local gate passed.
// A narrowed run mutates only the sources a change affects (see scripts/mutation/narrow.mjs).
const scope = readScope(process.cwd())
let narrowed = narrowMutation(scope)
// `IPC_MUTATION_SHARD=i/n` mutates one slice, so that the slices can run as parallel jobs and finish where one job
// would not; a narrowed run is cut into slices of the sources it narrowed to. See scripts/mutation/shard.mjs.
const shard = shardSpecOf(process.env)
if (shard !== undefined && !narrowed.skip) {
  const files =
    scope?.scope === "affected"
      ? [...(scope.mutate ?? [])]
      : expandMutate(
          process.cwd(),
          mutateGlobsOf(await loadStrykerConfig(process.cwd(), CONFIG_CANDIDATES, fallbackConfig)),
        )
  narrowed = shardMutation({
    spec: shard,
    files,
    sizeOf: (file) => statSync(path.join(process.cwd(), file)).size,
  })
}
const args = ["run", "--reporters", "json,clear-text", "--force", ...narrowed.args]
if (!ownConfig && fallbackConfig) args.push(fallbackConfig)

const inputs = inputsHash(process.cwd(), process.version, narrowed.key)

// `IPC_MUTATION_REPORT=<file>` judges a report made elsewhere (the merged slices of a sharded run) instead of mutating.
const adopted = reportToAdopt(process.env, process.cwd())

if (adopted !== undefined) {
  const result = adoptReport(process.cwd(), adopted)
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
    // best effort -- bin/contract.mjs cleans it too
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
