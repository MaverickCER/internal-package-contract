// Judges a package's benchmarks against its public functions: every function with more than one thing that can
// change its cost is benchmarked, and every parameter (or key) of it is accounted for. Pure.

/**
 * @typedef {object} CoverageRecord
 * @property {Record<string, Record<string, string>>} covers - function name -> parameter path -> accounting, as the benchmarks wrote it.
 * @property {Record<string, string>} notBenchmarked - function name -> why it has no benchmark.
 */

/**
 * @param {Map<string, { paths: string[], multiInput: boolean }>} signatures - the public functions (see signatures.mjs).
 * @param {{ suite: string, benchmark: string, covers: Record<string, Record<string, string>> }[]} benchmarks - every benchmark function of every suite.
 * @param {Record<string, string>} notBenchmarked - the functions the suites say they do not benchmark, and why.
 * @returns {{ kind: "unbenchmarked" | "unaccounted" | "stale", function: string, path?: string, message: string }[]}
 */
export function coverageFindings(signatures, benchmarks, notBenchmarked) {
  const findings = []
  for (const [name, { paths, multiInput }] of signatures) {
    if (!multiInput || Object.hasOwn(notBenchmarked, name)) continue
    const covering = benchmarks.filter((benchmark) => Object.hasOwn(benchmark.covers, name))
    if (covering.length === 0) {
      findings.push({
        kind: "unbenchmarked",
        function: name,
        message: `\`${name}\` takes ${String(paths.length)} inputs (${paths.join(", ")}) and no benchmark exercises it. Benchmark it, or say why not under \`notBenchmarked\`.`,
      })
      continue
    }
    for (const path of paths) {
      if (!covering.some((benchmark) => Object.hasOwn(benchmark.covers[name], path))) {
        findings.push({
          kind: "unaccounted",
          function: name,
          path,
          message: `\`${name}\`: \`${path}\` is not accounted for. In the benchmark that covers it, say whether it is swept, a variant, fixed (and why) or not covered (and why).`,
        })
      }
    }
  }
  for (const benchmark of benchmarks) {
    for (const [name, accounted] of Object.entries(benchmark.covers)) {
      const known = signatures.get(name)
      if (known === undefined) {
        findings.push({
          kind: "stale",
          function: name,
          message: `${benchmark.suite} / ${benchmark.benchmark} covers \`${name}\`, which is not a public function of this package.`,
        })
        continue
      }
      for (const path of Object.keys(accounted)) {
        if (!known.paths.includes(path)) {
          findings.push({
            kind: "stale",
            function: name,
            path,
            message: `${benchmark.suite} / ${benchmark.benchmark} accounts for \`${name}\`: \`${path}\`, which that function does not take.`,
          })
        }
      }
    }
  }
  for (const name of Object.keys(notBenchmarked)) {
    if (!signatures.has(name)) {
      findings.push({
        kind: "stale",
        function: name,
        message: `\`notBenchmarked\` names \`${name}\`, which is not a public function of this package.`,
      })
    }
  }
  return findings
}
