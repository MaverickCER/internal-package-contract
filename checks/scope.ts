/**
 * How a policy learns that the run was narrowed to what a change affects (`--scope affected`). The
 * run loop hands every policy the scope document as `ctx.scope`. `Tests`, `Coverage`, `Crap` and
 * `Mutation` read it. A full run, a unit test and a custom runner hand nothing, so a policy then
 * judges the whole package.
 */
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
