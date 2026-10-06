import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { GUIDES, compareGuides, run, syncGuides } from "../scripts/benchmark-guides.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const scratch = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-guides-exact-"))
  roots.push(root)
  return root
}
const canonical = () => {
  const dir = scratch()
  for (const guide of GUIDES) writeFileSync(path.join(dir, guide), `canonical ${guide}\n`)
  return dir
}
const packageWith = (files: Record<string, string>) => {
  const cwd = scratch()
  mkdirSync(path.join(cwd, "benchmarks"))
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(cwd, "benchmarks", name), text)
  return cwd
}

describe("compareGuides() and syncGuides() against a canonical folder", () => {
  it("is inapplicable, and writes nothing, without a benchmarks folder", () => {
    const cwd = scratch()
    const source = canonical()
    expect(compareGuides(cwd, source)).toEqual({ applicable: false, missing: [], differing: [] })
    expect(syncGuides(cwd, source)).toEqual([])
    expect(() => readFileSync(path.join(cwd, "benchmarks", GUIDES[0]!))).toThrow()
  })

  it("lists missing guides, then differing ones, in guide order", () => {
    const source = canonical()
    const cwd = packageWith({ [GUIDES[0]!]: "stale" })
    expect(compareGuides(cwd, source)).toEqual({
      applicable: true,
      missing: [GUIDES[1]],
      differing: [GUIDES[0]],
    })
    expect(syncGuides(cwd, source)).toEqual([GUIDES[1], GUIDES[0]])
    for (const guide of GUIDES)
      expect(readFileSync(path.join(cwd, "benchmarks", guide), "utf8")).toBe(`canonical ${guide}\n`)
  })

  it("is satisfied by a copy that matches byte for byte, and not by one that differs in a single character", () => {
    const source = canonical()
    const same = packageWith(
      Object.fromEntries(GUIDES.map((guide) => [guide, `canonical ${guide}\n`])),
    )
    expect(compareGuides(same, source)).toEqual({ applicable: true, missing: [], differing: [] })
    expect(syncGuides(same, source)).toEqual([])
    const off = packageWith(
      Object.fromEntries(GUIDES.map((guide) => [guide, `canonical ${guide}`])),
    )
    expect(compareGuides(off, source).differing).toEqual([...GUIDES])
  })
})

describe("run()", () => {
  it("writes a JSON verdict by default", () => {
    const cwd = packageWith({})
    const written: string[] = []
    run([], cwd, (t) => written.push(t))
    expect(written).toEqual([JSON.stringify({ ok: true, ...compareGuides(cwd) })])
    expect(JSON.parse(written[0] ?? "")).toMatchObject({
      ok: true,
      applicable: true,
      missing: [...GUIDES],
      differing: [],
    })
    const none: string[] = []
    run(["--check"], scratch(), (t) => none.push(t))
    expect(JSON.parse(none[0] ?? "")).toEqual({
      ok: true,
      applicable: false,
      missing: [],
      differing: [],
    })
  })

  it("copies the canonical guides on --write, and says which, then that nothing is left to do", () => {
    const cwd = packageWith({ [GUIDES[0]!]: "stale" })
    const written: string[] = []
    run(["--write"], cwd, (t) => written.push(t))
    expect(written).toEqual([`Updated ${GUIDES[1]}, ${GUIDES[0]}.\n`])
    const again: string[] = []
    run(["--write"], cwd, (t) => again.push(t))
    expect(again).toEqual(["Benchmark guides are already identical to the canonical ones.\n"])
    const none: string[] = []
    run(["--write"], scratch(), (t) => none.push(t))
    expect(none).toEqual(["Benchmark guides are already identical to the canonical ones.\n"])
  })
})
