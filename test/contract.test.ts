import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import contract from "../contract.js"
import { packageRoot } from "../checks/shared.js"

/**
 * Guards against exactly the drift `README.md`'s "The N checks" section is
 * prone to: a check added/removed/renamed in `contract.ts` without the README
 * table following. Parses the table mechanically rather than re-deriving the
 * check list by hand, so this test itself can't drift the same way.
 */
function extractDocumentedCheckNames(readme: string): readonly string[] {
  // Every check but `Build` is a table row (`| `Name` | ... |`); `Build` alone
  // is called out as prose under "### 2 — Build barrier" (`` `Build` — ... ``)
  // since it's the lone barrier phase, not a row in either table.
  const tableRowPattern = /^\|\s*`([A-Za-z]+)`\s*\|/gm
  const prosePattern = /^`([A-Za-z]+)`\s+—/gm
  return [
    ...[...readme.matchAll(tableRowPattern)].map((match) => match[1] as string),
    ...[...readme.matchAll(prosePattern)].map((match) => match[1] as string),
  ]
}

function extractHeadingCount(readme: string): number {
  const match = /## The (\d+) checks/.exec(readme)
  if (!match) throw new Error('README.md is missing a "## The N checks" heading.')
  return Number(match[1])
}

describe("README.md's check table", () => {
  const readme = readFileSync(path.join(packageRoot, "README.md"), "utf8")
  const actualChecks = Object.keys(contract.checks)
  const documentedChecks = extractDocumentedCheckNames(readme)

  it("heading count matches contract.ts's actual number of checks", () => {
    expect(extractHeadingCount(readme)).toBe(actualChecks.length)
  })

  it("lists exactly the checks contract.ts actually declares, no more, no fewer", () => {
    expect(new Set(documentedChecks)).toStrictEqual(new Set(actualChecks))
  })
})
