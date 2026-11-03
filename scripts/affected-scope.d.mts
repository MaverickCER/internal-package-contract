import type { AffectedResult } from "repo-contract/affected"

export interface ScopeDocument {
  readonly schemaVersion: 1
  readonly scope: "full" | "affected"
  readonly reason: string
  readonly base?: string
  /** Empty for a full run, which is not narrowed. */
  readonly changedFiles: string[]
  readonly tests: string[]
  readonly sources: string[]
  readonly mutate: string[]
}
export const SCOPE_PATH: string
export function computeFromGit(
  cwd: string,
  base: string | undefined,
  loadTypeScript?: (cwd: string) => unknown,
): Promise<AffectedResult>
export function resolveRunScope(input: {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  cwd: string
  compute?: (cwd: string, base: string | undefined) => Promise<AffectedResult>
}): Promise<ScopeDocument>
export function writeScope(cwd: string, doc: ScopeDocument): void
export function readScope(cwd: string): ScopeDocument | undefined
export function describeScope(doc: ScopeDocument): string
export function withScope<
  Config extends { checks: Record<string, { policy: (ctx: never) => unknown }> },
>(config: Config, doc: { scope: string }): Config

/** What the affected analysis reads the repository with. */
export function capabilities(cwd: string): {
  git: (args: readonly string[]) => Promise<string | undefined>
  readFile: (file: string) => Promise<string | undefined>
}
