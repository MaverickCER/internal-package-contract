import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MAX_PAGES, resolvePages } from "../scripts/accessibility-pages.mjs"

let docs: string
beforeEach(() => {
  docs = mkdtempSync(path.join(tmpdir(), "ipc-a11y-exact-"))
})
afterEach(() => rmSync(docs, { recursive: true, force: true }))

const write = (rel: string) => {
  mkdirSync(path.dirname(path.join(docs, rel)), { recursive: true })
  writeFileSync(path.join(docs, rel), "<!doctype html>")
}
const pages = async () =>
  (await resolvePages(docs)).map((p) => path.relative(docs, p).split(path.sep).join("/"))

describe("resolvePages() the site", () => {
  it("lists top-level pages and section landing pages in name order, nothing else", async () => {
    for (const rel of [
      "z.html",
      "b.html",
      "a/index.html",
      "s/index.html",
      "s/other.html",
      "t/page.html",
      "notes.txt",
      "style.css",
      "index.html",
    ])
      write(rel)
    expect(await pages()).toEqual([
      "a/index.html",
      "b.html",
      "index.html",
      "s/index.html",
      "z.html",
    ])
  })

  it("ignores a file named like a section, and a section whose landing page is a directory", async () => {
    write("plain")
    mkdirSync(path.join(docs, "odd", "index.html"), { recursive: true })
    write("real/index.html")
    expect(await pages()).toEqual(["odd/index.html", "real/index.html"])
  })

  it("is empty for a folder that does not exist", async () => {
    expect(await resolvePages(path.join(docs, "missing"))).toEqual([])
  })
})

describe("resolvePages() the API reference", () => {
  it("adds one page per kind: the first that is not an index, else the index, in name order", async () => {
    write("api/index.html")
    write("api/classes/index.html")
    write("api/classes/Zed.html")
    write("api/classes/Alpha.html")
    write("api/enums/index.html")
    write("api/functions/b.html")
    write("api/functions/a.html")
    write("api/functions/notes.txt")
    write("api/variables/z.css")
    write("api/modules.html")
    write("api/overview.html")
    write("api/guides/index.html")
    write("api/guides/overview.html")
    expect(await pages()).toEqual([
      "api/index.html",
      "api/classes/Alpha.html",
      "api/enums/index.html",
      "api/functions/a.html",
      "api/guides/overview.html",
      "api/modules.html",
      "api/overview.html",
    ])
  })

  it("does not list a page under api twice", async () => {
    write("api/index.html")
    write("api/modules.html")
    const found = await pages()
    expect(found.filter((p) => p === "api/index.html")).toHaveLength(1)
    expect(found.filter((p) => p === "api/modules.html")).toHaveLength(1)
  })

  it("names the missing landing page exactly", async () => {
    write("api/classes/A.html")
    await expect(resolvePages(docs)).rejects.toThrow(
      `docs/api/ exists but the expected landing page ${path.join(docs, "api", "index.html")} does not -- check the API-doc generator's own output configuration.`,
    )
  })

  it("takes no API pages when there is no api folder, or it is a file", async () => {
    write("index.html")
    expect(await pages()).toEqual(["index.html"])
    write("api")
    expect(await pages()).toEqual(["index.html"])
  })
})

describe("resolvePages() the cap", () => {
  it("keeps the first MAX_PAGES in name order", async () => {
    expect(MAX_PAGES).toBe(40)
    for (let i = 0; i < MAX_PAGES + 5; i++) write(`p${String(i).padStart(3, "0")}.html`)
    const found = await pages()
    expect(found).toHaveLength(40)
    expect(found[0]).toBe("p000.html")
    expect(found[39]).toBe("p039.html")
  })

  it("keeps exactly the cap when there are exactly that many", async () => {
    for (let i = 0; i < MAX_PAGES; i++) write(`p${String(i).padStart(3, "0")}.html`)
    expect(await pages()).toHaveLength(MAX_PAGES)
  })
})
