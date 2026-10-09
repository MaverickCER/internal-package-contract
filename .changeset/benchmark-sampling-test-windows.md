---
"internal-package-contract": patch
---

The benchmark kit's sampling test no longer assumes a timer finer than the platform's, so it stops failing intermittently on Windows, where a 2 ms timer fires about every 15 ms.
