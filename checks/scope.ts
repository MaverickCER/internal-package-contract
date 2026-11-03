import type { ScopeDocument } from "../scripts/affected-scope.mjs"

/**
 * What a narrowed run covers, as the run handed it to a policy. A full run hands nothing, and a policy
 * called on its own (a unit test, a custom runner) sees nothing either, so it judges the whole package.
 * @param ctx - the context a policy was called with.
 * @returns the scope when the run was narrowed to what a change affects, otherwise `undefined`.
 */
export function narrowedScope(ctx: object): ScopeDocument | undefined {
  const { scope } = ctx as { scope?: ScopeDocument }
  return scope?.scope === "affected" ? scope : undefined
}
