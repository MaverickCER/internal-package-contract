---
"internal-package-contract": patch
---

`init --name` scaffolds the benchmark suite in its own folder, `benchmarks/performance-runtime/`, beside its
`benchmark.config.json` (`"root": "../.."`). The flat `benchmarks/suite.mjs` it wrote before sent a local run's
results outside the repository. `BenchmarkCoverage` and `BenchmarkComplexity` never found them either.
`run-suite` now exits 1 on a `suite.mjs` placed directly in `benchmarks/`, and says how to move it. The scaffold's
`.gitignore` lists `/.benchmark-local`.

`BenchmarkCoverage` reads API baselines at any depth under `.repo-contract/api-contract/`. A target name with a
slash, such as `adapters/express`, is committed one folder deeper. Its functions were never judged, and a
`covers` that named them was reported as stale.

The scaffolded `.gitignore` ignores ApiContract's per-run `current.*` files at any depth, so a target with a
nested name (`adapters/express`) no longer leaves untracked files.
