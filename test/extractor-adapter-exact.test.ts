import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { runApiExtractorForTarget } from "../scripts/api-contract/extractor-adapter.js"

const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
afterEach(() => vi.restoreAllMocks())

function makeRoot(source: string) {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-extractor-"))
  roots.push(root)
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  write("package.json", JSON.stringify({ name: "fx", version: "1.0.0", type: "module" }))
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "dist/.dts",
        rootDir: "src",
        skipLibCheck: true,
      },
      include: ["src"],
    }),
  )
  const compile = (text: string) => {
    write("src/index.ts", text)
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
  }
  compile(source)
  return { root, compile }
}

const target = { name: "index", mainEntryPointFilePath: "dist/.dts/index.d.ts" }

describe("runApiExtractorForTarget()", { timeout: 120_000 }, () => {
  it("writes the Doc Model, the declaration rollup and the API report under the target's own folder", () => {
    const { root } = makeRoot("/** @public */\nexport function f(): void {}\n")
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const result = runApiExtractorForTarget(root, target)
    const outDir = path.join(root, ".repo-contract", "api-contract", "index")
    expect(result).toMatchObject({
      succeeded: true,
      errorCount: 0,
      apiJsonFilePath: path.join(outDir, "current.api.json"),
      dtsRollupFilePath: path.join(outDir, "current.d.ts"),
      apiReportFilePath: path.join(outDir, "current.api.md"),
    })
    for (const file of ["current.api.json", "current.d.ts", "current.api.md"])
      expect(existsSync(path.join(outDir, file)), file).toBe(true)
  })

  it("keeps every API Extractor message on stderr, prefixed, and off stdout", () => {
    const { root } = makeRoot("/** @public */\nexport function f(): void {}\n")
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    runApiExtractorForTarget(root, target)
    const written = stderr.mock.calls.map(([chunk]) => String(chunk))
    expect(written.length).toBeGreaterThan(0)
    for (const line of written) expect(line).toMatch(/^\[api-extractor\] .+\n$/)
    expect(written.join("")).toContain('[api-extractor] Missing documentation for "f".\n')
    expect(stdout).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it("overwrites an earlier report instead of failing on the difference, as a local build does", () => {
    const { root, compile } = makeRoot("/** @public */\nexport function f(): void {}\n")
    vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    expect(runApiExtractorForTarget(root, target).succeeded).toBe(true)
    compile(
      "/** @public */\nexport function f(): void {}\n/** @public */\nexport function g(): void {}\n",
    )
    const second = runApiExtractorForTarget(root, target)
    expect(second.succeeded).toBe(true)
    expect(second.errorCount).toBe(0)
  })
})
