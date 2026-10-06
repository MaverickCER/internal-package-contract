import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MAX_PAGES, resolvePages } from "../scripts/accessibility-pages.mjs"

let docs: string
beforeEach(() => {
  docs = mkdtempSync(path.join(tmpdir(), "ipc-a11y-pages-"))
})
afterEach(() => rmSync(docs, { recursive: true, force: true }))

const write = (rel: string) => {
  mkdirSync(path.dirname(path.join(docs, rel)), { recursive: true })
  writeFileSync(path.join(docs, rel), "<!doctype html>")
}
const rel = (pages: string[]) => pages.map((p) => path.relative(docs, p).split(path.sep).join("/"))

describe("resolvePages()", () => {
  it("is empty when nothing has been built", async () => {
    expect(await resolvePages(docs)).toEqual([])
    expect(await resolvePages(path.join(docs, "missing"))).toEqual([])
  })

  it("finds the site, every section's landing page, and ignores directories without one", async () => {
    write("index.html")
    write("404.html")
    write("benchmarks/index.html")
    write("assets/x.css")
    write("api-report/Foo.md")
    expect(rel(await resolvePages(docs)).sort()).toEqual([
      "404.html",
      "benchmarks/index.html",
      "index.html",
    ])
  })

  it("adds one representative page per kind of API page, not every page", async () => {
    write("api/index.html")
    write("api/classes/A.html")
    write("api/classes/B.html")
    write("api/functions/f.html")
    write("api/interfaces/index.html")
    write("api/assets/main.js")
    write("api/modules.html")
    const pages = rel(await resolvePages(docs))
    expect(pages).toContain("api/index.html")
    expect(pages).toContain("api/classes/A.html")
    expect(pages).not.toContain("api/classes/B.html")
    expect(pages).toContain("api/functions/f.html")
    expect(pages).toContain("api/modules.html")
    expect(pages.filter((p) => p.startsWith("api/interfaces/"))).toEqual([
      "api/interfaces/index.html",
    ])
  })

  it("names what is wrong when docs/api exists without a landing page", async () => {
    write("api/classes/A.html")
    await expect(resolvePages(docs)).rejects.toThrow(
      /docs\/api\/ exists but the expected landing page/,
    )
  })

  it("never scans more than the cap", async () => {
    for (let i = 0; i < MAX_PAGES + 10; i++) write(`p${String(i).padStart(3, "0")}.html`)
    expect(await resolvePages(docs)).toHaveLength(MAX_PAGES)
  })
})
