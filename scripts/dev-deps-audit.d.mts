export type Spawn = (
  command: string,
  args: string[],
  options: object,
) => { error?: Error & { code?: string }; stdout?: string; stderr?: string }
export function audit(spawn: Spawn, extraArgs: string[]): { value: object } | { error: string }
export function auditBothTrees(
  spawn: Spawn,
): { ok: true; all: object; production: object } | { ok: false; error: string }
