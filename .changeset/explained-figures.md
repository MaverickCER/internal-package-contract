---
"internal-package-contract": minor
---

feat(badges): every published figure says what it is. The coverage badge reads "lowest of 4" and `coverage.json` beside it gives all four measures (lines, statements, functions, branches) with what each counts; the mutation badge says "detected of applicable" and `mutation.json` gives the count of each status; the size badge shows the size against its budget, with `size.json`. `tool badges` takes `--coverage <file>` and `--no-size`, so a package with its own coverage aggregate uses it instead of keeping a copy of the generator
