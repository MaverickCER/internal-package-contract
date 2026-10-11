export type GhReply = { ok: boolean; status: number; json?: unknown }
export type Gh = (apiPath: string) => Promise<GhReply>
type Files = { lockfile: string | undefined; workflows: readonly { file: string; text: string }[] }
export function collectPins(input: Files): { where: string; sha: string; comment: string }[]
export function auditPins(input: {
  pins: readonly { where: string; sha: string; comment: string }[]
  gh: Gh
}): Promise<{ problems: string[]; blocked: string[] }>
export function run(
  input: Files & { gh: Gh; io: { out: (text: string) => void; err: (text: string) => void } },
): Promise<number>
