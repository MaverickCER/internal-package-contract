export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks?: { inspect?: (input: { cwd: string; tarball?: string | undefined }) => object },
): number
