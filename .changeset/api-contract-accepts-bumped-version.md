---
"internal-package-contract": patch
---

The ApiContract check now accepts a package version that has already reached the minimum the API diff requires. A release pull request has consumed its changesets and bumped `package.json`, so it has no changeset left to declare the level; the check used to fail it for exactly that, even though the bump was already applied.
