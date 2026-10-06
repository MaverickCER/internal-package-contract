/**
 * The organization's baseline ESLint configuration for a publishable package.
 *
 * Consumers EXTEND it, they do not copy it:
 *
 *   import baseline from "internal-package-contract/eslint"
 *   export default [...baseline, { rules: { ... } }]
 *
 * Kept deliberately small: the two well-known recommended sets as a flat-config
 * array a package can append its own blocks to, the Node globals so plain
 * `.js`/`.mjs` config and script files do not trip `no-undef`, and suppression hygiene
 * (every `eslint-disable` must be described, specific, paired and still needed).
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
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments"
import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/", "template/package/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Suppression hygiene. An `eslint-disable` is an exception to a rule, so it has to say why, name
  // exactly what it disables, close itself, and still be needed: a blanket or undocumented one, or one
  // left behind after the code it excused changed, is how a standard erodes without a record. (The
  // contract's `Suppressions` check then makes every surviving suppression visible evidence.)
  {
    plugins: { "eslint-comments": eslintComments },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "eslint-comments/require-description": "error",
      "eslint-comments/no-unlimited-disable": "error",
      "eslint-comments/disable-enable-pair": ["error", { allowWholeFile: true }],
      "eslint-comments/no-aggregating-enable": "error",
      "eslint-comments/no-duplicate-disable": "error",
    },
  },
  // Last: turn off every rule Prettier already owns, so `Lint` and `Format`
  // never disagree about the same line.
  eslintConfigPrettier,
)
