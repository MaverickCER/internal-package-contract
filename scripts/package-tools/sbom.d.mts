export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  spawn?: (
    command: string,
    args: readonly string[],
    options: { cwd: string },
  ) => { stdout: string | Uint8Array; stderr: string | Uint8Array },
): Promise<number>
