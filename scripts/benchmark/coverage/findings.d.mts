export interface CoverageFinding {
  kind: "unbenchmarked" | "unaccounted" | "stale"
  function: string
  path?: string
  message: string
}
export function coverageFindings(
  signatures: Map<string, { paths: string[]; multiInput: boolean }>,
  benchmarks: {
    suite: string
    benchmark: string
    covers: Record<string, Record<string, string>>
  }[],
  notBenchmarked: Record<string, string>,
): CoverageFinding[]
