import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  expandMutate,
  loadStrykerConfig,
  mutateGlobsOf,
  shardMutation,
  shardSpecOf,
} from "../scripts/mutation/shard.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-shard-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const put = (file: string, bytes: number): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), "x".repeat(bytes))
}

describe("shardSpecOf", () => {
  it("reads the selector from IPC_MUTATION_SHARD", () => {
    expect(shardSpecOf({ IPC_MUTATION_SHARD: "2/5" })).toBe("2/5")
  })

  it("is undefined, not a string, when the variable is not set", () => {
    expect(shardSpecOf({})).toBeUndefined()
  })

  it("treats an absent, empty or blank variable as no sharding", () => {
    expect(shardSpecOf({})).toBeUndefined()
    expect(shardSpecOf({ IPC_MUTATION_SHARD: "" })).toBeUndefined()
    expect(shardSpecOf({ IPC_MUTATION_SHARD: "  " })).toBeUndefined()
  })

  it("trims the selector", () => {
    expect(shardSpecOf({ IPC_MUTATION_SHARD: " 1/3 " })).toBe("1/3")
  })
})

describe("mutateGlobsOf", () => {
  it("takes the patterns of a Stryker config", () => {
    expect(mutateGlobsOf({ mutate: ["src/**/*.ts", "!src/x.ts"] })).toEqual([
      "src/**/*.ts",
      "!src/x.ts",
    ])
  })

  it("falls back to every file under src when the config names none", () => {
    expect(mutateGlobsOf({})).toEqual(["src/**/*.ts"])
    expect(mutateGlobsOf(undefined)).toEqual(["src/**/*.ts"])
  })
})

