export function parseArguments(
  args: readonly string[],
):
  | { ok: true; total: number; out: string; entries: { shard: number; path: string }[] }
  | { ok: false; error: string }
export function run(
  args: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
): number
