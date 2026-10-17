export function slugOf(title: string): string
export function nextNumber(names: string[]): number
export function renderAdr(number: number, title: string): string
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
