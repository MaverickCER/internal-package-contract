export function parseAppendArgs(argv: readonly string[]): {
  positional: string[]
  commit?: string
  pullRequest?: number
}
