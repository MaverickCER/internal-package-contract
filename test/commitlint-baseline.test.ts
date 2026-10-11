import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"

const config = path.resolve(__dirname, "../config/commitlint.config.mjs")
// Node runs commitlint's own entry file: `npx` is `npx.cmd` on Windows, which spawnSync cannot start without a shell.
const cli = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@commitlint/cli/package.json")),
  "cli.js",
)
const lint = (message: string) =>
  spawnSync(process.execPath, [cli, "--config", config], { input: message, encoding: "utf8" })

describe("the baseline commitlint config", () => {
  it("accepts a plain conventional commit", () => {
    expect(lint("fix: handle empty input\n\nThe parser threw on an empty string.\n").status).toBe(0)
  })

  it.each([
    ["Co-Authored-By: A Person <a@example.com>"],
    ["co-authored-by: A Person <a@example.com>"],
    ["Co-Authored-By : A Person <a@example.com>"],
    ["Co-Authored-By\t: A Person <a@example.com>"],
    ["Co-authored-by: Some Bot <bot@example.com>"],
  ])("rejects a commit carrying the trailer %s", (trailer) => {
    const result = lint(`fix: handle empty input\n\nThe parser threw.\n\n${trailer}\n`)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("no-co-author-trailer")
    expect(result.stdout).toContain("Co-Authored-By")
  })

  it("does not reject a body that merely mentions the words", () => {
    const body =
      "fix: handle empty input\n\nDocs now explain why a Co-Authored-By trailer is refused.\n"
    expect(lint(body).status).toBe(0)
  })
})
