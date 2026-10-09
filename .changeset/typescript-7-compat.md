---
"internal-package-contract": minor
---

TypeScript 7 (the native compiler) is now part of the standard. The scaffolded `contract.yml` gains a `typescript-7` job that type-checks the package with the TypeScript 7 compiler while the development toolchain stays on TypeScript 5 or 6 (typescript-eslint, typedoc and API Extractor need the compiler API TypeScript 7 does not ship), and this repository's own CI runs the same check. Delete the job from a package that cannot type-check under TypeScript 7 yet.
