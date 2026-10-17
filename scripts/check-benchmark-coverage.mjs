// Entry point for the `BenchmarkCoverage` check (see checks/benchmark-coverage.ts). Prints one JSON envelope;
// never exits non-zero for a finding (policy decides).
import { scanCoverage } from "./benchmark/coverage/scan.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...scanCoverage(process.cwd()) }))
