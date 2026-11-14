/**
 * The organization's baseline Prettier configuration for a publishable package.
 *
 * Consumers EXTEND it, they do not copy it:
 *
 *   import baseline from "internal-package-contract/prettier"
 *   export default { ...baseline }
 *
 * It differs from Prettier's defaults on purpose, so that extending it means something. The options match
 * the style the existing @maverickcer/* packages already use.
 *
 * It is plain JavaScript because a consumer imports it from `node_modules`, where Node refuses to strip
 * TypeScript types (see `./eslint.config.mjs`). The `@type` tag below gives editors the same type checking.
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
