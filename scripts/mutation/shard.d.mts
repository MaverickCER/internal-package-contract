export function shardSpecOf(env: Record<string, string | undefined>): string | undefined
export function mutateGlobsOf(config: { mutate?: readonly string[] } | undefined): readonly string[]
export function expandMutate(cwd: string, patterns: readonly string[]): string[]
export function shardMutation(run: {
  spec: string
  files: readonly string[]
  sizeOf: (file: string) => number
}): { skip: false; args: string[]; key: string }
export function loadStrykerConfig(
  cwd: string,
  candidates: readonly string[],
  fallback: string | undefined,
): Promise<{ mutate?: readonly string[] } | undefined>
