---
"internal-package-contract": patch
---

Key `SecuritySocket` exception records for the scored package's own alerts by the stable word `self` instead of its version (`socket:<name>@self:<alert>`), so a release no longer orphans every record and fails the next run. Alerts on dependencies keep their `package@version` ids.
