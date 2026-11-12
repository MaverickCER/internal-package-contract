---
"internal-package-contract": minor
---

The benchmark overhead gate judges accurate figures. The end-to-end baseline and with-package operations are sampled interleaved (A B, B A, ...; at least ten pairs at the suite's typical size), so the package's overhead is the per-pair difference, recorded with its median, mean, standard deviation and 95% confidence interval (`paired` on the with-package tiers; `overheadCi95Ms`, `overheadCi95Percent` and `pairs` on the analysis rows). `samplePaired` and `computePairedStats` are exported from the kit.

The gate (`scripts/benchmark/gates.mjs`) fails only when the overhead ratio grew past the allowance _and_ the change is outside the two runs' intervals; a growth inside them is a note. A reference measured on another CPU model is reported, not judged: for fast work the ratio also depends on how much of a bare baseline is process start-up. The reusable `benchmark-pr` workflow therefore measures `main` on the same runner in the same job (`run-suite.mjs --typical-only`, from main's suite file with this checkout's runner) and passes it as a sixth `--example` field, which `render-summary` judges as the same-machine reference.
