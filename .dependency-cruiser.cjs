/**
 * Self-hosting override of the bundled dependency-cruiser baseline
 * (config/dependency-cruiser.cjs) -- resolved via `Architecture`'s own
 * `resolveConfig`(`checks/architecture.ts`), which prefers a consumer's own
 * `.dependency-cruiser.cjs` over the bundled default. This package IS such a
 * consumer of itself for `npm run contract` (see repo-contract.config.ts):
 * this repo has no `src/` (its real code lives in `checks/`), so the two
 * `^src/`-scoped rules are retargeted at `checks/`, and type resolution uses
 * `tsconfig.self.json` (the one that actually `include`s `checks/**\/*.ts`),
 * not the published `tsconfig.json` baseline (which declares no `include` at
 * all -- consumers choose that themselves).
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- dependency-cruiser only loads a CommonJS config (no ESM support), so this file must stay `.cjs`/`require`.
const baseline = require("./config/dependency-cruiser.cjs")

module.exports = {
  ...baseline,
  forbidden: baseline.forbidden.map((rule) =>
    rule.name === "not-to-dev-dep" ? { ...rule, from: { ...rule.from, path: "^checks/" } } : rule,
  ),
  options: {
    ...baseline.options,
    tsConfig: { fileName: "tsconfig.self.json" },
  },
}
