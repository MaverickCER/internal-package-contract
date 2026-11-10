export function resolveOwnerRepo(cwd?: string): { owner: string; repo: string } | undefined
export function rulesetCoversBranch(
  ruleset: { conditions?: { ref_name?: { include?: string[] } } },
  branch: string,
): boolean
export const REQUIRED_STATUS_CHECK_CONTEXT: "contract"
export const REQUIRED_AGGREGATE_CONTEXT: "required"
export const GITHUB_ACTIONS_APP_ID: 15368
export interface RequiredStatusCheck {
  context: string
  integration_id: number
}
export const REQUIRED_STATUS_CHECKS: readonly RequiredStatusCheck[]
export const REQUIRED_RULE_TYPES: readonly string[]
export interface RulesetRule {
  type: string
  parameters?: Record<string, unknown>
}
export function mergeRequiredRules(existing: readonly RulesetRule[]): {
  rules: RulesetRule[]
  changes: string[]
}
