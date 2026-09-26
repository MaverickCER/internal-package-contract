---
"internal-package-contract": patch
---

Fixes `release-npm-changesets.yml` (the reusable workflow consumers like
`data-cap`/`env-cap` call for their npm-publishing releases) to give
`changesets/action` a Conventional-Commits-compliant commit/PR title
(`chore: version packages` instead of the default `"Version Packages"`).
A consumer's own `commits` check (bundled from this package) was failing
the resulting bot commit on `origin/main..HEAD` for exactly this reason,
confirmed directly against a real Release PR. This is the reusable
workflow's counterpart to the same fix already applied to this repo's own
non-publishing `release.yml` in #11.
