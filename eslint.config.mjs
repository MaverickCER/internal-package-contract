/**
 * The organization's baseline ESLint configuration for a publishable package.
 *
 * Consumers EXTEND it, they do not copy it:
 *
 *   import baseline from "internal-package-contract/eslint"
 *   export default [...baseline, { rules: { ... } }]
 *
 * Kept deliberately small: the two well-known recommended sets as a flat-config
 * array a package can append its own blocks to, plus the Node globals so plain
 * `.js`/`.mjs` config and script files do not trip `no-undef`.
 *
 * Non-type-checked on purpose. `recommendedTypeChecked` would require every
 * consumer to wire `parserOptions.projectService` and a tsconfig, which defeats
 * "extend the baseline in one line."
 *
 * Plain JavaScript, not TypeScript, despite every other module in this package
 * being `.ts`: this file is imported directly by a consumer's own
 * `eslint.config.js`/`.mjs` (`import baseline from "internal-package-contract/
 * eslint"`), and Node's native TypeScript type-stripping explicitly refuses to
 * strip a file that lives under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) -- confirmed directly: a
 * plain `import()` of this path as a `.ts` file fails with exactly that error
 * once installed as a dependency, even though it works fine loaded from this
 * package's own source tree. `jiti` (already a dependency here, and used by
 * ESLint's own config loader to load a *consumer's own* `eslint.config.ts`)
 * does not help either -- it only intercepts the top-level config file
 * ESLint itself loads, not this file's nested `node_modules` import from
 * inside that config. Shipping this as plain `.js` sidesteps the whole
 * problem: no loader, no build step, no extra consumer dependency, just an
 * ordinary import that always works. See `./prettier.config.mjs` for the
 * same reasoning.
 */
import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Last: turn off every rule Prettier already owns, so `Lint` and `Format`
  // never disagree about the same line.
  eslintConfigPrettier,
)
