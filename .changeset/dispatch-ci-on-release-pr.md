---
"internal-package-contract": patch
---

`release-npm-changesets.yml` now dispatches the consumer's own `ci.yml` on the release PR's branch
right after `changesets/action` creates or updates it. `changesets/action` pushes that branch with
the default `GITHUB_TOKEN`, which GitHub deliberately never lets trigger `push`/`pull_request`-based
workflows (an anti-recursion guard) -- confirmed directly against real Release PRs across two
consumers this session, each sitting with zero CI checks until a human manually pushed a real commit
to unstick it. `gh workflow run` is explicitly exempted from that restriction, and its run's checks
attach to the branch's head SHA exactly as a normal `pull_request` run's would, so a consumer's
required status checks are already green by the time a human reviews the PR.
