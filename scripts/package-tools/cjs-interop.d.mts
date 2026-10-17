export function patchInterop(text: string): string | undefined
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
