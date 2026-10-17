export function listFiles(dir: string): string[]
export function compareReports(
  committed: string,
  fresh: string,
): { committed: string[]; added: string[]; removed: string[]; changed: string[] }
export function generateReport(
  root: string,
  into: string,
  exec?: (...args: never[]) => unknown,
): void
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks?: { generate?: (cwd: string, into: string) => void },
): number
