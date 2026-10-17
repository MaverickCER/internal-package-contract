import { describe, expect, it } from "vitest"
import { repositoryOwner } from "../scripts/repository-owner.mjs"

describe("repositoryOwner", () => {
  it("reads the owner from every way a GitHub repository is written", () => {
    for (const written of [
      "https://github.com/Acme/w",
      "https://github.com/Acme/w.git",
      "git+https://github.com/Acme/w.git",
      "git+ssh://git@github.com/Acme/w.git",
      "git@github.com:Acme/w.git",
      "github:Acme/w",
      "Acme/w",
      "Acme/w.js",
      { url: "git+https://github.com/Acme/w.git" },
      { type: "git", url: "github:Acme/w" },
    ]) {
      expect(repositoryOwner(written), JSON.stringify(written)).toBe("Acme")
    }
  })

  it("says nothing for what it cannot read", () => {
    for (const written of [
      undefined,
      null,
      "",
      {},
      { url: 3 },
      3,
      "https://gitlab.com/Acme/w",
      "not a repository",
      "a/b/c",
      "Acme/",
      "/w",
      "github:Acme",
    ]) {
      expect(repositoryOwner(written), JSON.stringify(written)).toBeUndefined()
    }
  })
})
