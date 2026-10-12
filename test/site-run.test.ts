import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderFiles, run } from "../scripts/site/render-site.mjs"
import { validSite } from "./support-site.js"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-site-"))
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "demo-pkg", version: "0.4.2", license: "MIT" }),
  )
  mkdirSync(path.join(dir, "docs"))
  writeFileSync(path.join(dir, "docs", "site.json"), JSON.stringify(validSite()))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}
const read = (name: string) => readFileSync(path.join(dir, "docs", name), "utf8")

describe("renderFiles", () => {
  it("returns the page, the brief and the two shared assets, formatted", async () => {
    const files = await renderFiles({
      site: validSite(),
      pkg: { name: "demo-pkg", version: "0.4.2", license: "MIT" },
      outDir: dir,
    })
    expect(files.map((f) => f.name)).toEqual([
      "index.html",
      "brief.html",
      "styles.css",
      "script.js",
    ])
    const index = files[0]!.text
    expect(index.startsWith("<!doctype html>")).toBe(true)
    expect(index.split("\n").length).toBeGreaterThan(50)
    expect(files[2]!.text).toContain("Landing page shared by every MaverickCER package")
  })
})

describe("run", () => {
  it("writes the four files into the output directory and says so", async () => {
    const r = io()
    expect(await run([], dir, r.io)).toBe(0)
    for (const name of ["index.html", "brief.html", "styles.css", "script.js"])
      expect(read(name).length).toBeGreaterThan(100)
    expect(r.out.join("")).toBe(
      "[site] wrote index.html, brief.html, styles.css, script.js to docs\n",
    )
  })
  it("is stable: a second run changes nothing, and --check agrees", async () => {
    await run([], dir, io().io)
    const first = read("index.html")
    await run([], dir, io().io)
    expect(read("index.html")).toBe(first)
    const r = io()
    expect(await run(["--check"], dir, r.io)).toBe(0)
    expect(r.out.join("")).toBe("[site] docs is up to date.\n")
  })
  it("--check fails, naming each stale file and the command that fixes it, and writes nothing", async () => {
    await run([], dir, io().io)
    writeFileSync(path.join(dir, "docs", "index.html"), "hand edited")
    rmSync(path.join(dir, "docs", "script.js"))
    const r = io()
    expect(await run(["--check"], dir, r.io)).toBe(1)
    expect(r.err.join("")).toBe(
      "[site] docs is stale: index.html, script.js. Run `npx internal-package-contract site` and commit the result.\n",
    )
    expect(read("index.html")).toBe("hand edited")
  })
  it("refuses invalid content, listing every problem, and writes nothing", async () => {
    const bad = validSite() as Record<string, unknown>
    delete bad["hero"]
    delete bad["brief"]
    writeFileSync(path.join(dir, "docs", "site.json"), JSON.stringify(bad))
    const r = io()
    expect(await run([], dir, r.io)).toBe(1)
    expect(r.err.join("")).toBe(
      "[site] docs/site.json does not meet the bar:\n- hero is required.\n- brief is required.\n",
    )
    expect(() => read("index.html")).toThrow()
  })
  it("says clearly when there is no content file, or it is not JSON", async () => {
    rmSync(path.join(dir, "docs", "site.json"))
    const r = io()
    expect(await run([], dir, r.io)).toBe(1)
    expect(r.err.join("")).toContain("docs/site.json not found")
    writeFileSync(path.join(dir, "docs", "site.json"), "{ nope")
    const r2 = io()
    expect(await run([], dir, r2.io)).toBe(1)
    expect(r2.err.join("")).toContain("docs/site.json is not valid JSON")
  })
  it("says clearly when package.json is missing or is not JSON, instead of crashing", async () => {
    const r = io()
    rmSync(path.join(dir, "package.json"))
    expect(await run([], dir, r.io)).toBe(1)
    expect(r.err.join("")).toBe("[site] package.json is missing or is not valid JSON.\n")
    writeFileSync(path.join(dir, "package.json"), "{ nope")
    const r2 = io()
    expect(await run([], dir, r2.io)).toBe(1)
    expect(r2.err.join("")).toBe("[site] package.json is missing or is not valid JSON.\n")
  })
  it("takes the content file and the output directory from flags", async () => {
    mkdirSync(path.join(dir, "site-src"))
    writeFileSync(path.join(dir, "site-src", "content.json"), JSON.stringify(validSite()))
    const r = io()
    expect(await run(["--content", "site-src/content.json", "--out", "public"], dir, r.io)).toBe(0)
    expect(readFileSync(path.join(dir, "public", "index.html"), "utf8").length).toBeGreaterThan(100)
    expect(r.out.join("")).toContain("to public")
  })
  it("rejects an unknown flag with the usage", async () => {
    const r = io()
    expect(await run(["--bogus"], dir, r.io)).toBe(1)
    expect(r.err.join("")).toContain("Usage: internal-package-contract site")
  })
})

describe("internal-package-contract site", () => {
  it("is reachable from the command line, with the same exit code and message", () => {
    const bin = path.resolve(import.meta.dirname, "../bin/contract.mjs")
    const ok = spawnSync(process.execPath, [bin, "site"], { cwd: dir, encoding: "utf8" })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toBe("[site] wrote index.html, brief.html, styles.css, script.js to docs\n")
    const stale = spawnSync(process.execPath, [bin, "site", "--bogus"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain("Usage: internal-package-contract site")
  })
})

describe("renderFiles -- the package's own Prettier settings", () => {
  it("formats the generated script with the consumer's configuration", async () => {
    // Prettier caches a directory's configuration, so each setting gets its own directory.
    const scriptWith = async (semi: boolean) => {
      const own = mkdtempSync(path.join(tmpdir(), "ipc-site-prettier-"))
      try {
        writeFileSync(path.join(own, ".prettierrc.json"), JSON.stringify({ semi }))
        const files = await renderFiles({
          site: validSite(),
          pkg: { name: "demo-pkg", version: "0.4.2" },
          outDir: own,
        })
        return files.find((file) => file.name === "script.js")?.text ?? ""
      } finally {
        rmSync(own, { recursive: true, force: true })
      }
    }
    expect(await scriptWith(false)).not.toMatch(/;\n/)
    expect(await scriptWith(true)).toMatch(/;\n/)
  })
})

describe("run -- flags", () => {
  it("takes the value after --content and --out, in either order", async () => {
    writeFileSync(path.join(dir, "elsewhere.json"), JSON.stringify(validSite()))
    const { out, io: sinks } = io()
    expect(await run(["--out", "site-out", "--content", "elsewhere.json"], dir, sinks)).toBe(0)
    expect(out.join("")).toBe(
      "[site] wrote index.html, brief.html, styles.css, script.js to site-out\n",
    )
  })
  it("rejects a flag with no value and an unknown flag with the usage line", async () => {
    const first = io()
    expect(await run(["--out"], dir, first.io)).toBe(1)
    expect(first.err.join("")).toContain("Usage: internal-package-contract site")
    const second = io()
    expect(await run(["--nope"], dir, second.io)).toBe(1)
    expect(second.err.join("")).toContain("Usage: internal-package-contract site")
  })
})
