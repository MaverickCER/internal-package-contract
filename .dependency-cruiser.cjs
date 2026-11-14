/**
 * This repository's override of the bundled dependency-cruiser baseline
 * (config/dependency-cruiser.cjs). `Architecture` (`checks/architecture.ts`)
 * prefers a consumer's own `.dependency-cruiser.cjs`, and this package runs its
 * own contract as a consumer (see repo-contract.config.ts).
 *
 * This repo has no `src/`; its code lives in `checks/`. So the one
 * `^src/`-scoped rule (`not-to-dev-dep`) is retargeted at `checks/`. Type
 * resolution uses `tsconfig.self.json`, which `include`s `checks/**\/*.ts`. The
 * published `tsconfig.json` baseline declares no `include`; consumers choose it.
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
