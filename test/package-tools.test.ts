import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as apiReport from "../scripts/package-tools/api-report.mjs"
import * as badges from "../scripts/package-tools/badges.mjs"
import * as cjs from "../scripts/package-tools/cjs-interop.mjs"
import * as isolation from "../scripts/package-tools/compiler-isolation.mjs"
import * as tools from "../scripts/package-tools/index.mjs"
import * as size from "../scripts/package-tools/size.mjs"

let dir: string
const put = (relative: string, text: string) => {
  mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true })
  writeFileSync(path.join(dir, relative), text)
}
const sink = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "package-tools-"))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("tool dispatcher", () => {
  it("lists the tools, with what each does, when none or an unknown one is named", async () => {
    for (const [argv, headline] of [
      [[], "[tool] name a tool. Available:\n"],
      [["nope"], "[tool] unknown tool: nope. Available:\n"],
      [["toString"], "[tool] unknown tool: toString. Available:\n"],
    ] as const) {
      const s = sink()
      expect(await tools.run(argv, dir, s.io)).toBe(2)
      const text = s.err.join("")
      expect(text.startsWith(headline)).toBe(true)
      expect(text).toContain(
        "  ambient              fail when the package reaches what it must be handed (needs the AmbientCapabilities settings)\n",
      )
      expect(text).toContain(
        "  size                 fail when an entry point is over its gzip budget (ci/size-budgets.mjs)\n",
      )
      expect(text).toContain(
        "  api-report           fail when docs/api-report/ is not what the code generates\n",
      )
      expect(text).toContain(
        "  badges               write the coverage and size badges, and beside each a file saying what the number is\n",
      )
      expect(text).toContain(
        "  cjs-interop          make require() of the ESLint plugin return the plugin\n",
      )
      expect(text).toContain(
        "  compiler-isolation   fail when a client entry can reach the bundled compiler\n",
      )
    }
  })
  it("runs the named tool from the package's root, passing the rest of the arguments", async () => {
    const s = sink()
    expect(await tools.run(["cjs-interop", "x.cjs"], dir, s.io)).toBe(1)
    expect(s.err.join("")).toContain("x.cjs does not exist")
    expect(Object.keys(tools.TOOLS)).toEqual([
      "ambient",
      "api-report",
      "badges",
      "cjs-interop",
      "compiler-isolation",
      "size",
    ])
  })
})

