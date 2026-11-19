import path from "node:path"
import { ESLint } from "eslint"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")

// The contract runs Lint while Mutation runs. Stryker's sandbox is a full copy of the package, its
// eslint.config.mjs included, so `eslint .` would lint that copy too, and typescript-eslint stops on the second
// config root it finds there. The baseline every consumer extends must leave the sandbox out.
describe("the baseline ESLint config", () => {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: path.join(root, "eslint.config.mjs") })

  it("ignores Stryker's sandbox, at any depth inside it", async () => {
    for (const file of [
      ".stryker-tmp/sandbox-x/eslint.config.mjs",
      ".stryker-tmp/sandbox-x/checks/parts.ts",
      ".stryker-tmp/sandbox-x/src/index.ts",
    ]) {
      expect(await eslint.isPathIgnored(path.join(root, file)), file).toBe(true)
    }
  })

  it("still lints the package's own files", async () => {
    for (const file of ["eslint.config.mjs", "checks/parts.ts", "src/index.ts"]) {
      expect(await eslint.isPathIgnored(path.join(root, file)), file).toBe(false)
    }
  })
})