describe("expandMutate", () => {
  it("lists the files the patterns match, sorted, relative to the package", () => {
    put("src/b.ts", 1)
    put("src/a.ts", 1)
    put("src/deep/c.ts", 1)
    put("test/t.ts", 1)
    expect(expandMutate(root, ["src/**/*.ts"])).toEqual(["src/a.ts", "src/b.ts", "src/deep/c.ts"])
  })

  it("removes what a later negated pattern matches, and only what it matches", () => {
    put("src/a.ts", 1)
    put("src/_ipc/m.ts", 1)
    put("src/b.test.ts", 1)
    expect(expandMutate(root, ["src/**/*.ts", "!src/_ipc/**", "!**/*.test.ts"])).toEqual([
      "src/a.ts",
    ])
  })

  it("lets a pattern after a negation add a file back", () => {
    put("src/a.ts", 1)
    put("src/b.ts", 1)
    expect(expandMutate(root, ["src/**/*.ts", "!src/**", "src/a.ts"])).toEqual(["src/a.ts"])
  })

  it("sorts the files whatever order the patterns added them in", () => {
    put("src/a.ts", 1)
    put("src/b.ts", 1)
    expect(expandMutate(root, ["src/b.ts", "src/a.ts"])).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("lists a file once however many patterns match it", () => {
    put("src/a.ts", 1)
    expect(expandMutate(root, ["src/**/*.ts", "src/a.ts"])).toEqual(["src/a.ts"])
  })

  it("lists nothing when nothing matches", () => {
    expect(expandMutate(root, ["src/**/*.ts"])).toEqual([])
  })

  it("does not list directories", () => {
    mkdirSync(path.join(root, "src", "dir.ts"), { recursive: true })
    put("src/a.ts", 1)
    expect(expandMutate(root, ["src/**"])).toEqual(["src/a.ts"])
  })
})

describe("shardMutation", () => {
  const sizes: Record<string, number> = {
    "src/big.ts": 100,
    "src/mid.ts": 60,
    "src/small.ts": 40,
    "src/tiny.ts": 1,
  }
  const files = Object.keys(sizes)
  const sizeOf = (file: string): number => sizes[file] as number

  it("gives each shard a disjoint part and together all the files", () => {
    const parts = [1, 2].map((index) =>
      shardMutation({ spec: `${String(index)}/2`, files, sizeOf }),
    )
    const lists = parts.map((part) => part.args[1]?.split(",") ?? [])
    expect([...lists[0]!, ...lists[1]!].sort()).toEqual([...files].sort())
    expect(lists[0]!.filter((file) => lists[1]!.includes(file))).toEqual([])
  })

  it("balances by size, heaviest first", () => {
    const first = shardMutation({ spec: "1/2", files, sizeOf })
    const second = shardMutation({ spec: "2/2", files, sizeOf })
    expect(first.args).toEqual(["--mutate", "src/big.ts,src/tiny.ts"])
    expect(second.args).toEqual(["--mutate", "src/mid.ts,src/small.ts"])
  })

  it("restricts the run to the shard and keys the restriction by the selector and the files", () => {
    const part = shardMutation({ spec: "1/2", files, sizeOf })
    expect(part).toEqual({
      skip: false,
      args: ["--mutate", "src/big.ts,src/tiny.ts"],
      key: "shard 1/2: src/big.ts,src/tiny.ts",
    })
  })

  it("runs every file as one shard of one", () => {
    const part = shardMutation({ spec: "1/1", files, sizeOf })
    expect(part.args[1]?.split(",").sort()).toEqual([...files].sort())
  })

  it("is the same plan every time", () => {
    expect(shardMutation({ spec: "2/3", files, sizeOf })).toEqual(
      shardMutation({ spec: "2/3", files: [...files].reverse(), sizeOf }),
    )
  })

  it("refuses a selector that is not i/n", () => {
    expect(() => shardMutation({ spec: "two", files, sizeOf })).toThrow(/IPC_MUTATION_SHARD/)
    expect(() => shardMutation({ spec: "0/2", files, sizeOf })).toThrow(/IPC_MUTATION_SHARD/)
    expect(() => shardMutation({ spec: "3/2", files, sizeOf })).toThrow(/IPC_MUTATION_SHARD/)
  })

  it("names the selector's problem, not only that there is one", () => {
    expect(() => shardMutation({ spec: "3/2", files, sizeOf })).toThrow(/3/)
  })

  it("refuses more shards than files, because an empty shard would have no report to merge", () => {
    expect(() => shardMutation({ spec: "1/5", files, sizeOf })).toThrow(/4 file/)
  })

  it("allows as many slices as there are files", () => {
    const parts = [1, 2, 3, 4].map((index) =>
      shardMutation({ spec: `${String(index)}/4`, files, sizeOf }),
    )
    expect(parts.map((part) => part.args[1]?.split(",").length)).toEqual([1, 1, 1, 1])
  })

  it("refuses a package with nothing to mutate", () => {
    expect(() => shardMutation({ spec: "1/1", files: [], sizeOf })).toThrow(/nothing to mutate/)
  })
})

describe("loadStrykerConfig", () => {
  const candidates = ["stryker.config.mjs", "stryker.config.json"]

  it("loads the package's own ES module config", async () => {
    put("stryker.config.mjs", 0)
    writeFileSync(
      path.join(root, "stryker.config.mjs"),
      'export default { mutate: ["src/a.ts"] }\n',
    )
    expect(await loadStrykerConfig(root, candidates, undefined)).toEqual({ mutate: ["src/a.ts"] })
  })

  it("loads a JSON config in a real Node process, where importing it would fail", () => {
    writeFileSync(path.join(root, "stryker.config.json"), '{ "mutate": ["src/j.ts"] }')
    const module = path.join(import.meta.dirname, "..", "scripts", "mutation", "shard.mjs")
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { loadStrykerConfig } from ${JSON.stringify(pathToFileURL(module).href)}
console.log(JSON.stringify(await loadStrykerConfig(${JSON.stringify(root)}, ["stryker.config.json"], undefined)))`,
      ],
      { encoding: "utf8" },
    )
    expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout)).toEqual({ mutate: ["src/j.ts"] })
  })

  it("prefers the first candidate that exists", async () => {
    writeFileSync(path.join(root, "stryker.config.mjs"), 'export default { mutate: ["m"] }\n')
    writeFileSync(path.join(root, "stryker.config.json"), '{ "mutate": ["j"] }')
    expect(await loadStrykerConfig(root, candidates, undefined)).toEqual({ mutate: ["m"] })
  })

  it("uses the fallback config when the package has none", async () => {
    const fallback = path.join(root, "bundled.mjs")
    writeFileSync(fallback, 'export default { mutate: ["src/**/*.ts"] }\n')
    expect(await loadStrykerConfig(root, candidates, fallback)).toEqual({
      mutate: ["src/**/*.ts"],
    })
  })

  it("has nothing to load when there is no config at all", async () => {
    expect(await loadStrykerConfig(root, candidates, undefined)).toBeUndefined()
  })

  it("reads a config module that exports the object by name instead of as the default", async () => {
    writeFileSync(path.join(root, "stryker.config.mjs"), 'export const mutate = ["src/n.ts"]\n')
    expect(await loadStrykerConfig(root, candidates, undefined)).toMatchObject({
      mutate: ["src/n.ts"],
    })
  })
})
