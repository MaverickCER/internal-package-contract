export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks?: { spawn?: (command: string, args: string[], cwd: string) => number | null },
): number
export function runCommand(
  command: string,
  args: string[],
  where: string,
  spawn?: (
    command: string,
    args: string[],
    options: object,
  ) => { status: number | null; error?: unknown },
): number | null
