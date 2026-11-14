import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { standardChecks } from "../checks/standard.js"
import config from "../repo-contract.config.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const readme = readFileSync(path.join(root, "README.md"), "utf8")
const security = readFileSync(path.join(root, "SECURITY.md"), "utf8")
// Built once while the file loads, as `contract.ts` builds it. Mutation testing then treats the
// standard's option values as static: these tests count ids, which cannot judge an option value.
const standardIds = Object.keys(standardChecks())

describe("README and SECURITY.md: the self-contract's numbers", () => {
  it("states in its opening how many checks the standard holds", () => {
    expect(readme).toContain(
      `Together they are **the standard**: ${String(standardIds.length)} checks`,
    )
  })

  it("states how many checks this repository runs and how many standard checks it leaves out", () => {
    const own = Object.keys(config.checks)
    const notRun = standardIds.filter((id) => !own.includes(id))
    expect(readme).toContain(
      `Whether the standard passes its own standard: ${String(own.length)} checks from \`repo-contract.config.ts\``,
    )
    expect(readme).toContain(`${String(notRun.length)} standard checks are not run here`)
  })

  it("states in SECURITY.md how many checks this repository runs on itself and how many it leaves out", () => {
    const own = Object.keys(config.checks)
    const notRun = standardIds.filter((id) => !own.includes(id))
    expect(security).toContain(`This repository runs ${String(own.length)} checks on itself`)
    expect(security).toMatch(
      new RegExp(`each of the\\s+${String(notRun.length)}\\s+standard checks it leaves out`),
    )
  })
})

describe("CONTRIBUTING.md: the main ruleset's required checks", () => {
  it("names every job of this repository's CI workflow, as required or as advisory", () => {
    const contributing = readFileSync(path.join(root, "CONTRIBUTING.md"), "utf8").replace(
      /\s+/g,
      " ",
    )
    const names = (text: string): string[] =>
      [...text.matchAll(/`([a-z0-9-]+)`/g)].map((match) => match[1] as string)
    const required = names(
      /requires .*? and the ((?:`[a-z0-9-]+`(?:, | and ))+`[a-z0-9-]+`) status checks/.exec(
        contributing,
      )?.[1] ?? "",
    )
    const advisory = names(/(`[a-z0-9-]+`) is advisory/.exec(contributing)?.[1] ?? "")
    const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")
    const jobs = [...(ci.split(/^jobs:$/m)[1] ?? "").matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(
      (match) => match[1] as string,
    )
    expect(required).toContain("contract")
    expect([...required, ...advisory].sort()).toEqual(jobs.sort())
  })
})
