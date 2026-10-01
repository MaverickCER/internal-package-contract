---
"internal-package-contract": minor
---

Make the package the strict foundation for every consumer. Adds the `NoMinify` and `DistNoUrls` checks (the latter reconciled through an exceptions registry and built on `repo-contract/presets`'s `distNoUrls`), rewrites `SecuritySocket` on `socket package score` so it fails whenever Socket cannot run and prints CI-vs-local setup steps, adds `init --name/--owner/--description` that scaffolds a complete package, and ships the self-contained benchmark kit (`internal-package-contract/benchmark`, `run-suite.mjs`, the `WRITING-BENCHMARKS.md` / `READING-BENCHMARKS.md` docs) with a generalized `benchmark-pr.yml`. Requires `repo-contract` 0.8 or newer. Breaking while 0.x: consumers need the new checks' exception records and a Socket API key in CI.
