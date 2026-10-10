import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The release flow is what turns a merge into a version and a tag, so its shape is pinned here.
 *
 * Two facts it has to keep true:
 * - `changesets/action` is pinned to a real release, named exactly. The step outputs the flow reads
 *   (`pullRequestNumber`) exist only from v1.4.0; an older pin leaves them empty, so every step gated on
 *   them is silently skipped (the pin was once v1.0.0 behind a `# v1` comment).
 * - A person merges every release PR. Nothing in the flow merges one.
 */
const root = path.resolve(import.meta.dirname, "..")
const workflows = ["release.yml", "release-npm-changesets.yml"].map((name) => ({
  name,
  text: readFileSync(path.join(root, ".github/workflows", name), "utf8"),
}))

const PIN = /changesets\/action@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)\b/g

function atLeast(version: string, minimum: [number, number]): boolean {
  const [major = 0, minor = 0] = version.slice(1).split(".").map(Number)
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1])
}

describe("release workflows", () => {
  it("pin changesets/action to an exactly named release that sets the outputs the flow reads", () => {
    for (const { name, text } of workflows) {
      const uses = text.match(/changesets\/action@\S+.*/g) ?? []
      expect(uses, `${name} should use changesets/action once`).toHaveLength(1)
      const pins = [...text.matchAll(PIN)]
      expect(
        pins,
        `${name}: pin changesets/action by SHA with its exact tag, e.g. '# v1.9.0'`,
      ).toHaveLength(1)
      expect(
        atLeast(pins[0]?.[2] ?? "v0.0.0", [1, 4]),
        `${name}: pullRequestNumber needs >= v1.4.0`,
      ).toBe(true)
    }
  })

  it("use the same changesets/action commit in both workflows", () => {
    const pins = workflows.map(({ text }) =>
      [...text.matchAll(PIN)].map((match) => `${match[1]} ${match[2]}`),
    )
    expect(new Set(pins.flat()).size).toBe(1)
  })

  it("never merge a release PR", () => {
    for (const { name, text } of workflows) {
      expect(text, `${name} must not merge a release PR; a person does`).not.toMatch(/gh pr merge/)
    }
  })
})