describe("size", () => {
  const budgets = (list: unknown) =>
    put("ci/size-budgets.mjs", `export default ${JSON.stringify(list)}\n`)
  it("passes within budget, aligns its columns, and writes the measurements on request", async () => {
    put("dist/a.js", "a".repeat(2000))
    put("dist/long-name.js", "b")
    budgets([
      { label: "a", file: "dist/a.js", maxGzipBytes: 1000 },
      { label: "longer", file: "dist/long-name.js", maxGzipBytes: 1000 },
    ])
    const s = sink()
    expect(await size.run(["--json", "out/deep/sizes.json"], dir, s.io)).toBe(0)
    const a = gzipSync("a".repeat(2000)).length
    const b = gzipSync("b").length
    expect(s.out.join("")).toBe(
      `[size] a      dist/a.js         gzip=${a}B (budget 1000B) OK\n[size] longer dist/long-name.js gzip=${b}B (budget 1000B) OK\n\n[size] All budgets met.\n`,
    )
    expect(s.err).toEqual([])
    const written = JSON.parse(readFileSync(path.join(dir, "out/deep/sizes.json"), "utf8"))
    expect(written.entries).toEqual([
      { label: "a", file: "dist/a.js", gzipBytes: a, maxGzipBytes: 1000 },
      { label: "longer", file: "dist/long-name.js", gzipBytes: b, maxGzipBytes: 1000 },
    ])
    expect(Number.isNaN(Date.parse(written.generatedAt))).toBe(false)
  })
  it("passes at the budget exactly", async () => {
    put("dist/a.js", "x")
    budgets([{ label: "a", file: "dist/a.js", maxGzipBytes: gzipSync("x").length }])
    const s = sink()
    expect(await size.run([], dir, s.io)).toBe(0)
    expect(s.out.join("")).toContain(") OK\n")
  })
  it("fails one byte over the budget", async () => {
    put("dist/a.js", "x")
    budgets([{ label: "a", file: "dist/a.js", maxGzipBytes: gzipSync("x").length - 1 }])
    const s = sink()
    expect(await size.run([], dir, s.io)).toBe(1)
    expect(s.out.join("")).toContain("OVER BUDGET")
    expect(s.err.join("")).toBe("\n[size] One or more entry points exceeded their gzip budget.\n")
  })
  it("fails for a built file that is missing, and still reports the others", async () => {
    put("dist/a.js", "x")
    budgets([
      { label: "gone", file: "dist/gone.js", maxGzipBytes: 9 },
      { label: "a", file: "dist/a.js", maxGzipBytes: 999 },
    ])
    const s = sink()
    expect(await size.run([], dir, s.io)).toBe(1)
    expect(s.err[0]).toBe("[size] dist/gone.js does not exist -- build the package first.\n")
    expect(s.out.join("")).toContain("dist/a.js")
  })
  it("says how to supply budgets when there are none or they are not a list", async () => {
    const s = sink()
    expect(await size.run([], dir, s.io)).toBe(1)
    expect(s.err.join("")).toBe(
      "[size] ci/size-budgets.mjs is missing: list each entry point's budget there.\n",
    )
    put("ci/size-budgets.mjs", "export default {}\n")
    const t = sink()
    expect(await size.run([], dir, t.io)).toBe(1)
    expect(t.err.join("")).toBe(
      "[size] ci/size-budgets.mjs must export a list of budgets as its default.\n",
    )
  })
  it("rejects --json without a path, and records an unbuilt entry as null", async () => {
    budgets([{ label: "a", file: "dist/a.js", maxGzipBytes: 9 }])
    const s = sink()
    expect(await size.run(["--json"], dir, s.io)).toBe(1)
    expect(s.err.join("")).toContain("[size] --json requires a file path.\n")
    expect(size.measure(dir, [{ label: "a", file: "dist/a.js", maxGzipBytes: 9 }])).toEqual([
      { label: "a", file: "dist/a.js", gzipBytes: null, maxGzipBytes: 9 },
    ])
    expect(size.BUDGETS_PATH).toBe("ci/size-budgets.mjs")
  })
})

