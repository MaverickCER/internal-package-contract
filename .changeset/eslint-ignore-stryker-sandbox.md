---
"internal-package-contract": patch
---

The baseline ESLint config ignores `.stryker-tmp/`. The contract runs Lint while Mutation runs, and Stryker's
sandbox there is a full copy of the package, its ESLint config included. When Lint reached the sandbox first,
typescript-eslint found two config roots and stopped with "multiple candidate TSConfigRootDirs", so Lint failed
on a package with no lint error.
