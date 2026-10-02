---
"internal-package-contract": minor
---

Spend Socket quota sparingly. The CLI now runs `SecuritySocket` last and only when every other check passed (otherwise it prints `[SKIPPED] SecuritySocket`), and the score script caches successful scores per `<package>@<version>` for 24 hours (`IPC_SOCKET_CACHE_DIR`, `IPC_SOCKET_CACHE_TTL_HOURS`, `IPC_SOCKET_CACHE=off`); the scaffolded `contract.yml` persists the cache with `actions/cache`. The shared `dependency-pin-sync` workflow also now handles git-sourced dependencies (`github:owner/repo#main`) by re-resolving the branch head instead of running `npm install name@version`, which cannot resolve for a package that is not on npm.
