export const REPORT_DIR: string
export function isCi(env: NodeJS.ProcessEnv): boolean
export function isStrict(argv: readonly string[], env: NodeJS.ProcessEnv): boolean
export function cleanUp(cwd: string, created: { coverage: boolean; reports: boolean }): void
export function runContract(input: {
  runRepoContract: (
    config: never,
    options?: { checks: readonly string[] },
  ) => Promise<{ evidence: unknown; verdict: unknown }>
  config: { checks: Record<string, unknown> }
  cwd: string
  title: string
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv
  out?: { write(text: string): unknown }
}): Promise<{ passed: boolean }>
