---
"internal-package-contract": patch
---

fix(tests): tests start without the variables a git hook supplies (the repository, the settings and the author of the commit being checked), so they no longer fail under a hook that passes by hand or run git against the real repository
