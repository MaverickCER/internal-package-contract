export type Step = [label: string, command: string, args: string[]]
export function releaseSteps(cwd: string, packageRoot: string): Step[]
export function runRelease(
  cwd: string,
  packageRoot: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  spawn?: (command: string, args: string[], cwd: string) => number | null,
): number
