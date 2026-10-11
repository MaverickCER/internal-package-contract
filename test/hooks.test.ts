import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const hooks = path.resolve(import.meta.dirname, "../hooks")
const read = (name: string): string => readFileSync(path.join(hooks, name), "utf8")

describe("bundled git hooks", () => {
  it("runs the entire contract before a commit, skipping nothing", () => {
    const hook = read("pre-commit")
    expect(hook).toMatch(/IPC_HOOK_FULL=1 exec "\$DIR\/pre-push"/)
    expect(hook).not.toMatch(/--skip|--checks/)
  })
  it("lets the shared runner omit the skip list only when asked for the full contract", () => {
    const push = read("pre-push")
    expect(push).toContain('[ "${IPC_HOOK_FULL:-}" = "1" ]')
    expect(push.match(/--skip Coverage,Crap,Mutation/g)).toHaveLength(1)
    expect(push).toContain('SKIP="--skip Coverage,Crap,Mutation"')
  })
  it("skip only the slow analyses, which CI runs", () => {
    expect(read("pre-push")).toContain('SKIP="--skip Coverage,Crap,Mutation"')
    expect(read("pre-push")).not.toMatch(/SKIP="[^"\n]*(Lint|Format|Tests|SecuritySocket)/)
  })
  it("are executable", () => {
    for (const name of ["pre-commit", "pre-push", "commit-msg"]) {
      expect(statSync(path.join(hooks, name)).mode & 0o111, name).not.toBe(0)
    }
  })
})
