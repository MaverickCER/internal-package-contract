export function importsOf(cwd: string, test: string): string[]
export function targetsOf(cwd: string, base: string): string[]
export function run(
  argv: string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  seams: {
    spawn: (args: string[], cwd: string) => number | null
    mutatePatterns: (cwd: string) => Promise<string[]>
    baseOf: (cwd: string) => string | undefined
  },
): Promise<number>
