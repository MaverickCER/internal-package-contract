---
"internal-package-contract": minor
---

Adds a shared benchmark engine (`scripts/benchmark/`) generalizing the tiered
benchmark + committed history + PR-comment summary + Pages history chart
methodology env-cap and data-cap each independently built.

- `append-history.mjs`: appends a compact entry to a consumer's committed
  history file. History schema v2 carries each tier's full `inputs` object
  through (not just a derived throughput figure), plus a generic
  `unitsPerSecond` and a `versions` object copied from the run's own
  metadata. Old (schema v1) history entries remain valid as-is.
- `classify-complexity.mjs`: infers an algorithmic complexity class
  (`constant` through `exponential-or-worse`) per benchmark group from its
  tiers' `{ medianMs, inputs }`, and flags a **complexity shift** when the
  inferred class changes since the last recorded run -- a stronger, machine-
  independent signal than an ordinary regression-percent budget breach.
- `render-summary.mjs`: renders the highlight-only PR-comment summary,
  leading with complexity-shift flags ahead of budget-breach highlights.
- `render-page.mjs`: builds a static `docs/benchmarks/index.html` history
  page (small-multiples line charts per group, complexity-class annotated,
  bounded to the most recent ~200 entries), generated fresh on deploy and
  never committed.
- `.github/workflows/benchmark-pr.yml`: reusable `workflow_call` workflow
  consolidating env-cap's and data-cap's near-duplicate `benchmark-pr` CI
  job, now calling into the scripts above.

Consumers adopt this via three thin npm scripts
(`benchmark:history`/`benchmark:summary`/`benchmark:page`) that forward to
this package's own scripts -- see the README's new "Shared benchmark engine"
section. Actually rewiring env-cap's and data-cap's own `package.json`/CI
onto this engine is a separate follow-up.
