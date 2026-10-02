---
"internal-package-contract": minor
---

Replace the cross-repository release dispatch (and the `CROSS_REPO_PAT` secret that expired) with a pull. The shared `dependency-pin-sync` workflow now takes optional inputs, opens no PR when the pin is already current or a PR for it already exists, derives the changeset severity from the version change, and is called from daily `schedule` triggers (plus manual `workflow_dispatch`) using each repo's own `GITHUB_TOKEN`. The "Notify dependents" release step and `consumers.json` are removed, and the scaffolded `sync-internal-package-contract.yml` is the pull-based one. The package and the `init` scaffold now override `adm-zip` to 0.6.1, which clears its published advisories (reached only through `github-actionlint`), and the README explains that consumers must add the same override themselves.
