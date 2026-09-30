---
"internal-package-contract": patch
---

Fixes `Crap`: `@danibram/crap4ts`'s own CLI calls `process.exit()` immediately
after an un-awaited `process.stdout.write()`, which can terminate the process
before a large report (hundreds of functions) finishes draining through the
OS pipe's own backpressure -- silently truncating captured stdout and making
this check fail with "crap4ts output could not be parsed as JSON" on an
otherwise-healthy run. Confirmed to reproduce on an unmodified checkout,
independent of any consumer's own source, once a consumer's function count
grows large enough to push the report past the pipe's buffer size.

`Crap` now passes `--output reports/crap.json` and reads that file directly
instead of relying on captured stdout -- a regular file write isn't subject
to the same backpressure race, so this sidesteps the bug at the call site
rather than depending on an upstream fix.
