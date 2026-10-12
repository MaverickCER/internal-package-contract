// Entry point for the `BenchmarkComplexity` check (see checks/benchmark-complexity.ts). Prints one JSON
// envelope; never exits non-zero for a finding (policy decides).
import { scanComplexity } from "./benchmark/complexity-scan.mjs"

process.stdout.write(JSON.stringify({ ok: true, ...scanComplexity(process.cwd()) }))
