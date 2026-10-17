---
"internal-package-contract": minor
---

feat(env): the standard ships the contract for what it reads from the environment, and `env` includes it in every package's `docs/ENVIRONMENT.md`; the scaffolded `ci/env.schema.ts` no longer repeats it, so the explanation lives in one place and cannot drift
