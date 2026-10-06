import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  REGISTRY_DIR,
  collectInventory,
  renderInventory,
  runInventory,
  summarizeRegistries,
} from "../scripts/exceptions-inventory.mjs"
import { COMPLETE_V2 } from "./support.js"

const NOW = new Date("2026-10-02T12:00:00Z")
const v2 = (over: Record<string, unknown> = {}) => ({
  version: 2,
  justification: "j",
  exceptionType: "accepted-risk",
  ...COMPLETE_V2,
  ...over,
})
const only = (records: unknown[]) =>
  summarizeRegistries([{ name: "r", records }], NOW).registries[0]!

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const repoWith = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-inventory-"))
  roots.push(root)
  mkdirSync(path.join(root, REGISTRY_DIR), { recursive: true })
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(root, REGISTRY_DIR, name), text)
  return root
}

describe("summarizeRegistries() record by record", () => {
  it("counts anything that is not an object as an empty, legacy, untyped, incomplete record", () => {
    for (const record of [null, undefined, 3, "x", true]) {
      expect(only([record]), String(record)).toMatchObject({
        total: 1,
        byType: { "(untyped)": 1 },
        legacy: 1,
        expired: 0,
        incomplete: 1,
      })
    }
  })

  it("takes the exception type only from a non-empty string", () => {
    expect(only([v2({ exceptionType: "" })]).byType).toEqual({ "(untyped)": 1 })
    expect(only([v2({ exceptionType: 5 })]).byType).toEqual({ "(untyped)": 1 })
    expect(only([v2({ exceptionType: undefined })]).byType).toEqual({ "(untyped)": 1 })
    expect(only([v2({ exceptionType: "x" })]).byType).toEqual({ x: 1 })
  })

  it("calls a record expired only when its date is a real, earlier day", () => {
    const expired = (expires: unknown) => only([v2({ expires })]).expired
    expect(expired("2026-10-01")).toBe(1)
    expect(expired("2020-01-01")).toBe(1)
    expect(expired("2026-10-02")).toBe(0)
    expect(expired("2026-10-03")).toBe(0)
    expect(expired("2027-01-01")).toBe(0)
    for (const bad of [
      "",
      "2026-1-01",
      "2026-01-01x",
      "x2026-01-01",
      "!2020-01-01",
      ["2020-01-01"],
      "2026-01-01T00:00:00Z",
      "tomorrow",
      20260101,
      null,
      undefined,
    ])
      expect(expired(bad), String(bad)).toBe(0)
  })

  it("calls a record incomplete when it has no justification, or (in version 2) lacks any of its fields", () => {
    expect(only([v2()]).incomplete).toBe(0)
    expect(only([v2({ justification: "" })]).incomplete).toBe(1)
    expect(only([v2({ justification: "  " })]).incomplete).toBe(1)
    expect(only([v2({ justification: 5 })]).incomplete).toBe(1)
    for (const key of [
      "ruleBroken",
      "attempted",
      "constraint",
      "whyPreferable",
      "residualRisk",
      "revisitWhen",
    ]) {
      expect(only([v2({ [key]: "" })]).incomplete, key).toBe(1)
      expect(only([v2({ [key]: undefined })]).incomplete, key).toBe(1)
    }
    expect(only([{ version: 1, justification: "j" }]).incomplete).toBe(0)
    expect(only([{ version: 1, justification: "" }]).incomplete).toBe(1)
    expect(only([{ version: 3, justification: "j" }]).legacy).toBe(1)
  })

  it("totals across registries", () => {
    const summary = summarizeRegistries(
      [
        { name: "a", records: [v2({ expires: "2020-01-01" }), { version: 1, justification: "" }] },
        { name: "b", records: [v2({ expires: "2020-01-01" })] },
      ],
      NOW,
    )
    expect(summary).toMatchObject({ total: 3, legacy: 1, expired: 2, incomplete: 1 })
  })
})

