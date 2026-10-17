import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { COMMANDS } from "../scripts/contract-help.mjs"

/**
 * A message that tells someone to run `internal-package-contract <something>` is only useful if that is a
 * command. This reads every place the package writes such a hint (checks, scripts, hooks, templates, the README)
 * and fails on one that names a command the help does not list.
 */
const root = path.resolve(import.meta.dirname, "..")
const OPTIONS = ["--checks", "--skip", "--strict", "--no-strict", "--help", "-h"]

const commands = (): string[] =>
  COMMANDS.map((command) => command.name).filter((name) => name !== "(none)")

function files(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (
      ["node_modules", ".git", "reports", "coverage", ".stryker-tmp", "CHANGELOG.md"].includes(name)
    )
      continue
    const full = path.join(directory, name)
    if (statSync(full).isDirectory()) files(full, found)
    else if (/\.(ts|mjs|md|yml|json)$/.test(name) && !/^test\//.test(path.relative(root, full)))
      found.push(full)
  }
  return found
}

describe("every command a message or document tells someone to run", () => {
  it("is one the help lists", () => {
    const known = new Set([...commands(), ...OPTIONS])
    const unknown: string[] = []
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(/`internal-package-contract ((?:--)?[a-z][a-z-]*)/g)) {
        if (!known.has(match[1] ?? ""))
          unknown.push(`${path.relative(root, file)}: \`internal-package-contract ${match[1]}\``)
      }
    }
    expect(unknown).toEqual([])
  })
  it("reads the command list from the help, so a command that is added or removed is checked", () => {
    expect(commands()).toEqual(
      expect.arrayContaining(["init", "doctor", "upgrade", "promote", "generate", "sync"]),
    )
    expect(commands()).not.toContain("setup")
    expect(commands()).not.toContain("adopt")
  })
})
