import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// Changesets 3 stopped versioning a private package unless `privatePackages.version` is set. Without it
// `changeset version` succeeds, changes nothing, and the Release workflow cannot open the Version Packages
// pull request; this package is private (it is released as a git tag), so its own config must opt in.
describe("this package's release configuration", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { private?: boolean }
  const config = JSON.parse(readFileSync(".changeset/config.json", "utf8")) as {
    privatePackages?: { version?: boolean; tag?: boolean }
  }

  it("versions this private package, and leaves tagging to the Release workflow", () => {
    expect(manifest.private).toBe(true)
    expect(config.privatePackages).toEqual({ version: true, tag: false })
  })
})