describe("collectInventory()", () => {
  it("is empty when the folder is missing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-inventory-none-"))
    roots.push(root)
    expect(collectInventory(root, NOW)).toEqual({
      registries: [],
      total: 0,
      legacy: 0,
      expired: 0,
      incomplete: 0,
    })
  })

  it("reads every .json file in name order, naming each without its extension, and ignores the rest", () => {
    const root = repoWith({
      "zeta.json": JSON.stringify({ exceptions: [v2()] }),
      "alpha.json": JSON.stringify({ exceptions: [] }),
      "my.jsonfile.json": JSON.stringify({ exceptions: [v2(), v2()] }),
      "notes.txt": "x",
      "data.json.bak": "{}",
      "README.md": "x",
    })
    const inventory = collectInventory(root, NOW)
    expect(inventory.registries.map((r) => [r.name, r.total])).toEqual([
      ["alpha", 0],
      ["my.jsonfile", 2],
      ["zeta", 1],
    ])
    expect(inventory.errors).toEqual([])
  })

  it("reports a file that is not JSON, or has no exceptions list, as an error row", () => {
    const root = repoWith({
      "a.json": "{ nope",
      "b.json": "null",
      "c.json": JSON.stringify({ exceptions: "x" }),
      "d.json": JSON.stringify({}),
      "e.json": "[]",
      "f.json": JSON.stringify({ exceptions: [] }),
    })
    const inventory = collectInventory(root, NOW)
    expect(inventory.registries.map((r) => r.name)).toEqual(["f"])
    expect(inventory.errors).toHaveLength(5)
    expect(inventory.errors?.[0]?.name).toBe("a")
    expect(inventory.errors?.[0]?.error).toMatch(/JSON/)
    for (const failure of inventory.errors?.slice(1) ?? [])
      expect(failure.error).toBe('no "exceptions" array')
    expect(inventory.errors?.map((e) => e.name)).toEqual(["a", "b", "c", "d", "e"])
  })
})

describe("renderInventory()", () => {
  const registry = (extra: Record<string, unknown>) => ({
    name: "r",
    total: 1,
    byType: { x: 1 },
    legacy: 0,
    expired: 0,
    incomplete: 0,
    ...extra,
  })
  const inventory = (registries: object[], extra: Record<string, unknown> = {}) => ({
    registries,
    total: registries.length,
    legacy: 0,
    expired: 0,
    incomplete: 0,
    ...extra,
  })

  it("says nothing is broken on purpose when there is nothing", () => {
    const message =
      "No exceptions recorded: nothing in this repository is breaking a rule on purpose.\n"
    expect(renderInventory(inventory([]) as never)).toBe(message)
    expect(renderInventory({ ...inventory([]), errors: [] } as never)).toBe(message)
  })

  it("renders a header, a line per registry with types most common first, and the flags only when non-zero", () => {
    const text = renderInventory(
      inventory(
        [
          registry({
            name: "socket",
            total: 6,
            byType: { b: 2, a: 2, c: 3, d: 1 },
            legacy: 1,
            expired: 2,
            incomplete: 3,
          }),
          registry({ name: "mutation", total: 1, byType: { x: 1 } }),
          registry({ name: "empty", total: 0, byType: {} }),
        ],
        { total: 7, legacy: 1, expired: 2, incomplete: 3 },
      ) as never,
    )
    expect(text).toBe(
      [
        "7 exception(s) across 3 registries (1 legacy version 1, 2 expired, 3 incomplete).",
        "",
        "- socket: 6 (c 3, a 2, b 2, d 1); 1 legacy; 2 expired; 3 incomplete",
        "- mutation: 1 (x 1)",
        "- empty: 0",
        "",
      ].join("\n"),
    )
  })

  it("says registry for exactly one, registries otherwise", () => {
    expect(renderInventory(inventory([registry({})], { total: 1 }) as never).split("\n")[0]).toBe(
      "1 exception(s) across 1 registry (0 legacy version 1, 0 expired, 0 incomplete).",
    )
    expect(
      renderInventory(
        inventory([registry({}), registry({ name: "s" })], { total: 2 }) as never,
      ).split("\n")[0],
    ).toContain("across 2 registries")
  })

  it("lists unreadable registries after the others, and still renders when they are all there is", () => {
    const errors = [{ name: "bad", error: "boom" }]
    expect(renderInventory({ ...inventory([registry({})]), errors } as never)).toBe(
      [
        "1 exception(s) across 1 registry (0 legacy version 1, 0 expired, 0 incomplete).",
        "",
        "- r: 1 (x 1)",
        "- bad: UNREADABLE -- boom",
        "",
      ].join("\n"),
    )
    expect(renderInventory({ ...inventory([]), errors } as never)).toBe(
      [
        "0 exception(s) across 0 registries (0 legacy version 1, 0 expired, 0 incomplete).",
        "",
        "- bad: UNREADABLE -- boom",
        "",
      ].join("\n"),
    )
  })
})

describe("runInventory()", () => {
  it("writes the readable text, or JSON with --json, for the repository it is given", () => {
    const root = repoWith({ "a.json": JSON.stringify({ exceptions: [v2()] }) })
    const written: string[] = []
    const out = { write: (text: string) => written.push(text) }
    runInventory([], root, out)
    expect(written[0]).toBe(renderInventory(collectInventory(root)))
    expect(written[0]).toContain("1 exception(s) across 1 registry")
    runInventory(["--json"], root, out)
    expect(JSON.parse(written[1] ?? "")).toMatchObject({
      total: 1,
      registries: [{ name: "a" }],
      errors: [],
    })
    expect(written[1]?.endsWith("}\n")).toBe(true)
    expect(written[1]).toContain('\n  "total": 1')
    runInventory(["--other"], root, out)
    expect(written[2]).toBe(written[0])
  })
})
