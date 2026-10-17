/**
 * Self-hosting override of the bundled Stryker baseline
 * (config/stryker.config.mjs) -- resolved by `scripts/run-mutation.mjs`, which
 * prefers a consumer's own `stryker.config.*` over the bundled default. This
 * package IS such a consumer of itself for `npm run contract` (see
 * repo-contract.config.ts): this repo has no `src/` (its real code lives in
 * `checks/`, `scripts/` and `bin/`, the scope in `scope.mjs`), so `mutate` is
 * retargeted there instead of the baseline's `src/**`.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
import baseline from "./config/stryker.config.mjs"

import { ENTRY_SHELLS, NON_RUNTIME, SCOPE_DIRS } from "./scope.mjs"

export default {
  ...baseline,
  // Everything this package ships and runs, not only `checks/` -- minus the process entry points
  // (see scope.mjs), whose logic lives in modules this does cover.
  mutate: [
    ...SCOPE_DIRS.map((dir) => `${dir}/**/*.{ts,mjs}`),
    ...[...NON_RUNTIME, ...ENTRY_SHELLS].map((glob) => `!${glob}`),
  ],
  disableTypeChecks: "{checks,scripts,bin,runtime,test}/**/*.{ts,mjs}",
  // Several suites run the real TypeScript compiler and API Extractor; a mutant that slows them must
  // not be mistaken for a hang on a runner slower than a developer's machine, or on a laptop that is swapping:
  // a different mutant timed out in each of five full runs and none did alone, so 2 minutes was a stall, not a loop.
  timeoutMS: 300_000,
  // One runner serves every mutant. A mutant that its tests kill in 15 seconds timed out at 120 only in the
  // full run, never alone or with its folder, which points at a runner worn down late in a run (the cause is
  // not proven). A fresh runner every so often is the cheap guard, and the run stays cold and exact.
  maxTestRunnerReuse: 1500,
}
