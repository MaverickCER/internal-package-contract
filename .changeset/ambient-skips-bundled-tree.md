---
"internal-package-contract": patch
---

`AmbientCapabilities` skips everything under `node_modules/` in the tarball. npm packs that folder only for
bundled packages, and with them their own dependencies, which `bundleDependencies` need not name. Before, a
dependency of a bundled package was scanned as if it were the package's own code.
