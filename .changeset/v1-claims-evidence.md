---
"internal-package-contract": patch
---

The shared release workflow's "Create the GitHub Release" step now names the repository (`GH_REPO`). That job has no checkout, so `gh release` failed with "not a git repository" and, behind `continue-on-error`, every consumer release since 0.13.3 shipped without a GitHub Release. A test now requires `GH_REPO` or `--repo` on every `gh release` call in a job without a checkout.

The Scorecard workflow template now uploads its SARIF to code scanning, so the per-check details behind the public score are readable by a reviewer (the public API keeps only each check's score and one-line reason). Consumers pick it up with the next `sync`.

`TOOLKIT.md` gains "Evidence a reviewer can check": each package's single source of truth, the standard documents generated from it, how each format is validated, and how to attest a generated document in CI so a reviewer can verify it with `gh attestation verify`.

`generate` has two new regions, both read from `docs/surface.json` like `entry-points`. `dependencies` states what installing the package adds, straight from `package.json` (dependencies, optional dependencies and required peers count as installed, as npm 7 and later install them; optional peers are left to the consumer), with a one-line reason per dependency (a missing or multi-line reason, or a reason for a package no longer declared, fails generation). `standards` lists the standard-format documents a package generates, each with the test that checks its format (generation fails when that test file is gone). `specs/generated-artifacts.md` joins the documents `generate` reads, and the new-package template carries a `dependencies` region in `ADOPTION.md`.

The official schemas packages validate their output against are now managed copies (`schema-sarif-2.1.0`, `schema-oscal-assessment-results-1.1.2`, `schema-cyclonedx-1.6` with the SPDX and JSF schemas it references, and `standards-readme`). Each is byte for byte as published at a release URL, with its SHA-256 pinned in `template/standards/README.md` and checked by this repository's tests. The CycloneDX files come from the specification's `1.6.2` tag rather than its moving `master` branch.
