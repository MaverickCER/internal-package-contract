export const MEMO_DIRECTORY: string
export function inputsHash(cwd: string, node?: string): string
export function recall(cwd: string, hash: string, env: Record<string, string | undefined>): boolean
export function remember(cwd: string, hash: string, status: number | null): void
