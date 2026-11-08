export function reportToAdopt(
  env: Record<string, string | undefined>,
  cwd: string,
): string | undefined
export function adoptReport(
  cwd: string,
  source: string,
  files: readonly string[],
  mutantFree?: (files: readonly string[]) => Promise<string[]>,
): Promise<{ ok: true } | { ok: false; error: string }>
