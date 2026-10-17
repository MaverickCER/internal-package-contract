export interface Item {
  id: string
  state: "ok" | "todo" | "manual"
  what: string
  fix?: string
}
export function diagnose(input: {
  cwd: string
  packageRoot: string
  git?: (args: string[]) => string | undefined
}): Promise<Item[]>
export function renderReport(items: Item[]): string
export function run(
  argv: readonly string[],
  cwd: string,
  packageRoot: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): Promise<number>
