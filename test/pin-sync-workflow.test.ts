import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8")

describe("the pin-sync workflow", () => {
  const text = read(".github/workflows/dependency-pin-sync.yml")
  it("accepts an optional token that can push workflow files, and falls back to the default one", () => {
    expect(text).toMatch(/secrets:\n {6}PIN_SYNC_TOKEN:[\s\S]*?required: false/)
    expect(text).toContain("token: ${{ secrets.PIN_SYNC_TOKEN || github.token }}")
    expect(
      text.match(/GH_TOKEN: \$\{\{ secrets\.PIN_SYNC_TOKEN \|\| github\.token \}\}/g),
    ).toHaveLength(2)
    expect(text).not.toContain("GH_TOKEN: ${{ github.token }}")
  })
  it("moves a git dependency with `upgrade` when the installed release has it, and by hand when it does not", () => {
    expect(text).toContain("npm ci --ignore-scripts")
    expect(text).toContain('[ -f "node_modules/${DEP}/scripts/upgrade/run.mjs" ]')
    expect(text).toContain('node "node_modules/${DEP}/bin/contract.mjs" upgrade "${LATEST_TAG}"')
    expect(text).toContain(
      'npm install --save-dev --ignore-scripts "${DEP}@github:${REPO_SLUG}#${LATEST_TAG}"',
    )
  })
  it("commits everything the upgrade changed, not only the pin", () => {
    expect(text).toContain('if [ -z "$(git status --porcelain)" ]; then')
    expect(text).toMatch(/\n {10}git add -A\n/)
  })
  it("is called with the token by the scaffolded consumer workflow", () => {
    const consumer = read("template/package/.github/workflows/sync-internal-package-contract.yml")
    expect(consumer).toContain("PIN_SYNC_TOKEN: ${{ secrets.PIN_SYNC_TOKEN }}")
  })
})
