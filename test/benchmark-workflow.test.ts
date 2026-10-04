import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const workflow = (name: string) =>
  readFileSync(path.resolve(__dirname, "../.github/workflows", name), "utf8")

describe("benchmark-pr.yml", () => {
  const text = workflow("benchmark-pr.yml")

  it("reads every variable it later uses to build a --example argument (the history path was once dropped)", () => {
    const loop =
      /while IFS='\|' read -r ([a-z_ ]+); do\n((?:(?!\bdone\b)[\s\S])*?)done <<< "\$SUITES"/g
    let checked = 0
    for (const match of text.matchAll(loop)) {
      const body = match[2] ?? ""
      const example = /--example "([^"]*)"/.exec(body)
      if (example === null) continue
      checked += 1
      const assigned = new Set((match[1] ?? "").split(/\s+/).filter(Boolean))
      for (const variable of (example[1] ?? "").matchAll(/\$\{([a-z_]+)\}/g)) {
        if (variable[1] === "safe") continue
        expect(assigned, `\${${variable[1]}} is used but not read`).toContain(variable[1])
      }
      // the history path is the 4th field of an example
      expect(example[1]).toContain("${history}")
    }
    expect(checked).toBe(1)
  })

  it("never writes to the pull request: no bot commit, and a token that can only comment", () => {
    expect(text).not.toMatch(/git push|git commit|contents: write|statuses: write/)
    expect(text).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: write/)
  })

  it("gates the run, and fails it only after the comment is posted", () => {
    expect(text).toContain("--gate")
    const post = text.indexOf("Post or update the marker-tagged summary comment")
    const fail = text.indexOf("Fail the run if a gate failed")
    expect(post).toBeGreaterThan(0)
    expect(fail).toBeGreaterThan(post)
  })

  it("compares against both the previous run on main and the last release's committed results", () => {
    expect(text).toContain("origin/main:${dir}/results.json")
    expect(text).toContain("git describe --tags --abbrev=0 --match 'v[0-9]*' origin/main")
    expect(text).toContain("/tmp/benchmark-release/${safe}.json")
  })

  it("benchmarks on the Node version CI uses, not an older one", () => {
    expect(text).toMatch(/node-version:[\s\S]*?default: 24\.x/)
  })
})
