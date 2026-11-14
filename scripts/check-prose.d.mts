export function scanProse(
  cwd: string,
):
  | { ok: true; files: number; findings: { file: string; line: number }[] }
  | { ok: false; error: string }
