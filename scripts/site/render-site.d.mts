export function renderFiles(input: {
  site: Record<string, unknown>
  pkg: { name: string; version: string; license?: string }
  outDir: string
}): Promise<{ name: string; text: string }[]>
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): Promise<number>
