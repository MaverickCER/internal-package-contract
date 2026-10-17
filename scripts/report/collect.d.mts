export const REPORT_PATH: string
export const AREAS: readonly { area: string; test: (file: string) => boolean }[]
export function areaOf(file: string): string
export function defaultBase(cwd: string): string | undefined
export function changedFiles(
  cwd: string,
  base: string,
): { path: string; status: string; added: number; removed: number }[]
export function changesets(
  cwd: string,
): { package: string; bump: string; summary: string; file: string }[]
export function exceptionChanges(
  cwd: string,
  base: string,
): { registry: string; id: string; justification: string; change: "added" | "removed" }[]
export function newDecisions(cwd: string, base: string): { file: string; title: string }[]
export function dependencyChanges(
  cwd: string,
  base: string,
): { name: string; field: string; from: string | undefined; to: string | undefined }[]
export function contractChecks(
  cwd: string,
): { id: string; outcome: string; rationale: string }[] | undefined
export interface ChangeFacts {
  package: string
  version: string | undefined
  base: string
  head: string
  files: { path: string; status: string; added: number; removed: number }[]
  changesets: { package: string; bump: string; summary: string; file: string }[]
  exceptions: { registry: string; id: string; justification: string; change: "added" | "removed" }[]
  decisions: { file: string; title: string }[]
  dependencies: { name: string; field: string; from: string | undefined; to: string | undefined }[]
  checks: { id: string; outcome: string; rationale: string }[] | undefined
}
export function collect(cwd: string, base: string): ChangeFacts
