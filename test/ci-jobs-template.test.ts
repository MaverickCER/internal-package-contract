import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const REQUIRED_NEEDS = "needs: [standard, node-floor, typescript-7]"

// The managed ci-jobs-test must audit the workflow the package actually has. The three packages name it ci.yml,
// and a package scaffolded by `init` names it contract.yml. A copy that only reads ci.yml would crash there.
it("the ci-jobs-test template reads ci.yml, or contract.yml when there is no ci.yml", () => {
  const text = readFileSync(path.join(root, "template", "test", "ci-jobs.test.ts"), "utf8")
  expect(text).toContain('existsSync(".github/workflows/ci.yml")')
  expect(text).toMatch(/\? "\.github\/workflows\/ci\.yml"\s*: "\.github\/workflows\/contract\.yml"/)
  expect(text).toContain("readFileSync(workflow,")
  expect(text).not.toContain('readFileSync(".github/workflows/ci.yml"')
})

// Runs the managed copy itself, with vitest, in a package laid out as `init` leaves it: package.json and
// .github/workflows/contract.yml, no ci.yml.
describe("the ci-jobs-test template in a package init scaffolded", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-ci-jobs-"))
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true })
    mkdirSync(path.join(dir, "test", "_ipc"), { recursive: true })
    copyFileSync(
      path.join(root, "template", "package", "package.json"),
      path.join(dir, "package.json"),
    )
    copyFileSync(
      path.join(root, "runtime", "ci-jobs.ts"),
      path.join(dir, "test", "_ipc", "ci-jobs.ts"),
    )
    copyFileSync(
      path.join(root, "template", "test", "ci-jobs.test.ts"),
      path.join(dir, "test", "ci-jobs.test.ts"),
    )
    symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "junction")
    writeFileSync(
      path.join(dir, "vitest.config.mjs"),
      `export default { cacheDir: ".vite", test: { include: ["test/**/*.test.ts"] } }\n`,
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const runWith = (workflow: string): { status: number | null; output: string } => {
    writeFileSync(path.join(dir, ".github", "workflows", "contract.yml"), workflow)
    const run = spawnSync(
      process.execPath,
      [path.join(root, "node_modules", "vitest", "vitest.mjs"), "run", "--no-color"],
      { cwd: dir, encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } },
    )
    return { status: run.status, output: `${run.stdout}${run.stderr}` }
  }

  const template = readFileSync(path.join(root, "template", "contract.yml"), "utf8")

  it("passes on the contract.yml init writes", () => {
    const { status, output } = runWith(template)
    expect(output).toContain("1 passed")
    expect(status).toBe(0)
  }, 60_000)

  it("fails and names the job when one is dropped from required.needs", () => {
    expect(template).toContain(REQUIRED_NEEDS)
    const { status, output } = runWith(
      template.replace(REQUIRED_NEEDS, "needs: [standard, node-floor]"),
    )
    expect(output).toContain(
      "`typescript-7` is not in `required.needs`, so its result does not block a merge",
    )
    expect(status).toBe(1)
  }, 60_000)
})
