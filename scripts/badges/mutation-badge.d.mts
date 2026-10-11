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
