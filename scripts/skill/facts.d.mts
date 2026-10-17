export interface SkillFile {
  when?: string
  purpose?: string
  notFor?: string
  example?: { file: string; lines?: number[] }
  rules?: string[]
  behavior?: string[]
  mistakes?: { wrong: string; right: string }[]
  verify?: string[]
  references?: { when: string; path: string }[]
  budget?: number
}
export interface ApiMember {
  name: string
  kind: string
  tag: string
  signature: string
}
export interface SkillEntry {
  specifier: string
  purpose: string
  tier: string
  api: ApiMember[]
}
export interface SkillFacts {
  name: string
  version: string
  description: string
  repository: string
  entries: SkillEntry[]
  skill: SkillFile | undefined
}
export const SKILL_FILE: string
export function baselineFolder(subpath: string, aliases: Record<string, string> | undefined): string
export function readFacts(cwd: string): SkillFacts | undefined
