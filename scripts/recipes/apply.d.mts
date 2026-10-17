export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks?: { format?: (paths: string[]) => void; spawn?: (...args: unknown[]) => unknown },
): number
