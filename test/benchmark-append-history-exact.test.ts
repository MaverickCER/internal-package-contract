import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  appendEntry,
  buildEntry,
  parseAppendArgs,
  run,
} from "../scripts/benchmark/append-history.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const scratch = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-append-exact-"))
  roots.push(root)
  return root
}

const resultsWith = (tiers: Record<string, unknown>, metadata: unknown = undefined) => ({
  ...(metadata === undefined ? {} : { metadata }),
  results: { group: { tiers } },
})
const completed = (medianMs: number, inputs?: Record<string, number>) => ({
  status: "completed",
  durationMs: { medianMs },
  ...(inputs ? { inputs } : {}),
})
const FULL_METADATA = {
  timing: { finishedAtUtc: "2026-01-01T00:00:00.000Z" },
  git: { gitCommit: "abc123" },
  environment: { nodeVersion: "v22.0.0", runner: "GitHub Actions" },
  versions: { suite: 1, pkg: "0.4.0" },
}

describe("parseAppendArgs()", () => {
  it("collects positional arguments, and the value after --commit and --pr", () => {
    expect(parseAppendArgs([])).toEqual({ positional: [] })
    expect(parseAppendArgs(["a.json", "b.json"])).toEqual({ positional: ["a.json", "b.json"] })
    expect(parseAppendArgs(["a", "--commit", "abc", "b", "--pr", "12"])).toEqual({
      positional: ["a", "b"],
      commit: "abc",
      pullRequest: 12,
    })
    expect(parseAppendArgs(["--commit", "abc"])).toEqual({ positional: [], commit: "abc" })
  })

  it("takes the value from the argument right after the flag, never one further on", () => {
    expect(parseAppendArgs(["--commit", "abc", "x"])).toEqual({ positional: ["x"], commit: "abc" })
    expect(parseAppendArgs(["--pr", "7", "x"])).toEqual({ positional: ["x"], pullRequest: 7 })
  })

  it("accepts only a positive integer pull request number, and swallows the value either way", () => {
    for (const bad of ["0", "-3", "1.5", "abc", "", "NaN"]) {
      expect(parseAppendArgs(["--pr", bad, "x"]), bad).toEqual({ positional: ["x"] })
    }
    expect(parseAppendArgs(["--pr"])).toEqual({ positional: [] })
    expect(parseAppendArgs(["--commit"])).toEqual({ positional: [], commit: undefined })
    expect(parseAppendArgs(["--pr", "1"]).pullRequest).toBe(1)
  })
})

describe("buildEntry()", () => {
  it("records the metadata, the versions verbatim and a compact measurement per tier", () => {
    const entry = buildEntry(
      resultsWith(
        { small: completed(5, { items: 10 }), big: completed(50, { items: 100, other: 5 }) },
        FULL_METADATA,
      ),
      {},
    )
    expect(entry).toEqual({
      timestamp: "2026-01-01T00:00:00.000Z",
      gitCommit: "abc123",
      nodeVersion: "v22.0.0",
      runner: "GitHub Actions",
      versions: { suite: 1, pkg: "0.4.0" },
      measurements: {
        group: {
          small: { medianMs: 5, inputs: { items: 10 }, unitsPerSecond: 2000 },
          big: { medianMs: 50, inputs: { items: 100, other: 5 }, unitsPerSecond: 2100 },
        },
      },
    })
    expect("pullRequest" in entry).toBe(false)
  })

  it("rounds throughput to two decimals", () => {
    const entry = buildEntry(resultsWith({ t: completed(3, { items: 10 }) }, FULL_METADATA), {})
    expect(entry["measurements"]).toEqual({
      group: { t: { medianMs: 3, inputs: { items: 10 }, unitsPerSecond: 3333.33 } },
    })
    const rounded = buildEntry(resultsWith({ t: completed(7, { items: 1 }) }, FULL_METADATA), {})
    expect(rounded["measurements"]).toEqual({
      group: { t: { medianMs: 7, inputs: { items: 1 }, unitsPerSecond: 142.86 } },
    })
  })

  it("leaves out inputs and throughput that cannot be derived", () => {
    const entry = buildEntry(
      resultsWith({
        noInputs: completed(5),
        zero: completed(0, { items: 10 }),
        textual: completed(5, { items: "x" as unknown as number }),
        empty: completed(5, {}),
      }),
      {},
    )
    expect(entry["measurements"]).toEqual({
      group: {
        noInputs: { medianMs: 5 },
        zero: { medianMs: 0, inputs: { items: 10 } },
        textual: { medianMs: 5, inputs: { items: "x" } },
        empty: { medianMs: 5, inputs: {} },
      },
    })
  })

  it("lets --commit override the commit the results carry, and records a pull request", () => {
    const results = resultsWith({ t: completed(5) }, FULL_METADATA)
    expect(buildEntry(results, { commit: "merge-sha", pullRequest: 9 })).toMatchObject({
      gitCommit: "merge-sha",
      pullRequest: 9,
    })
    expect(buildEntry(results, { commit: "", pullRequest: undefined })).toMatchObject({
      gitCommit: "",
    })
    expect(buildEntry(results, { pullRequest: 9 })).toMatchObject({
      gitCommit: "abc123",
      pullRequest: 9,
    })
  })

  it("tolerates results with no metadata, or only part of it", () => {
    const bare = buildEntry(resultsWith({ t: completed(5) }), {})
    expect(bare).toEqual({
      timestamp: undefined,
      gitCommit: undefined,
      nodeVersion: undefined,
      runner: undefined,
      versions: {},
      measurements: { group: { t: { medianMs: 5 } } },
    })
    for (const key of ["timing", "git", "environment", "versions"]) {
      const metadata = { ...FULL_METADATA } as Record<string, unknown>
      delete metadata[key]
      expect(() => buildEntry(resultsWith({ t: completed(5) }, metadata), {}), key).not.toThrow()
    }
    expect(
      buildEntry(resultsWith({ t: completed(5) }, { timing: {}, git: {}, environment: {} }), {}),
    ).toMatchObject({
      timestamp: undefined,
      gitCommit: undefined,
      nodeVersion: undefined,
      runner: undefined,
    })
  })
})

