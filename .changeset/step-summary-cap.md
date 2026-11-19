---
"internal-package-contract": patch
---

The contract keeps what it appends to the GitHub job summary under 1 MB. GitHub rejects a longer summary, as it
did on a 4,192 KB one. A longer summary is cut at a line, with a note that names `reports/contract/summary.md`.
When the step summary has no room even for that note, only a one-line pointer to the file is written. The full
file is unchanged, and the reusable contract workflow uploads it as the `contract-report` artifact.

The generated landing page joins the problem diagram's items and conclusion with a semicolon instead of an
em-dash.

The managed `RELEASING.md` no longer says the floating `v0` tag stays on a compatible build. It moves on every
release, a breaking `0.x` minor included; the file now says to pin a full version or a SHA for stability.
