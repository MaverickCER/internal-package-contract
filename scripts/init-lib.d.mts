export interface InitArgs {
  force: boolean
  name?: string
  owner?: string
  description?: string
  errors: string[]
}
export interface InitVars {
  [key: string]: string
  name: string
  repo: string
  owner: string
  description: string
  year: string
}
export function parseInitArgs(argv: readonly string[]): InitArgs
export function validatePackageName(name: string): string | undefined
export function buildVars(input: {
  name: string
  owner: string
  description?: string
  year?: number
}): InitVars
export function render(text: string, vars: Readonly<Record<string, string>>): string
export function renderJson(text: string, vars: Readonly<Record<string, string>>): string
export function listTemplateFiles(dir: string): string[]
