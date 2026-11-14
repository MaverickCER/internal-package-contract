import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const fixture = mkdtempSync(path.join(tmpdir(), "ipc-readme-output-"))
afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
})

/** The `text` block the README shows under "Try it", one entry per non-empty line. */
function readmeExcerpt(): string[] {
  const readme = readFileSync(path.join(root, "README.md"), "utf8")
  const after = readme.split(
    "<!-- Checked against a real run by test/readme-contract-output.test.ts. -->",
  )[1]
  const block = /```text\n([\s\S]*?)\n```/.exec(after ?? "")?.[1] ?? ""
  return block.split("\n").filter((line) => line !== "")
}

/**
 * The package the excerpt describes: Node.js 24, one workflow that tests on it, and a README whose
 * generated region is stale. The run's result lines and totals must equal the README's lines.
 */
function realRun(): string[] {
  mkdirSync(path.join(fixture, ".github", "workflows"), { recursive: true })
  writeFileSync(
    path.join(fixture, "package.json"),
    `${JSON.stringify({ name: "demo-pkg", version: "1.0.0", type: "module", engines: { node: ">=24" } })}\n`,
  )
  writeFileSync(
    path.join(fixture, ".github", "workflows", "ci.yml"),
    "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node-version: [24]\n    steps:\n      - run: npm test\n",
  )
  writeFileSync(
    path.join(fixture, "README.md"),
    "# demo-pkg\n\n<!-- ipc:begin supported-versions -->\nold\n<!-- ipc:end supported-versions -->\n",
  )
  // Outside CI on purpose: the excerpt is what a person sees locally, and a step summary must not grow.
  const env = { ...process.env }
  for (const name of ["CI", "GITHUB_ACTIONS", "GITHUB_STEP_SUMMARY"]) delete env[name]
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "bin", "contract.mjs"),
      "--checks",
      "GeneratedRegions,EngineMatrix,PromptBlocks,DocsMarkdown",
      "--logs",
      "off",
    ],
    { cwd: fixture, encoding: "utf8", env, timeout: 90_000 },
  )
  expect(result.status, result.stderr).toBe(1)
  return result.stdout
    .split("\n")
    .filter((line) => /^\[[A-Z]+\] /.test(line) || /^\d+ pass, /.test(line))
}

describe("README.md's contract output excerpt", () => {
  it("shows one failure with its fix and some passes", () => {
    const lines = readmeExcerpt()
    expect(lines.filter((line) => line.startsWith("[FAIL] "))).toHaveLength(1)
    expect(lines.filter((line) => line.startsWith("[PASS] ")).length).toBeGreaterThan(1)
    expect(lines.find((line) => line.startsWith("[FAIL] "))).toContain("Run `")
  })

  it("is what a real run prints, line for line (checks finish in any order)", () => {
    expect(realRun().sort()).toEqual(readmeExcerpt().sort())
  }, 120_000)
})
