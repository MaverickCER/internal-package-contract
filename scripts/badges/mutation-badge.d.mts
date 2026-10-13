export function mutationScore(report: {
  files?: Record<string, { mutants?: { status: string }[] }>
}): number | undefined
export function mutationBadge(percent: number): {
  schemaVersion: 1
  label: string
  message: string
  color: string
}
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
export function mutationDetails(
  report: { files?: Record<string, { mutants?: { status: string }[] }> },
  percent: number,
): {
  schemaVersion: 1
  headline: { value: number; statistic: string; of: string; meaning: string }
  detected: number
  applicable: number
  byStatus: Record<string, number>
}
export function detailsPathOf(badge: string): string
