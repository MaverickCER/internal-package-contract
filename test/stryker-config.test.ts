import path from "node:path"
import { pathToFileURL } from "node:url"
import { strykerConfig } from "repo-contract/config/stryker"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const dryRunMinutes = async (file: string): Promise<unknown> =>
  (
    (await import(pathToFileURL(path.join(root, file)).href)) as {
      default: { dryRunTimeoutMinutes?: unknown }
    }
  ).default.dryRunTimeoutMinutes

describe("the Stryker dry-run timeout", () => {
  const floor = strykerConfig().dryRunTimeoutMinutes

  it("in the bundled config is at least repo-contract's, so a consumer's first run outlasts a loaded machine", async () => {
    expect(await dryRunMinutes("config/stryker.config.mjs")).toBeGreaterThanOrEqual(floor)
  })

  it("in this repository's own config is at least repo-contract's", async () => {
    expect(await dryRunMinutes("stryker.config.mjs")).toBeGreaterThanOrEqual(floor)
  })
})