describe("badges", () => {
  const coverage = (pcts: [number, number, number, number]) =>
    put(
      "coverage/coverage-summary.json",
      JSON.stringify({
        total: {
          lines: { pct: pcts[0], covered: 99, total: 100 },
          statements: { pct: pcts[1], covered: 197, total: 200 },
          functions: { pct: pcts[2], covered: 29, total: 30 },
          branches: { pct: pcts[3], covered: 48, total: 50 },
        },
      }),
    )
  const sizes = (entries: unknown) => put("coverage/size-summary.json", JSON.stringify({ entries }))
  const badge = (name: string) => JSON.parse(readFileSync(path.join(dir, "docs", name), "utf8"))
  it("colors coverage and size by their thresholds", () => {
    expect([100, 85, 84.9, 70, 69.9].map(badges.coverageColor)).toEqual([
      "brightgreen",
      "brightgreen",
      "yellow",
      "yellow",
      "red",
    ])
    expect(
      [
        [10, 10],
        [11, 10],
        [11.1, 10],
      ].map(([a, b]) => badges.sizeColor(a as number, b as number)),
    ).toEqual(["brightgreen", "yellow", "red"])
  })
  it("writes both badges, the coverage one from the lowest of the four metrics", () => {
    put("package.json", "{}")
    coverage([99, 98.76, 97, 96.04])
    sizes([{ label: "runtime", gzipBytes: 2048, maxGzipBytes: 4096 }])
    mkdirSync(path.join(dir, "docs"))
    const s = sink()
    expect(badges.run([], dir, s.io)).toBe(0)
    expect(s.out).toEqual([
      "[badges] wrote docs/coverage-badge.json and docs/coverage.json (96.0%)\n",
      "[badges] wrote docs/size-badge.json and docs/size.json (2.00 KB)\n",
    ])
    expect(badge("coverage-badge.json")).toEqual({
      schemaVersion: 1,
      label: "coverage",
      message: "96.0% (lowest of 4)",
      color: "brightgreen",
    })
    expect(badge("coverage.json")).toEqual({
      schemaVersion: 1,
      headline: {
        value: 96,
        statistic: "minimum",
        of: ["lines", "statements", "functions", "branches"],
        meaning:
          "The lowest of the four percentages below, not their average, so one weak measure is never hidden by three strong ones.",
      },
      metrics: {
        lines: {
          percent: 99,
          covered: 99,
          total: 100,
          meaning: "The share of source lines that ran at least once.",
        },
        statements: {
          percent: 98.76,
          covered: 197,
          total: 200,
          meaning: "The share of statements that ran at least once (a line can hold several).",
        },
        functions: {
          percent: 97,
          covered: 29,
          total: 30,
          meaning: "The share of functions that were called at least once.",
        },
        branches: {
          percent: 96.04,
          covered: 48,
          total: 50,
          meaning:
            "The share of decision outcomes that were taken: each side of an if, a ternary, a switch case or a logical operator.",
        },
      },
    })
    expect(badge("size-badge.json")).toEqual({
      schemaVersion: 1,
      label: "gzip size",
      message: "2.00 KB of 4.00 KB",
      color: "brightgreen",
    })
    expect(badge("size.json")).toEqual({
      schemaVersion: 1,
      headline: {
        value: 2,
        unit: "KB",
        statistic: "gzip size of one entry point",
        meaning:
          "The gzip-compressed size of the entry point's built file, which is what a consumer downloads; the budget is a hard limit the build checks.",
      },
      entry: { label: "runtime", gzipBytes: 2048, maxGzipBytes: 4096 },
    })
  })
  it("shows the entry the package names, else the first", () => {
    mkdirSync(path.join(dir, "docs"))
    coverage([90, 90, 90, 90])
    sizes([
      { label: "core", gzipBytes: 1024, maxGzipBytes: 2048 },
      { label: "runtime", gzipBytes: 4096, maxGzipBytes: 2048 },
    ])
    put(
      "package.json",
      JSON.stringify({ "internal-package-contract": { badges: { sizeEntry: "runtime" } } }),
    )
    expect(badges.run([], dir, sink().io)).toBe(0)
    expect(badge("size-badge.json")).toMatchObject({ message: "4.00 KB of 2.00 KB", color: "red" })
    put("package.json", "{}")
    expect(badges.run([], dir, sink().io)).toBe(0)
    expect(badge("size-badge.json")).toMatchObject({ message: "1.00 KB of 2.00 KB" })
    put("package.json", JSON.stringify({ "internal-package-contract": {} }))
    expect(badges.run([], dir, sink().io)).toBe(0)
    expect(badge("size-badge.json")).toMatchObject({ message: "1.00 KB of 2.00 KB" })
  })
  it("reads another coverage summary, and leaves the size out, when told to", () => {
    put("package.json", "{}")
    put(
      "elsewhere/summary.json",
      JSON.stringify({
        total: {
          lines: { pct: 90, covered: 9, total: 10 },
          statements: { pct: 80, covered: 8, total: 10 },
          functions: { pct: 70, covered: 7, total: 10 },
          branches: { pct: 60, covered: 6, total: 10 },
        },
      }),
    )
    mkdirSync(path.join(dir, "docs"))
    const s = sink()
    expect(badges.run(["--coverage", "elsewhere/summary.json", "--no-size"], dir, s.io)).toBe(0)
    expect(s.out).toEqual([
      "[badges] wrote docs/coverage-badge.json and docs/coverage.json (60.0%)\n",
    ])
    expect(badge("coverage-badge.json")).toMatchObject({
      message: "60.0% (lowest of 4)",
      color: "red",
    })
    expect(existsSync(path.join(dir, "docs", "size-badge.json"))).toBe(false)
    expect(existsSync(path.join(dir, "docs", "size.json"))).toBe(false)
  })
  it("names the summary it was told to read when that is missing", () => {
    put("package.json", "{}")
    mkdirSync(path.join(dir, "docs"))
    const s = sink()
    expect(badges.run(["--coverage", "nowhere.json", "--no-size"], dir, s.io)).toBe(1)
    expect(s.err).toEqual(["[badges] nowhere.json missing -- run the tests with coverage first.\n"])
  })
  it("refuses an argument it does not know, with the usage line", () => {
    const s = sink()
    expect(badges.run(["--nope"], dir, s.io)).toBe(2)
    expect(s.err).toEqual([
      "[badges] unknown argument: --nope\nUsage: badges [--coverage <file>] [--no-size]\n",
    ])
  })
  it("says the size alone when the entry has no budget", () => {
    put("package.json", "{}")
    coverage([90, 90, 90, 90])
    sizes([{ label: "runtime", gzipBytes: 1024 }])
    mkdirSync(path.join(dir, "docs"))
    expect(badges.run([], dir, sink().io)).toBe(0)
    expect(badge("size-badge.json").message).toBe("1.00 KB")
    expect(badge("size.json").entry).toEqual({ label: "runtime", gzipBytes: 1024 })
  })
  it("fails loudly for missing inputs, still writing what it can", () => {
    put("package.json", "{}")
    mkdirSync(path.join(dir, "docs"))
    const none = sink()
    expect(badges.run([], dir, none.io)).toBe(1)
    expect(none.err).toEqual([
      "[badges] coverage/coverage-summary.json missing -- run the tests with coverage first.\n",
      "[badges] size summary missing -- run `size --json coverage/size-summary.json` first.\n",
    ])
    coverage([90, 90, 90, 90])
    const noSize = sink()
    expect(badges.run([], dir, noSize.io)).toBe(1)
    expect(existsSync(path.join(dir, "docs/coverage-badge.json"))).toBe(true)
    sizes([{ label: "runtime", gzipBytes: null, maxGzipBytes: 1 }])
    const unbuilt = sink()
    expect(badges.run([], dir, unbuilt.io)).toBe(1)
    expect(unbuilt.err).toEqual([
      "[badges] the first entry is missing gzipBytes in size-summary.json.\n",
    ])
    put(
      "package.json",
      JSON.stringify({ "internal-package-contract": { badges: { sizeEntry: "x" } } }),
    )
    const named = sink()
    expect(badges.run([], dir, named.io)).toBe(1)
    expect(named.err[0]).toBe("[badges] x entry is missing gzipBytes in size-summary.json.\n")
    expect(existsSync(path.join(dir, "docs/size-badge.json"))).toBe(false)
  })
  it("exits non-zero when only the coverage input is missing but the size one is fine", () => {
    put("package.json", "{}")
    mkdirSync(path.join(dir, "docs"))
    sizes([{ label: "runtime", gzipBytes: 1, maxGzipBytes: 9 }])
    expect(badges.run([], dir, sink().io)).toBe(1)
    expect(existsSync(path.join(dir, "docs/size-badge.json"))).toBe(true)
  })
})

