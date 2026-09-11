import { describe, expect, it } from "vitest"
import { gitHygiene } from "../checks/git-hygiene.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const CLEAN_PKG = {
  private: false,
  hasFiles: true,
  hasLicense: true,
  hasRepository: true,
  hasEnginesNode: true,
  hasType: true,
  hasPackageManager: true,
}

const CLEAN_EVIDENCE = {
  isRepo: true,
  gitignore: "node_modules\ndist\ncoverage\n.stryker-tmp\nreports\n",
  gitattributesPresent: true,
  editorconfigPresent: true,
  nvmrcPresent: true,
  tracked: ["src/index.ts"],
  conflictFiles: [],
  pkg: CLEAN_PKG,
}

describe("gitHygiene", () => {
  it("fails, naming the tool, when the evidence gatherer terminated abnormally", async () => {
    const result = await gitHygiene.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("git-hygiene")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when the evidence gatherer produced no readable JSON", async () => {
    const result = await gitHygiene.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Git hygiene: evidence gatherer produced no readable JSON.",
    })
  })

  it("fails when the parsed JSON value is null (success true)", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeResult({ output: { format: "json", success: true, value: null } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Git hygiene: evidence gatherer produced no readable JSON.",
    })
  })

  it("fails when the parsed JSON value is a non-object primitive", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeResult({ output: { format: "json", success: true, value: 42 } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Git hygiene: evidence gatherer produced no readable JSON.",
    })
  })

  it("fails when not a git repository", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, isRepo: false })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Git hygiene: not a git repository. Run `git init`.",
    })
  })

  it("passes a fully clean repo", async () => {
    const result = await gitHygiene.policy(makeContext(makeJsonResult(CLEAN_EVIDENCE)))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Git hygiene: repo is clean and publishable.",
    })
  })

  it("blocks on a missing .gitignore, without ALSO warning about missing essentials (there is no .gitignore content to check)", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, gitignore: undefined })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Git hygiene: blocking issue(s):\n- no .gitignore -- run `internal-package-contract init`",
    })
  })

  it("warns (not blocks) when .gitignore is missing an essential", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, gitignore: "node_modules\n" })),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain(".gitignore does not mention: dist, coverage")
  })

  it("blocks on tracked files that must not be committed", async () => {
    const result = await gitHygiene.policy(
      makeContext(
        makeJsonResult({ ...CLEAN_EVIDENCE, tracked: ["src/index.ts", "dist/index.js"] }),
      ),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "1 tracked file(s) that must not be committed: dist/index.js",
    )
  })

  it("lists exactly 10 entries with no truncation marker at exactly the boundary", async () => {
    const badFiles = Array.from({ length: 10 }, (_, i) => `dist/${String(i)}.js`)
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, tracked: badFiles })),
    )
    expect(result.rationale).toContain(
      `10 tracked file(s) that must not be committed: ${badFiles.join(", ")}`,
    )
    expect(result.rationale).not.toContain("…")
    expect(result.rationale).not.toContain("Stryker was here")
  })

  it("truncates the tracked-file list past 10 entries, listing only the first 10 by name", async () => {
    const badFiles = Array.from({ length: 12 }, (_, i) => `dist/${String(i)}.js`)
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, tracked: badFiles })),
    )
    expect(result.rationale).toContain(
      `12 tracked file(s) that must not be committed: ${badFiles.slice(0, 10).join(", ")} …`,
    )
    expect(result.rationale).not.toContain("dist/10.js")
    expect(result.rationale).not.toContain("dist/11.js")
  })

  it("blocks on an unresolved merge-conflict marker, joining multiple files with a comma", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, conflictFiles: ["src/a.ts", "src/b.ts"] })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("unresolved merge-conflict marker(s) in: src/a.ts, src/b.ts")
  })

  it("blocks a non-private package.json with no files array", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, pkg: { ...CLEAN_PKG, hasFiles: false } })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain('no "files" array')
  })

  it("does not require files for a private package.json", async () => {
    const result = await gitHygiene.policy(
      makeContext(
        makeJsonResult({
          ...CLEAN_EVIDENCE,
          pkg: { ...CLEAN_PKG, private: true, hasFiles: false, hasRepository: false },
        }),
      ),
    )
    expect(result.outcome).toBe("pass")
  })

  it("warns, with the exact heading/footer and one bulleted line, on a single non-blocking issue", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, pkg: { ...CLEAN_PKG, hasLicense: false } })),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale: [
        "Git hygiene: no blocking issues; non-blocking suggestions:",
        '- package.json has no "license"',
        "",
        "`internal-package-contract init` scaffolds the missing repo files.",
      ].join("\n"),
    })
  })

  it("warns on every missing non-blocking package.json / repo-file field, combined", async () => {
    const result = await gitHygiene.policy(
      makeContext(
        makeJsonResult({
          ...CLEAN_EVIDENCE,
          gitattributesPresent: false,
          editorconfigPresent: false,
          nvmrcPresent: false,
          pkg: {
            ...CLEAN_PKG,
            hasLicense: false,
            hasRepository: false,
            hasEnginesNode: false,
            hasType: false,
          },
        }),
      ),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain('no "license"')
    expect(result.rationale).toContain('no "repository"')
    expect(result.rationale).toContain('no "engines.node"')
    expect(result.rationale).toContain('no "type"')
    expect(result.rationale).toContain("no .gitattributes")
    expect(result.rationale).toContain("no .editorconfig")
    expect(result.rationale).toContain("no .nvmrc")
    expect(result.rationale).toContain("internal-package-contract init")
  })

  it("blocks with no 'Also (non-blocking)' section at all when there are zero warnings", async () => {
    const result = await gitHygiene.policy(
      makeContext(makeJsonResult({ ...CLEAN_EVIDENCE, conflictFiles: ["src/index.ts"] })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Git hygiene: blocking issue(s):\n- unresolved merge-conflict marker(s) in: src/index.ts",
    })
  })

  it("reports non-blocking warnings alongside a blocking failure, exactly", async () => {
    const result = await gitHygiene.policy(
      makeContext(
        makeJsonResult({
          ...CLEAN_EVIDENCE,
          isRepo: true,
          conflictFiles: ["src/index.ts"],
          pkg: { ...CLEAN_PKG, hasLicense: false },
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Git hygiene: blocking issue(s):",
        "- unresolved merge-conflict marker(s) in: src/index.ts",
        "",
        "Also (non-blocking):",
        '- package.json has no "license"',
      ].join("\n"),
    })
  })
})
