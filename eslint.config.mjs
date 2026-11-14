/**
 * The organization's baseline ESLint configuration for a publishable package.
 *
 * Consumers EXTEND it, they do not copy it:
 *
 *   import baseline from "internal-package-contract/eslint"
 *   export default [...baseline, { rules: { ... } }]
 *
 * It holds little on purpose:
 * - the two well-known recommended sets, as a flat-config array a package appends its own blocks to;
 * - the Node globals, so plain `.js`/`.mjs` config and script files pass `no-undef`;
 * - suppression hygiene: every `eslint-disable` is described, specific, paired and still needed;
 * - one rule of the standard's own: `src/` opens no network connection (`ipc/no-network`).
 *
 * It is not type-checked. `recommendedTypeChecked` would make every consumer wire
 * `parserOptions.projectService` and a tsconfig, so extending it would no longer be one line.
 *
 * It is plain JavaScript, unlike the rest of this package, because a consumer's `eslint.config.js` imports it
 * from `node_modules`. Node refuses to strip TypeScript types there
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `jiti` does not help: ESLint uses it only for the
 * consumer's own top-level config file, not for what that file imports. A plain `.js` file needs no loader,
 * no build step and no extra consumer dependency. `./prettier.config.mjs` is plain JavaScript for the same
 * reason.
 */
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments"
import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import globals from "globals"
import tseslint from "typescript-eslint"

import { noNetwork } from "./scripts/eslint/no-network.mjs"

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "node_modules/", "template/package/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // The generated landing page's script runs in a browser, in the same plain-JavaScript style as the
  // published sites it replaces, so it gets browser globals and may ignore a caught error it cannot act on.
  {
    files: ["scripts/site/assets/script.js"],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }] },
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
  // A library's source opens no network connection (see scripts/eslint/no-network.mjs for what counts and why
  // this is a rule of its own). `src/` is the library; a package whose executable boundary lives elsewhere
  // (`bin/`) decides for itself whether that boundary may reach the network.
  {
    files: ["src/**/*.{ts,mts,cts,js,mjs,cjs}"],
    plugins: { ipc: { rules: { "no-network": noNetwork } } },
    rules: { "ipc/no-network": "error" },
  },
  // Last: turn off every rule Prettier already owns, so `Lint` and `Format`
  // never disagree about the same line.
  eslintConfigPrettier,
)
