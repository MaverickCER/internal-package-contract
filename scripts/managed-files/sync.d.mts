export function unifiedDiff(wanted: string, have: string): string
export function run(
  argv: readonly string[],
  cwd: string,
  packageRoot: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  copies?: readonly { name: string }[],
  hooks?: { spawn?: (command: string, args: string[], cwd: string) => number | null },
): number
