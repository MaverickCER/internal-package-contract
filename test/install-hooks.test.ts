import { describe, expect, it } from "vitest"
import { hooksPathFor, run } from "../scripts/install-hooks.mjs"

describe("hooksPathFor", () => {
  it("prefers the installed copy, relative to the repository", () => {
    expect(hooksPathFor({ installed: true, packageHooks: "/abs/hooks" })).toBe(
      "node_modules/internal-package-contract/hooks",
    )
  })
  it("keeps the path relative to the repository root when the package sits below it", () => {
    expect(
      hooksPathFor({ installed: true, packageHooks: "/abs/hooks", prefix: "packages/app/" }),
    ).toBe("packages/app/node_modules/internal-package-contract/hooks")
    expect(
      hooksPathFor({ installed: false, packageHooks: "/abs/hooks", prefix: "packages/app/" }),
    ).toBe("/abs/hooks")
  })
  it("falls back to this package's own hooks directory when it is not installed under the repository", () => {
    expect(hooksPathFor({ installed: false, packageHooks: "/abs/hooks" })).toBe("/abs/hooks")
  })
})

describe("run", () => {
  const make = (over: Partial<Parameters<typeof run>[0]> = {}) => {
    const calls: string[][] = []
    const out: string[] = []
    const base = {
      inRepo: true,
      installed: true,
      packageHooks: "/abs/hooks",
      git: (args: string[]) => (calls.push(args), 0),
      write: (text: string) => out.push(text),
    }
    return { calls, out, input: { ...base, ...over } }
  }
  it("points git at the hooks and says so", () => {
    const { calls, out, input } = make()
    expect(run(input)).toBe(0)
    expect(calls).toEqual([
      ["config", "core.hooksPath", "node_modules/internal-package-contract/hooks"],
    ])
    expect(out.join("")).toBe(
      "git core.hooksPath -> node_modules/internal-package-contract/hooks\n",
    )
  })
  it("does nothing, and still succeeds, outside a git repository so an install never fails on it", () => {
    const { calls, out, input } = make({ inRepo: false })
    expect(run(input)).toBe(0)
    expect(calls).toEqual([])
    expect(out.join("")).toBe("Not a git repository; hooks were not installed.\n")
  })
  it("still succeeds when git itself fails, saying what happened", () => {
    const { out, input } = make({ git: () => 1 })
    expect(run(input)).toBe(0)
    expect(out.join("")).toBe("git config core.hooksPath failed; hooks were not installed.\n")
  })
})
