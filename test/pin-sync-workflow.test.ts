import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8")

describe("the pin-sync workflow", () => {
  const text = read(".github/workflows/dependency-pin-sync.yml")
  it("pushes and merges with the optional token, and dispatches CI with the default one", () => {
    expect(text).toMatch(/secrets:\n {6}PIN_SYNC_TOKEN:[\s\S]*?required: false/)
    expect(text).toContain("token: ${{ secrets.PIN_SYNC_TOKEN || github.token }}")
    // The pull request step pushes workflow files, which only the optional token may do.
    expect(
      text.match(/GH_TOKEN: \$\{\{ secrets\.PIN_SYNC_TOKEN \|\| github\.token \}\}/g),
    ).toHaveLength(1)
    // GitHub starts a run for a dispatch sent with GITHUB_TOKEN; a token without Actions write gets 403.
    const dispatch = text.slice(text.indexOf("- name: Dispatch CI"))
    expect(dispatch).toContain("GH_TOKEN: ${{ github.token }}")
    expect(dispatch).toContain("MERGE_TOKEN: ${{ secrets.PIN_SYNC_TOKEN || github.token }}")
    expect(dispatch).toContain('GH_TOKEN="$MERGE_TOKEN" gh pr merge')
    expect(dispatch.indexOf('gh workflow run "$WORKFLOW"')).toBeLessThan(
      dispatch.indexOf('MERGE_TOKEN" gh'),
    )
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
  it("names the same token permissions everywhere a person reads them", () => {
    // ci/env.schema.ts is the source: docs/ENVIRONMENT.md is generated from it, and doctor repeats it offline.
    const listed = (prose: string): string[] => {
      const list =
        /((?:"?[A-Z][a-z]+(?: [a-z]+)?"?, )+"?[A-Z][a-z]+(?: [a-z]+)?"? and "?[A-Z][a-z]+"?) write access/.exec(
          prose.replace(/\s+/g, " "),
        )?.[1]
      return (list ?? "").split(/, | and /).map((name) => name.replaceAll('"', ""))
    }
    const permissions = listed(read("ci/env.schema.ts"))
    expect(permissions).toEqual(["Contents", "Pull requests", "Workflows"])
    for (const file of ["docs/ENVIRONMENT.md", "scripts/doctor/run.mjs"])
      expect(listed(read(file)), file).toEqual(permissions)
  })
  it("points the workflow's secret description at the caller's generated catalog instead of listing permissions", () => {
    const description = /PIN_SYNC_TOKEN:\n\s+description: >-\n([\s\S]*?)\n\s+required:/.exec(
      text,
    )?.[1]
    // The caller's catalog is generated from the release it pins. This repository's `main` can be newer.
    expect(description).toContain(
      "calling repository's `docs/ENVIRONMENT.md#ci-secrets-pin_sync_token`",
    )
    expect(description).toContain("`internal-package-contract env`")
    expect(description).not.toMatch(/https?:\/\//)
    expect(description).not.toMatch(/write access/)
  })
  it("leaves the permission list out of the README and links to the generated catalog instead", () => {
    const readme = read("README.md")
    expect(readme).toContain("(docs/ENVIRONMENT.md#ci-secrets-pin_sync_token)")
    expect(read("docs/ENVIRONMENT.md")).toContain('<a id="ci-secrets-pin_sync_token"></a>')
    expect(readme).not.toMatch(/[A-Z][a-z]+(?: [a-z]+)?"?,? and "?[A-Z][a-z]+"? write access/)
  })
  it("is called with the token by the scaffolded consumer workflow", () => {
    const consumer = read("template/package/.github/workflows/sync-internal-package-contract.yml")
    expect(consumer).toContain("PIN_SYNC_TOKEN: ${{ secrets.PIN_SYNC_TOKEN }}")
  })
})
