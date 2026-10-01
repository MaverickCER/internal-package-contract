import baseline from "internal-package-contract/eslint"
import eslintConfigPrettier from "eslint-config-prettier/flat"
import tseslint from "typescript-eslint"

// Extends internal-package-contract's org-wide baseline; layer stricter, package-specific blocks
// after it. Prettier goes last so formatting still wins.
export default tseslint.config(
  ...baseline,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  { ignores: ["dist", "coverage", "node_modules", ".stryker-tmp", "docs/api", "docs/api-report"] },
  eslintConfigPrettier,
)
