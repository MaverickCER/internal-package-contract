---
"internal-package-contract": minor
---

`generate` has two new regions that state the standard itself. `thresholds` lists each limit with the constant
that sets it: coverage, CRAP, complexity, duplication, the benchmark allowances, the README length and the
adoption period. `checks` lists every check by phase, with the summary, degradation ids and exception registry
its doc header names. Both read the installed copy of this package, never `docs/surface.json`. This README now
carries both, so `GeneratedRegions` fails when a threshold or a check header changes without the README.

`generate` stops with a named problem instead of guessing. It names a check whose `npmScript` entry has no literal
`script: "..."`, so the region never prints "npm run undefined".
