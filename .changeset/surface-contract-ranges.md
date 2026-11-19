---
"internal-package-contract": minor
---

`SurfaceContract` now records the `engines` and `peerDependencies` ranges in `package.json`. A range that accepts
fewer versions is breaking: a raised floor, a dropped major, a new requirement, or a range that is not valid
semver. Below 1.0.0 that needs a `minor` changeset. A wider range is compatible.

What to do after upgrading: nothing until your next release. A baseline written before this change holds no
ranges, so it compares none. The `update-baseline` run in your next release's `version` script records them.
A package with no CLI, schema, action or reusable workflow keeps no surface baseline, so its ranges are not compared.
