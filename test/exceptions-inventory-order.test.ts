import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

// A directory listing in the reverse of name order, as a filesystem that does not sort would give.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    readdirSync: (...args: unknown[]) =>
      (actual.readdirSync as (...a: unknown[]) => string[])(...args)
        .sort()
        .reverse(),
  }
})

const { REGISTRY_DIR, collectInventory } = await import("../scripts/exceptions-inventory.mjs")

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("collectInventory() ordering", () => {
  it("reports registries and unreadable files in name order whatever order the folder lists them in", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-inventory-order-"))
    roots.push(root)
    mkdirSync(path.join(root, REGISTRY_DIR), { recursive: true })
    for (const name of ["c", "a", "b"])
      writeFileSync(
        path.join(root, REGISTRY_DIR, `${name}.json`),
        JSON.stringify({ exceptions: [] }),
      )
    for (const name of ["z", "y"])
      writeFileSync(path.join(root, REGISTRY_DIR, `${name}.json`), "{ bad")
    const inventory = collectInventory(root)
    expect(inventory.registries.map((r) => r.name)).toEqual(["a", "b", "c"])
    expect(inventory.errors?.map((e) => e.name)).toEqual(["y", "z"])
  })
})
