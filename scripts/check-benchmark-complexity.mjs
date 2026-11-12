// Entry point for the `BenchmarkComplexity` check (see checks/benchmark-complexity.ts). Reads the committed
// benchmark results through scripts/benchmark/complexity-scan.mjs and prints one JSON envelope: the state,
// the release tag compared with, and every group whose growth class got worse. The policy decides the
// verdict and reads the exception registry itself; nothing here exits non-zero for a finding.

import { scanComplexity } from "./benchmark/complexity-scan.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...scanComplexity(process.cwd()) }))
