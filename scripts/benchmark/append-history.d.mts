export function parseAppendArgs(argv: readonly string[]): {
  positional: string[]
  commit?: string
  pullRequest?: number
}

export function buildEntry(
  results: object,
  where: { commit?: string | undefined; pullRequest?: number | undefined },
): Record<string, unknown>
export function appendEntry(
  history: Record<string, unknown>,
  entry: object,
): Record<string, unknown>
export function run(
  argv: readonly string[],
  io: { log: (text: string) => void; error: (text: string) => void },
): Promise<number>
