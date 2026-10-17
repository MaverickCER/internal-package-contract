export const SCHEMA_PATH: string
export const STANDARD_PACKAGE: string
export const DOCS_PATH: string
export const ISSUE_LABEL: string
export interface EnvReport {
  state: "absent" | "present"
  contracts: number
  findings: { severity: string; code: string; message: string }[]
  stale: string[]
  expected?: string
}
/** The parts of env-cap's build API this command uses, and the Node filesystem they are given. */
export interface EnvCapModule {
  fs: { readFile: (...args: never[]) => unknown }
  generateEnvArtifacts(options: object): Promise<{
    evidence: {
      contract: { contracts: readonly unknown[] }
      finding: {
        findings: readonly { family: string; severity: string; code: string; message: string }[]
      }
    }
  }>
}
export function lintFriendly(text: string): string
export function loadEnvCap(): Promise<EnvCapModule>
export function inspectEnv(input: {
  cwd: string
  load?: () => Promise<EnvCapModule>
}): Promise<EnvReport>
export function syncRotationIssue(
  report: { findings: { code: string; message: string }[] },
  gh: (args: string[]) => { status: number; stdout: string },
): string
export function run(
  argv: readonly string[],
  cwd: string,
  io: { out: (text: string) => void; err: (text: string) => void },
  hooks?: {
    load?: () => Promise<EnvCapModule>
    gh?: (args: string[]) => { status: number; stdout: string }
  },
): Promise<number>

export function withoutMachine(
  text: string,
  roots: string[],
  separator: string,
  caseless: boolean,
): string

export function isCaseless(platform: string): boolean
