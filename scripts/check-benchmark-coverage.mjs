// Entry point for the `BenchmarkCoverage` check (see checks/benchmark-coverage.ts). Reads the committed API
// baselines and benchmark results through scripts/benchmark/coverage/scan.mjs and prints one JSON envelope:
// the state, the suites, the functions counted, the gaps and the suites whose results are stale. The policy
// decides the verdict; nothing here exits non-zero for a finding.

import { scanCoverage } from "./benchmark/coverage/scan.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...scanCoverage(process.cwd()) }))
