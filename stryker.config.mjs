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
  disableTypeChecks: "{checks,scripts,bin,test}/**/*.{ts,mjs}",
  // Several suites run the real TypeScript compiler and API Extractor; a mutant that slows them must
  // not be mistaken for a hang on a runner slower than a developer's machine.
  timeoutMS: 120_000,
}
