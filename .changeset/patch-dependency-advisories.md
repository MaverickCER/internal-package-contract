---
"internal-package-contract": patch
---

- Updates `markdownlint-cli2` to 0.24 (markdown-it 15.0.3, smol-toml 1.9.1), so packages that install this standard no longer pull the vulnerable `markdown-it` 15.0.0–15.0.2 and `smol-toml` 1.8.0 copies.
- The `Licenses` check uses the repository's `.licensee.json` as the policy through repo-contract 0.11.3, and `Tests` relies on repo-contract's own check that a run executed at least one test.
