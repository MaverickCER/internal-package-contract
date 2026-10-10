---
"internal-package-contract": patch
---

This repository's own release workflow no longer tags a version before it is merged. While changesets were pending it read the version the Version Packages step had just bumped in its working tree, tagged the unmerged release-branch commit with it and moved the floating major tag there (v0.9.1 and v0 pointed at a commit that never reached main). It now tags only when there is nothing left to version, and tags the commit the run is for.