describe("cjs-interop", () => {
  const PATCH = "module.exports = Object.assign(exports.default, exports);"
  it("adds the interop line after the last export, before a source map comment", () => {
    expect(
      cjs.patchInterop("exports.default = p;\nexports.rule = r;\n//# sourceMappingURL=x.map\n"),
    ).toBe(`exports.default = p;\nexports.rule = r;\n${PATCH}\n//# sourceMappingURL=x.map\n`)
    expect(cjs.patchInterop("\n  exports.default = p;\n")).toBe(
      `\n  exports.default = p;\n${PATCH}\n`,
    )
    expect(cjs.patchInterop("\n  exports.default = p;\n//# sourceMappingURL=x.map")).toBe(
      `\n  exports.default = p;\n${PATCH}\n//# sourceMappingURL=x.map`,
    )
    expect(cjs.patchInterop("exports.default = p;  \n\n")).toBe(`exports.default = p;\n${PATCH}\n`)
  })
  it("leaves an already patched file alone, and has nothing to do without a default export", () => {
    const patched = `exports.default = p;\n${PATCH}\n`
    expect(cjs.patchInterop(patched)).toBe(patched)
    expect(cjs.patchInterop("exports.rule = r;\n")).toBeUndefined()
    expect(cjs.patchInterop("const exportsdefault = 1\n")).toBeUndefined()
    expect(cjs.patchInterop("exports.default=p;")).toBe(`exports.default=p;\n${PATCH}\n`)
  })
  it("patches the built plugin in place, or says why it cannot", () => {
    const s = sink()
    expect(cjs.run([], dir, s.io)).toBe(1)
    expect(s.err.join("")).toBe(
      "[cjs-interop] dist/eslint-plugin/index.cjs does not exist -- build the package first.\n",
    )
    put("dist/eslint-plugin/index.cjs", "exports.rule = r;\n")
    const t = sink()
    expect(cjs.run([], dir, t.io)).toBe(1)
    expect(t.err.join("")).toContain("has no default export")
    put("dist/eslint-plugin/index.cjs", "exports.default = p;\n")
    const u = sink()
    expect(cjs.run([], dir, u.io)).toBe(0)
    expect(u.out.join("")).toBe("[cjs-interop] patched dist/eslint-plugin/index.cjs\n")
    expect(readFileSync(path.join(dir, "dist/eslint-plugin/index.cjs"), "utf8")).toBe(
      `exports.default = p;\n${PATCH}\n`,
    )
  })
})

