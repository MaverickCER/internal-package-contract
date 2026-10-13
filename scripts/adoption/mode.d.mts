export const ADOPTION_FILE: string
export const DEFAULT_DAYS: number
export interface Adoption {
  state: "absent" | "active" | "expired" | "invalid"
  startedAt?: string
  expiresAt?: string
  enforce?: string[]
  daysLeft?: number
  problem?: string
}
export function readAdoption(cwd: string, now?: Date): Adoption
export function newAdoption(
  now?: Date,
  days?: number,
): { version: 1; startedAt: string; expiresAt: string; enforce: string[] }
export function writeAdoption(
  cwd: string,
  adoption: { version: 1; startedAt: string; expiresAt: string; enforce: string[] },
): void
export function advisoryFailures(
  results: Record<string, { outcome: string }>,
  adoption: Adoption,
): string[]
export function promote(
  argv: readonly string[],
  cwd: string,
  available: readonly string[],
  io: { out: (text: string) => void; err: (text: string) => void },
  now?: Date,
): number
