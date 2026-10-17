export const BENCHMARK_PAGE_SCRIPT: string
export function definesBenchmarkPage(cwd: string): boolean
export function prepare(input: {
  cwd: string
  out: { write: (text: string) => unknown }
  spawn?: (command: string, args: string[], cwd: string) => number | null
}): void
export function spawnOptions(cwd: string): { cwd: string; stdio: "inherit" }
