/**
 * The organization's baseline Prettier configuration for a publishable package.
 *
 * Consumers EXTEND it, they do not copy it:
 *
 *   import baseline from "internal-package-contract/prettier"
 *   export default { ...baseline }
 *
 * A small, deliberate delta from Prettier's defaults so that "extend the
 * baseline" is a meaningful statement rather than a no-op. Matches the style the
 * existing @maverickcer/* packages already use.
 *
 * Plain JavaScript, not TypeScript -- see `./eslint.config.mjs`'s own doc
 * comment for why: a consumer's own config imports this file directly out of
 * `node_modules`, and Node's native TypeScript type-stripping refuses to
 * strip any file under `node_modules`, so a `.ts` file at this path is not
 * actually importable by a plain `import` once installed as a dependency,
 * confirmed directly. `@type` below recovers the same editor-hover/type-
 * checking value `import type { Config } from "prettier"` gave the `.ts`
 * version, without requiring a loader this file's own consumers would have
 * to configure.
 */

/** @type {import("prettier").Config} */
const config = {
  semi: false,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: "always",
  bracketSpacing: true,
  endOfLine: "lf",
}

export default config
