---
"internal-package-contract": minor
---

Add the optional `Sbom` check and `tool sbom`, built on repo-contract's new `sbom` preset. It needs repo-contract 0.16.0, which ships that preset.

- **`Sbom`, optional.** Turn it on with `internal-package-contract add check Sbom`. It fails when `docs/sbom.cdx.json` (every locked package) or `docs/sbom.production.cdx.json` (what installing the package brings in) is missing or differs from what `package-lock.json` gives. Both are CycloneDX 1.6, built from the lockfile alone, with purls, the lockfile's hashes, declared licenses and the dependency graph. The serial number, timestamp and formatting are ignored. It reads files only, so it waits on nothing.
- **`tool sbom`.** Writes both documents with the same generator the check uses. Run it after the lockfile changes and commit the result.
- `--changed` now counts `Sbom` among the checks a documentation change can affect, since the documents live under `docs/`.
