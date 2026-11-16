---
"internal-package-contract": minor
---

Bump `repo-contract` to 0.15.0, and add two checks built on its new presets.

- **`BundledDependencies`, in the standard.** It fails when package.json bundles a package (`bundleDependencies` or `bundledDependencies`) that `dependencies` does not declare. npm publishes each such name into the registry manifest as `"*"`, and Socket reports that as manifest confusion. A private package passes. The standard now holds 56 checks.
- **`QuickStart`, optional.** Turn it on with `internal-package-contract add check QuickStart`. It runs the README's fenced `sh` block between `<!-- quick-start:begin -->` and `<!-- quick-start:end -->` against the packed tarball, in an empty project. It fails on a command that exits non-zero, on a run past five minutes, and on a README with no marked block. A command that fails with a network error code is the `QuickStart:network` degradation. It warns locally and needs an `environment.json` record in CI.

What to do after upgrading: a published package that bundles an undeclared name fails `BundledDependencies`. Add each bundled name to `dependencies` at the version you bundle.
