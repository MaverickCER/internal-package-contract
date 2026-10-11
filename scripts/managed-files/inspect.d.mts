export const MANAGED: readonly { from: string; to: string; kind: "workflow" | "json" }[]
export function meaning(kind: "workflow" | "json", text: string): string
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
