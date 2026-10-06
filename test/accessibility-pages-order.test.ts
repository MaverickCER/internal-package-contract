import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

// A directory listing in the reverse of name order, as a filesystem that does not sort would give.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    readdir: async (...args: unknown[]) =>
      ((await (actual.readdir as (...a: unknown[]) => Promise<string[]>)(...args)) as string[])
        .sort()
        .reverse(),
  }
})

const { resolvePages } = await import("../scripts/accessibility-pages.mjs")

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("resolvePages() ordering", () => {
  it("lists pages in name order whatever order the folder lists them in", async () => {
    const docs = mkdtempSync(path.join(tmpdir(), "ipc-a11y-order-"))
    roots.push(docs)
    for (const rel of [
      "c.html",
      "a.html",
      "b/index.html",
      "api/index.html",
      "api/classes/Zed.html",
      "api/classes/Alpha.html",
      "api/modules.html",
    ]) {
      mkdirSync(path.dirname(path.join(docs, rel)), { recursive: true })
      writeFileSync(path.join(docs, rel), "x")
    }
    const found = (await resolvePages(docs)).map((p) =>
      path.relative(docs, p).split(path.sep).join("/"),
    )
    expect(found).toEqual([
      "a.html",
      "api/index.html",
      "b/index.html",
      "c.html",
      "api/classes/Alpha.html",
      "api/modules.html",
    ])
  })
})
