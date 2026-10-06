import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  collectInventory,
  renderInventory,
  runInventory,
  summarizeRegistries,
} from "../scripts/exceptions-inventory.mjs"
import { COMPLETE_V2 } from "./support.js"

const NOW = new Date("2026-10-02T00:00:00Z")
const v2 = (over: Record<string, unknown> = {}) => ({
  version: 2,
  justification: "j",
  exceptionType: "accepted-risk",
  ...COMPLETE_V2,
  ...over,
})
const v1 = (over: Record<string, unknown> = {}) => ({
  version: 1,
  justification: "j",
  exceptionType: "validated-false-positive",
  ...over,
})

describe("summarizeRegistries()", () => {
  it("counts records by type, and flags legacy, expired and incomplete ones", () => {
    const summary = summarizeRegistries(
      [
        { name: "socket", records: [v2(), v2({ exceptionType: "tooling-limitation" }), v1()] },
        {
          name: "mutation",
          records: [
            v1({ exceptionType: undefined }),
            v2({ expires: "2026-01-01" }),
            v2({ revisitWhen: "" }),
          ],
        },
        { name: "empty", records: [] },
      ],
      NOW,
    )
    expect(summary.total).toBe(6)
    expect(summary.legacy).toBe(2)
    expect(summary.expired).toBe(1)
    expect(summary.incomplete).toBe(1)
    expect(summary.registries[0]).toEqual({
      name: "socket",
      total: 3,
      byType: { "accepted-risk": 1, "tooling-limitation": 1, "validated-false-positive": 1 },
      legacy: 1,
      expired: 0,
      incomplete: 0,
    })
    expect(summary.registries[1]?.byType).toEqual({ "(untyped)": 1, "accepted-risk": 2 })
  })

  it("treats a blank justification, a non-object record and a malformed expires as the cases they are", () => {
    const summary = summarizeRegistries(
      [
        {
          name: "r",
          records: [v2({ justification: " " }), "nonsense", v2({ expires: "soon" }), null],
        },
      ],
      NOW,
    )
    expect(summary.incomplete).toBe(3)
    expect(summary.expired).toBe(0)
    expect(summary.legacy).toBe(2)
  })

  it("defaults the clock", () => {
    expect(
      summarizeRegistries([{ name: "r", records: [v2({ expires: "2000-01-01" })] }]).expired,
    ).toBe(1)
  })
})

describe("collectInventory() / renderInventory() / runInventory()", () => {
  let cwd: string
  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "ipc-inventory-"))
  })
  afterEach(() => rmSync(cwd, { recursive: true, force: true }))

  const write = (name: string, body: string) => {
    mkdirSync(path.join(cwd, ".repo-contract/exceptions"), { recursive: true })
    writeFileSync(path.join(cwd, ".repo-contract/exceptions", name), body)
  }

  it("says nothing is being broken when there are no registries", () => {
    expect(renderInventory(collectInventory(cwd))).toContain("No exceptions recorded")
    write("notes.txt", "ignored")
    expect(collectInventory(cwd).total).toBe(0)
  })

  it("reads every registry in name order, and reports an unreadable one instead of throwing", () => {
    write("socket.json", JSON.stringify({ exceptions: [v2(), v1()] }))
    write("broken.json", "{ nope")
    write("shapeless.json", JSON.stringify({ other: [] }))
    const inventory = collectInventory(cwd, NOW)
    expect(inventory.registries.map((r) => r.name)).toEqual(["socket"])
    expect(inventory.errors?.map((e) => e.name)).toEqual(["broken", "shapeless"])
    const text = renderInventory(inventory)
    expect(text).toContain(
      "2 exception(s) across 1 registry (1 legacy version 1, 0 expired, 0 incomplete).",
    )
    expect(text).toContain("- socket: 2 (accepted-risk 1, validated-false-positive 1); 1 legacy")
    expect(text).toContain("- broken: UNREADABLE")
    expect(text).toContain('no "exceptions" array')
  })

  it("renders expired and incomplete counts, pluralising registries", () => {
    write(
      "a.json",
      JSON.stringify({ exceptions: [v2({ expires: "2020-01-01" }), v2({ constraint: "" })] }),
    )
    write("b.json", JSON.stringify({ exceptions: [] }))
    const text = renderInventory(collectInventory(cwd, NOW))
    expect(text).toContain("across 2 registries")
    expect(text).toContain("- a: 2 (accepted-risk 2); 1 expired; 1 incomplete")
    expect(text).toContain("- b: 0")
  })

  it("prints text by default and JSON on request", () => {
    write("a.json", JSON.stringify({ exceptions: [v2()] }))
    let out = ""
    runInventory([], cwd, { write: (t) => (out += t) })
    expect(out).toContain("1 exception(s)")
    out = ""
    runInventory(["--json"], cwd, { write: (t) => (out += t) })
    expect(JSON.parse(out).total).toBe(1)
  })
})
