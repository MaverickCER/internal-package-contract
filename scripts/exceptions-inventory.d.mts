export const REGISTRY_DIR: string
export interface RegistrySummary {
  name: string
  total: number
  byType: Record<string, number>
  legacy: number
  expired: number
  incomplete: number
}
export interface Inventory {
  registries: RegistrySummary[]
  total: number
  legacy: number
  expired: number
  incomplete: number
  errors?: { name: string; error: string }[]
}
export function summarizeRegistries(
  registries: readonly { name: string; records: readonly unknown[] }[],
  now?: Date,
): Inventory
export function collectInventory(cwd: string, now?: Date): Inventory
export function renderInventory(inventory: Inventory): string
export function runInventory(
  argv: readonly string[],
  cwd: string,
  out: { write(text: string): unknown },
): void
