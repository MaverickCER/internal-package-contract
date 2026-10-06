export function repinWorkflowText(
  text: string,
  dependency: string,
  sha: string,
  ref: string,
): { text: string; changed: number }
export function repinWorkflows(dir: string, dependency: string, sha: string, ref: string): string[]
export function run(
  argv: readonly string[],
  dir: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
