import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const schema = readFileSync(path.join(root, "ci", "env.schema.ts"), "utf8")

/** Where the standard reads its own variables: what ships, plus the hooks. */
const SOURCES = ["bin", "checks", "hooks", "scripts", "runtime", "contract.ts"]
const CODE = /\.(?:mjs|ts|mts)$|^(?:pre-commit|pre-push|commit-msg)$/
/** A variable name, but not a prefix written as `IPC_MUTATION_*`. */
const IPC_VARIABLE = /\bIPC_[A-Z0-9_]*[A-Z0-9]\b(?!\*)/g

const files = (entry: string): string[] => {
  const full = path.join(root, entry)
  if (!statSync(full).isDirectory()) return [full]
  return readdirSync(full).flatMap((name) => files(path.join(entry, name)))
}

/** Every `IPC_*` name the shipped code and the hooks mention. */
const read = new Set(
  SOURCES.flatMap(files)
    .filter((file) => CODE.test(path.basename(file)) && !file.endsWith(".d.mts"))
    .flatMap((file) => readFileSync(file, "utf8").match(IPC_VARIABLE) ?? []),
)

/** The names the schema both declares (`NAME: { default`) and describes (`NAME: {` under `variables`). */
const declared = (name: string): boolean =>
  new RegExp(`\\b${name}: \\{ default: `).test(schema) &&
  (schema.match(new RegExp(`\\b${name}: \\{`, "g")) ?? []).length === 2

describe("ci/env.schema.ts", () => {
  it("finds the variables the standard reads, so an empty scan cannot pass", () => {
    expect([...read]).toEqual(
      expect.arrayContaining([
        "IPC_HOOK_FULL",
        "IPC_MUTATION_SHARD",
        "IPC_MUTATION_REPORT",
        "IPC_MUTATION_MEMO",
        "IPC_SOCKET_CACHE",
        "IPC_SOCKET_CACHE_DIR",
        "IPC_SOCKET_CACHE_TTL_HOURS",
      ]),
    )
    expect(read.has("IPC_MUTATION")).toBe(false)
  })

  it("declares and describes every IPC_ variable the standard reads", () => {
    for (const name of read) expect(declared(name), name).toBe(true)
  })

  it("declares no IPC_ variable the standard no longer reads", () => {
    const listed = new Set(schema.match(IPC_VARIABLE) ?? [])
    for (const name of listed) expect(read.has(name), name).toBe(true)
  })

  it("declares CI, which turns on --strict and turns off the mutation memo", () => {
    expect(declared("CI")).toBe(true)
    expect(schema).toContain("--strict")
    expect(schema).toContain("IPC_MUTATION_MEMO")
  })
})