describe("api-report", () => {
  const generate = (files: Record<string, string>) => (_cwd: string, into: string) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(into, name)), { recursive: true })
      writeFileSync(path.join(into, name), text)
    }
  }
  it("lists files recursively, sorted, and nothing for a missing directory", () => {
    put("r/a-b.md", "")
    put("r/a/z.md", "")
    put("r/a/y.md", "")
    expect(apiReport.listFiles(path.join(dir, "r"))).toEqual([
      "a-b.md",
      path.join("a", "y.md"),
      path.join("a", "z.md"),
    ])
    expect(apiReport.listFiles(path.join(dir, "missing"))).toEqual([])
  })
  it("is current when the regenerated report is the committed one", () => {
    put("docs/api-report/a.md", "same")
    put("docs/api-report/sub/b.md", "same")
    const s = sink()
    const code = apiReport.run([], dir, s.io, {
      generate: generate({ "a.md": "same", "sub/b.md": "same" }),
    })
    expect(code).toBe(0)
    expect(s.out.join("")).toBe("API report is current (2 file(s)).\n")
    expect(s.err).toEqual([])
  })
  it("names what was added, removed and changed", () => {
    put("docs/api-report/gone.md", "x")
    put("docs/api-report/kept.md", "old")
    put("docs/api-report/same.md", "s")
    const s = sink()
    const code = apiReport.run([], dir, s.io, {
      generate: generate({ "new.md": "n", "kept.md": "new", "same.md": "s" }),
    })
    expect(code).toBe(1)
    expect(s.err.join("")).toBe(
      "\nAPI report drift: the committed report is out of date\nRun `npm run docs:api:report` and commit docs/api-report/.\n  new:     new.md\n  removed: gone.md\n  changed: kept.md\n",
    )
    expect(
      apiReport.compareReports(
        path.join(dir, "docs/api-report"),
        path.join(dir, "docs/api-report"),
      ),
    ).toMatchObject({ added: [], removed: [], changed: [] })
  })
  it("reports only the kinds of drift there is, and a report that was never committed", () => {
    put("docs/api-report/a.md", "x")
    const added = sink()
    expect(
      apiReport.run([], dir, added.io, { generate: generate({ "a.md": "x", "b.md": "y" }) }),
    ).toBe(1)
    expect(added.err.join("")).toContain("  new:     b.md\n")
    const several = sink()
    expect(
      apiReport.run([], dir, several.io, {
        generate: generate({ "a.md": "x", "b.md": "1", "c.md": "2" }),
      }),
    ).toBe(1)
    expect(several.err.join("")).toContain("  new:     b.md, c.md\n")
    expect(added.err.join("")).not.toContain("removed")
    expect(added.err.join("")).not.toContain("changed")
    const removed = sink()
    expect(apiReport.run([], dir, removed.io, { generate: generate({}) })).toBe(1)
    expect(removed.err.join("")).toContain("  removed: a.md\n")
    expect(removed.err.join("")).not.toContain("new:")
    rmSync(path.join(dir, "docs"), { recursive: true })
    const none = sink()
    expect(apiReport.run([], dir, none.io, { generate: generate({ "a.md": "x" }) })).toBe(1)
    expect(none.err.join("")).toBe(
      "\nAPI report drift: docs/api-report/ is not committed yet\nRun `npm run docs:api:report` and commit docs/api-report/.\n",
    )
  })
  it("lists several files of one kind of drift on one line, and copes with the report removing itself", () => {
    put("docs/api-report/a.md", "x")
    const s = sink()
    const code = apiReport.run([], dir, s.io, {
      generate: (_cwd: string, into: string) => {
        generate({ "a.md": "x", "b.md": "1", "c.md": "2" })(_cwd, into)
        rmSync(into, { recursive: true })
      },
    })
    expect(code).toBe(1)
  })
  it("regenerates the report with typedoc, from the package's root", () => {
    const calls: unknown[][] = []
    apiReport.generateReport("/root", "/into", (...args: unknown[]) => calls.push(args))
    expect(calls).toEqual([
      [
        "npx",
        ["typedoc", "--options", "typedoc.markdown.json", "--out", "/into"],
        { cwd: "/root", stdio: ["ignore", "ignore", "inherit"] },
      ],
    ])
  })
  it("regenerates into a temporary directory named for the tool, then removes it", () => {
    let used = ""
    apiReport.run([], dir, sink().io, {
      generate: (_cwd: string, into: string) => {
        used = into
      },
    })
    expect(path.basename(used).startsWith("api-report-")).toBe(true)
    expect(existsSync(used)).toBe(false)
  })
  it("removes the temporary report even when generating fails", () => {
    let used = ""
    expect(() =>
      apiReport.run([], dir, sink().io, {
        generate: (_cwd: string, into: string) => {
          used = into
          throw new Error("typedoc failed")
        },
      }),
    ).toThrow("typedoc failed")
    expect(existsSync(used)).toBe(false)
  })
})

