---
"internal-package-contract": patch
---

The `PIN_SYNC_TOKEN` secret description in `dependency-pin-sync.yml` now points at the calling repository's
`docs/ENVIRONMENT.md#ci-secrets-pin_sync_token`, which `internal-package-contract env` generates. Before, it
linked this repository's `main` branch, which can describe a newer release than the one the caller pins.
