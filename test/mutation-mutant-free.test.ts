import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mutantFreeFiles } from "../scripts/mutation/mutant-free.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-mutant-free-"))
  mkdirSync(path.join(root, "src"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const write = (file: string, text: string) => writeFileSync(path.join(root, file), text)

describe("mutantFreeFiles", () => {
  it("names the files Stryker would place no mutant in, in the order given, and leaves out those with mutants", async () => {
    write("src/types.ts", "export type Id = string\nexport interface Row {\n  id: Id\n}\n")
    write(
      "src/index.ts",
      'export { sum } from "./sum.js"\nexport type { Id, Row } from "./types.js"\n',
    )
    write("src/sum.ts", "export const sum = (a: number, b: number): number => a + b\n")
    write("src/flag.ts", "export const on = true\n")
    await expect(
      mutantFreeFiles(root, ["src/sum.ts", "src/types.ts", "src/flag.ts", "src/index.ts"]),
    ).resolves.toEqual(["src/types.ts", "src/index.ts"])
  })

  it("is empty for no files, without reading anything", async () => {
    await expect(mutantFreeFiles(path.join(root, "nowhere"), [])).resolves.toEqual([])
  })

  it("counts a mutant that a Stryker disable comment only ignores, since the report lists it", async () => {
    write(
      "src/sum.ts",
      "// Stryker disable all\nexport const sum = (a: number, b: number): number => a + b\n",
    )
    await expect(mutantFreeFiles(root, ["src/sum.ts"])).resolves.toEqual([])
  })

  it("rejects when a file is not there", async () => {
    await expect(mutantFreeFiles(root, ["src/missing.ts"])).rejects.toThrow(/missing\.ts/)
  })

  it("rejects when a file cannot be parsed, since nothing can be said about it", async () => {
    write("src/broken.ts", "export const = \n")
    await expect(mutantFreeFiles(root, ["src/broken.ts"])).rejects.toThrow()
  })
})
