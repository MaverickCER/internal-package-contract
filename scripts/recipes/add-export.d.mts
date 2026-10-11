export function stripJsonComments(text: string): string
export function validateExportName(name: string): string | undefined
export function planAddExport(input: { name: string; files: Record<string, string | undefined> }): {
  writes: { path: string; text: string; created: boolean }[]
  problems: string[]
}
