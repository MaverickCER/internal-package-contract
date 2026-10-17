import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import * as logs from "../logs.js"
import * as helpers from "repo-contract/helpers"

describe("internal-package-contract/logs", () => {
  it("hands out the very hooks repo-contract ships, so nothing is rewritten here", () => {
    expect(logs.onEvidenceSaveToRepoContractLogs).toBe(helpers.onEvidenceSaveToRepoContractLogs)
    expect(logs.onVerdictPrependRepoContractLogs).toBe(helpers.onVerdictPrependRepoContractLogs)
    expect(logs.repoContractLogs).toBe(helpers.repoContractLogs)
    expect(logs.REPO_CONTRACT_LOG_DIRECTORY).toBe(helpers.REPO_CONTRACT_LOG_DIRECTORY)
  })

  it("is a published export of the package", () => {
    const manifest = createRequire(import.meta.url)("../package.json") as {
      exports: Record<string, string>
      files: string[]
    }
    expect(manifest.exports["./logs"]).toBe("./logs.ts")
    expect(manifest.files).toContain("logs.ts")
  })
})
