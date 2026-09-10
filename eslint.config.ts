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
