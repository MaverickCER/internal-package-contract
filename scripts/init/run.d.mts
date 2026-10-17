export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks: {
    packageRoot: string
    spawn?: (command: string, args: string[], cwd: string) => number | null
    capture?: (command: string, args: string[], cwd: string) => { status: number; stdout: string }
  },
): number
