export function coverageColor(pct: number): string
export function sizeColor(gz: number, max: number): string
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
