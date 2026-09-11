/**
 * Self-hosting override of the bundled Stryker baseline
 * (config/stryker.config.mjs) -- resolved by `scripts/run-mutation.mjs`, which
 * prefers a consumer's own `stryker.config.*` over the bundled default. This
 * package IS such a consumer of itself for `npm run contract` (see
 * repo-contract.config.ts): this repo has no `src/` (its real code lives in
 * `checks/`, matching `vitest.config.ts`'s coverage scope), so `mutate` is
 * retargeted there instead of the baseline's `src/**`.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
import baseline from "./config/stryker.config.mjs"

export default {
  ...baseline,
  mutate: ["checks/**/*.ts", "!checks/**/*.test.ts"],
  disableTypeChecks: "{checks,test}/**/*.ts",
}
