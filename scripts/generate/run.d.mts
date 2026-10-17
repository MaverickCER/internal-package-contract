export const DOCUMENTS: string[]
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks?: { formatOptions?: (file: string) => Promise<object> },
): Promise<number>
