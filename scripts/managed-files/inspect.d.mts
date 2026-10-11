export const COPIES: readonly { name: string; from: string; to: string }[]
export function copyHeader(from: string): string
export function enrolledCopies(cwd: string): string[]
export const MANAGED: readonly { from: string; to: string; kind: "workflow" | "json" }[]
export function meaning(kind: "workflow" | "json" | "copy", text: string): string
export function pinOf(text: string): { ipcRef: string; ipcSha: string } | undefined
export function renderManaged(
  templateText: string,
  pins: { ipcRef: string; ipcSha: string },
): string
export interface ManagedState {
  to: string
  state: "current" | "missing" | "drifted"
  wanted: string
  have: string | undefined
}
export function inspectManaged(input: {
  cwd: string
  packageRoot: string
  pins: { ipcRef: string; ipcSha: string }
}): ManagedState[]
