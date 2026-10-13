export function problemsOf(skill: object, exists: (file: string) => boolean): string[]
export function inspectSkill(cwd: string): {
  state: "none" | "invalid" | "checked"
  problems: string[]
  notes: string[]
  stale: string[]
  words: number
  budget: number
  files: Record<string, string>
}
