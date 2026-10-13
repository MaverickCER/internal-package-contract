export const BUDGETS_PATH: string
export interface Budget {
  label: string
  file: string
  maxGzipBytes: number
}
export function loadBudgets(cwd: string): Promise<Budget[]>
export function measure(cwd: string, budgets: Budget[]): (Budget & { gzipBytes: number | null })[]
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): Promise<number>