describe("appendEntry()", () => {
  it("adds the entry after the existing ones and stamps the newest schema", () => {
    const history = { historySchemaVersion: 1, entries: [{ id: 1 }], keep: "me" }
    expect(appendEntry(history, { id: 2 })).toEqual({
      historySchemaVersion: 2,
      entries: [{ id: 1 }, { id: 2 }],
      keep: "me",
    })
  })

  it("starts a list when the existing history has none, or not a list", () => {
    expect(appendEntry({}, { id: 1 })).toEqual({ historySchemaVersion: 2, entries: [{ id: 1 }] })
    expect(appendEntry({ entries: "nope" }, { id: 1 })).toEqual({
      historySchemaVersion: 2,
      entries: [{ id: 1 }],
    })
    expect(appendEntry({ entries: { 0: "x" } }, { id: 1 })).toEqual({
      historySchemaVersion: 2,
      entries: [{ id: 1 }],
    })
  })
})

describe("run()", () => {
  const capture = () => {
    const log: string[] = []
    const error: string[] = []
    return {
      log,
      error,
      io: { log: (t: string) => log.push(t), error: (t: string) => error.push(t) },
    }
  }
  const usage =
    "Usage: node append-history.mjs <results.json> <history.json> [--commit <sha>] [--pr <number>]"

  it("prints the usage and exits 1 unless given both paths", async () => {
    for (const argv of [[], ["only.json"], ["--commit", "abc"], ["--commit", "abc", "only.json"]]) {
      const out = capture()
      expect(await run(argv, out.io), argv.join(" ")).toBe(1)
      expect(out.error).toEqual([usage])
      expect(out.log).toEqual([])
    }
  })

  const setup = (history?: string) => {
    const dir = scratch()
    const resultsPath = path.join(dir, "results.json")
    writeFileSync(
      resultsPath,
      JSON.stringify(resultsWith({ t: completed(5, { items: 10 }) }, FULL_METADATA)),
    )
    const historyPath = path.join(dir, "nested", "deeper", "history.json")
    if (history !== undefined) {
      mkdirSync(path.dirname(historyPath), { recursive: true })
      writeFileSync(historyPath, history)
    }
    return { resultsPath, historyPath }
  }
  const read = (file: string) =>
    JSON.parse(readFileSync(file, "utf8")) as {
      historySchemaVersion: number
      entries: Record<string, unknown>[]
    }

  it("creates the history, and its folders, when there is none", async () => {
    const { resultsPath, historyPath } = setup()
    const out = capture()
    expect(await run([resultsPath, historyPath], out.io)).toBe(0)
    expect(out.log).toEqual([
      `[append-history] appended entry to ${historyPath} (1 total, schema v2)`,
    ])
    expect(out.error).toEqual([])
    const history = read(historyPath)
    expect(Object.keys(history).sort()).toEqual(["entries", "historySchemaVersion"])
    expect(history.historySchemaVersion).toBe(2)
    expect(history.entries).toHaveLength(1)
    expect(history.entries[0]).toMatchObject({
      gitCommit: "abc123",
      timestamp: "2026-01-01T00:00:00.000Z",
    })
    expect(readFileSync(historyPath, "utf8").endsWith("}\n")).toBe(true)
    expect(readFileSync(historyPath, "utf8")).toContain('\n  "historySchemaVersion": 2')
  })

  it("appends to an existing history, passing --commit and --pr through", async () => {
    const { resultsPath, historyPath } = setup(
      JSON.stringify({ historySchemaVersion: 1, entries: [{ old: true }] }),
    )
    const out = capture()
    expect(await run([resultsPath, historyPath, "--commit", "merge", "--pr", "4"], out.io)).toBe(0)
    expect(out.log).toEqual([
      `[append-history] appended entry to ${historyPath} (2 total, schema v2)`,
    ])
    const history = read(historyPath)
    expect(history.historySchemaVersion).toBe(2)
    expect(history.entries[0]).toEqual({ old: true })
    expect(history.entries[1]).toMatchObject({ gitCommit: "merge", pullRequest: 4 })
  })

  it("starts over when the existing history is not valid JSON", async () => {
    const { resultsPath, historyPath } = setup("{ not json")
    expect(await run([resultsPath, historyPath], capture().io)).toBe(0)
    expect(read(historyPath).entries).toHaveLength(1)
  })
})
