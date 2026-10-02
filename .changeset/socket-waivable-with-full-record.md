---
"internal-package-contract": minor
---

`SecuritySocket` now waives supply-chain-risk alerts instead of forbidding them: every alert below `critical`/`high` needs a finding-specific record with all five fields fully written (`justification`, `alternatives`, `remediation`, `method`, `exceptionType`), and the only accepted `exceptionType` is the new `required-for-package-to-exist` -- the flagged dependency or behavior is why the package exists. Critical and high alerts stay forbidden.
