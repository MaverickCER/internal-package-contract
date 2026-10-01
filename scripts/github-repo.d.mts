export function resolveOwnerRepo(cwd?: string): { owner: string; repo: string } | undefined
export function rulesetCoversBranch(
  ruleset: { conditions?: { ref_name?: { include?: string[] } } },
  branch: string,
): boolean
