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
 */
import type { Config } from "prettier"

const config: Config = {
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