describe("compiler-isolation", () => {
  const manifest = (extra: object = {}) =>
    put(
      "package.json",
      JSON.stringify({
        bin: "dist/cli.js",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            require: "./dist/index.cjs",
          },
          "./build": "./dist/build.js",
          "./eslint-plugin": "./dist/plugin.js",
          "./package.json": "./package.json",
          "./schema.json": "./schema.json",
        },
        ...extra,
      }),
    )
  const built = (files: Record<string, string>) => {
    manifest()
    const base = {
      "dist/index.js": "export const a = 1\n",
      "dist/index.cjs": "exports.a = 1\n",
      "dist/build.js": 'import "@typescript/typescript6"\n',
      "dist/plugin.js": "export const p = 1\n",
      "dist/cli.js": "console.log(1)\n",
    }
    for (const [name, text] of Object.entries({ ...base, ...files })) put(name, text)
  }
  const result = () => {
    const s = sink()
    return { code: isolation.run([], dir, s.io), out: s.out.join(""), err: s.err.join("") }
  }
  it("passes when only the build entry reaches the compiler", () => {
    built({})
    expect(result()).toEqual({
      code: 0,
      out: "compiler-isolation: OK -- 3 client entry file(s) cannot reach the bundled compiler; the build entry does\n",
      err: "",
    })
  })
  it("fails a client entry that reaches the compiler, directly or through a chunk", () => {
    built({
      "dist/index.js": 'import "./chunk.js"\n',
      "dist/chunk.js": 'import { createRequire } from "node:module"\n',
    })
    const { code, err } = result()
    expect(code).toBe(1)
    expect(err).toContain(
      '. (dist/index.js) can reach "node:module" via dist/chunk.js -- the compiler may only be used by the build entry',
    )
    expect(err.startsWith("compiler-isolation: FAIL\n  ")).toBe(true)
    built({ "dist/index.js": 'const t = require("@typescript/old")\n' })
    expect(result().err).toContain('can reach "@typescript/old"')
  })
  it("fails a client entry that imports typescript, except the ESLint plugin", () => {
    built({ "dist/index.js": 'import ts from "typescript"\n' })
    expect(result().err).toContain(
      '. (dist/index.js) imports "typescript" -- only the build entry may',
    )
    built({ "dist/plugin.js": 'import ts from "typescript"\n' })
    expect(result().code).toBe(0)
  })
  it("fails when the build entry no longer reaches the compiler, since nothing would be proven", () => {
    built({ "dist/build.js": "export const b = 1\n" })
    expect(result().err).toContain("the ./build entry never reaches @typescript/typescript6")
    built({
      "dist/build.js": 'import "./loader.js"\n',
      "dist/loader.js": 'const c = "@typescript/typescript6"\n',
    })
    expect(result().code).toBe(0)
  })
  it("names built files that are missing", () => {
    manifest()
    const { code, err } = result()
    expect(code).toBe(1)
    expect(err).toContain("./build: dist/build.js is missing -- build the package first")
    expect(err).toContain("bin: dist/cli.js is missing")
    expect(err).toContain("  .: dist/index.js is missing")
  })
  it("follows relative imports only when they exist, and every import form", () => {
    expect(isolation.specifiers('import a from "x"')).toEqual(["x"])
    expect(isolation.specifiers("import a from'xx'")).toEqual(["xx"])
    expect(isolation.specifiers('import  "y"')).toEqual(["y"])
    expect(isolation.specifiers("import'yy'")).toEqual(["yy"])
    expect(isolation.specifiers('require("z")')).toEqual(["z"])
    expect(isolation.specifiers("require(  'zz'  )")).toEqual(["zz"])
    expect(isolation.specifiers('import("w")')).toEqual([])
    built({
      "dist/index.js": 'import "./missing.js"\nexport * from "./sub/inner.js"\n',
      "dist/sub/inner.js": "export const i = 1\n",
    })
    const { files, external } = isolation.closure(path.join(dir, "dist/index.js"))
    expect(
      [...files.keys()].map((f: string) => path.relative(dir, f).split(path.sep).join("/")).sort(),
    ).toEqual(["dist/index.js", "dist/sub/inner.js"])
    expect([...external]).toEqual([])
  })
  it("reads exports in every shape, skipping type declarations", () => {
    expect(isolation.entryFiles("./a.js")).toEqual(["./a.js"])
    expect(isolation.entryFiles("./a.d.ts")).toEqual([])
    expect(isolation.entryFiles("./a.js.map")).toEqual([])
    expect(isolation.entryFiles("./a.mjs")).toEqual(["./a.mjs"])
    expect(isolation.entryFiles("./a.cjs")).toEqual(["./a.cjs"])
    expect(isolation.entryFiles(null)).toEqual([])
    expect(isolation.entryFiles(5)).toEqual([])
    expect(
      isolation.entryFiles({
        "types@>=5": "./t.js",
        types: "./u.js",
        import: "./a.mjs",
        require: { default: "./b.cjs" },
      }),
    ).toEqual(["./a.mjs", "./b.cjs"])
    expect(isolation.COMPILER_MARKERS).toEqual([
      "@typescript/typescript6",
      "@typescript/old",
      "node:module",
    ])
  })
  it("does not check the schema entries, which are data", () => {
    built({})
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
    pkg.exports["./schema/x"] = "./dist/schema.js"
    put("package.json", JSON.stringify(pkg))
    expect(result().code).toBe(0)
  })
  it("counts only the ./build entry as reaching the compiler, and any one of its files", () => {
    built({
      "dist/build.js": "export const b = 1\n",
      "dist/cli.js": 'import "@typescript/typescript6"\n',
    })
    expect(result().err).toContain("the ./build entry never reaches")
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
    pkg.exports["./build"] = { import: "./dist/build.js", require: "./dist/build.cjs" }
    put("package.json", JSON.stringify(pkg))
    put("dist/build.cjs", 'require("@typescript/typescript6")\n')
    expect(result().code).toBe(0)
  })
  it("terminates on import cycles", () => {
    built({ "dist/index.js": 'import "./b.js"\n', "dist/b.js": 'import "./index.js"\n' })
    const { files } = isolation.closure(path.join(dir, "dist/index.js"))
    expect(files.size).toBe(2)
  })
  it("accepts a bin map, and a package with no bin", () => {
    built({})
    manifest({ bin: { one: "dist/cli.js", two: "dist/cli.js" } })
    expect(result().code).toBe(0)
    manifest({ bin: undefined })
    expect(result().code).toBe(0)
  })
})
