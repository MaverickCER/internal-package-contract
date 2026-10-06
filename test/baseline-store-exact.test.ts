import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  readBaseline,
  readPackageJson,
  readSchemaVersion,
  sha256,
  writeBaselineFiles,
} from "../scripts/api-contract/baseline-store.js"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const scratch = (git: boolean) => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-baseline-exact-"))
  roots.push(root)
  if (git) {
    for (const args of [
      ["init", "-q", "-b", "main"],
      ["config", "user.email", "t@example.com"],
      ["config", "user.name", "t"],
    ])
      execFileSync("git", args, { cwd: root, stdio: "ignore" })
  }
  return root
}
const commit = (root: string) => {
  execFileSync("git", ["add", "-A"], { cwd: root, stdio: "ignore" })
  execFileSync("git", ["commit", "-q", "-m", "x"], { cwd: root, stdio: "ignore" })
}
const dirOf = (root: string) => path.join(root, ".repo-contract/api-contract/index")
const input = {
  apiJsonText: '{"metadata":{"schemaVersion":1011}}\n',
  dtsText: "export declare const x: number;\n",
  packageName: "fx",
  packageVersion: "1.2.3",
  apiExtractorVersion: "7.0.0",
  apiJsonSchemaVersion: 1011,
}
const metaOf = (root: string) =>
  JSON.parse(readFileSync(path.join(dirOf(root), "baseline.meta.json"), "utf8")) as Record<
    string,
    unknown
  >
const writeMeta = (root: string, meta: unknown) =>
  writeFileSync(path.join(dirOf(root), "baseline.meta.json"), JSON.stringify(meta))

describe("sha256()", () => {
  it("hashes content, treating CRLF and LF alike", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(sha256("a\r\nb")).toBe(sha256("a\nb"))
    expect(sha256("a\rb")).not.toBe(sha256("a\nb"))
  })
})

describe("readSchemaVersion()", () => {
  it("reads metadata.schemaVersion, or 0 when it is not there", () => {
    expect(readSchemaVersion('{"metadata":{"schemaVersion":1011}}')).toBe(1011)
    expect(readSchemaVersion('{"metadata":{}}')).toBe(0)
    expect(readSchemaVersion("{}")).toBe(0)
  })

  it("refuses text that is not JSON, saying how to recover", () => {
    expect(() => readSchemaVersion("{ not json")).toThrow(
      "The API Extractor JSON report is not valid JSON (a truncated or interrupted write?). Regenerate it with `npm run build` and re-run the check.",
    )
  })
})

describe("readPackageJson()", () => {
  it("returns the parsed package.json", async () => {
    const root = scratch(false)
    writeFileSync(path.join(root, "package.json"), '{"name":"fx","version":"1.0.0"}')
    expect(await readPackageJson(root)).toEqual({ name: "fx", version: "1.0.0" })
  })

  it("names the file when it is not valid JSON", async () => {
    const root = scratch(false)
    writeFileSync(path.join(root, "package.json"), "{ nope")
    await expect(readPackageJson(root)).rejects.toThrow(
      `${path.join(root, "package.json")} is not valid JSON -- fix it before running the api-contract check.`,
    )
  })
})

describe("writeBaselineFiles()", () => {
  it("writes the three baseline files, hashed, and leaves no scratch file behind", async () => {
    const root = scratch(false)
    await writeBaselineFiles(root, "index", input)
    expect(readdirSync(dirOf(root)).sort()).toEqual([
      "baseline.api.json",
      "baseline.d.ts",
      "baseline.meta.json",
    ])
    expect(readFileSync(path.join(dirOf(root), "baseline.api.json"), "utf8")).toBe(
      input.apiJsonText,
    )
    expect(readFileSync(path.join(dirOf(root), "baseline.d.ts"), "utf8")).toBe(input.dtsText)
    const metaText = readFileSync(path.join(dirOf(root), "baseline.meta.json"), "utf8")
    expect(metaText.endsWith("}\n")).toBe(true)
    expect(metaText).toContain('\n  "packageName": "fx"')
    const meta = metaOf(root)
    expect(meta).toEqual({
      packageName: "fx",
      packageVersion: "1.2.3",
      apiExtractorVersion: "7.0.0",
      apiJsonSchemaVersion: 1011,
      apiJsonHash: sha256(input.apiJsonText),
      dtsHash: sha256(input.dtsText),
      generatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) as unknown,
    })
  })

  it("replaces an existing baseline in place", async () => {
    const root = scratch(false)
    await writeBaselineFiles(root, "index", input)
    await writeBaselineFiles(root, "index", { ...input, dtsText: "export {}\n" })
    expect(readFileSync(path.join(dirOf(root), "baseline.d.ts"), "utf8")).toBe("export {}\n")
    expect(readdirSync(dirOf(root))).toHaveLength(3)
  })
})

describe("readBaseline()", () => {
  it("refuses a folder that is not in a git working tree", async () => {
    const root = scratch(false)
    const error = await readBaseline(root, "index").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      `"${root}" is not inside a git working tree -- the committed baseline can only be read from git, and this check refuses to fall back to an untrusted working-tree copy.`,
    )
    expect((error as Error).cause).toBeInstanceOf(Error)
  })

  it("is undefined when nothing is committed: no commits yet, or none for this target", async () => {
    const root = scratch(true)
    expect(await readBaseline(root, "index")).toBeUndefined()
    writeFileSync(path.join(root, "a.txt"), "a")
    commit(root)
    expect(await readBaseline(root, "index")).toBeUndefined()
  })

  it("reads what was committed, never the working tree", async () => {
    const root = scratch(true)
    await writeBaselineFiles(root, "index", input)
    commit(root)
    await writeBaselineFiles(root, "index", {
      ...input,
      dtsText: "export declare const y: string;\n",
    })
    const baseline = await readBaseline(root, "index")
    expect(baseline).toEqual({
      apiJsonText: input.apiJsonText,
      dtsText: input.dtsText,
      meta: expect.objectContaining({ packageName: "fx", packageVersion: "1.2.3" }) as unknown,
    })
    expect(baseline?.meta.apiJsonHash).toBe(sha256(input.apiJsonText))
  })

  it("keeps targets apart", async () => {
    const root = scratch(true)
    await writeBaselineFiles(root, "index", input)
    commit(root)
    expect(await readBaseline(root, "other")).toBeUndefined()
  })

  const corrupt = async (edit: (root: string) => void) => {
    const root = scratch(true)
    await writeBaselineFiles(root, "index", input)
    edit(root)
    commit(root)
    return readBaseline(root, "index").catch((caught: unknown) => caught as Error)
  }
  const prefix = ".repo-contract/api-contract/index"

  it("refuses a meta file that is not JSON", async () => {
    const error = await corrupt((root) =>
      writeFileSync(path.join(dirOf(root), "baseline.meta.json"), "{ nope"),
    )
    expect((error as Error).message).toBe(
      `${prefix}/baseline.meta.json is not valid JSON (a truncated or interrupted write?). Regenerate it with the update-baseline command.`,
    )
  })

  it("refuses a meta file that is not an object", async () => {
    for (const value of ["text", null, 3]) {
      const error = await corrupt((root) => writeMeta(root, value))
      expect((error as Error).message).toBe(
        `${prefix}/baseline.meta.json is corrupted or was manually edited (not a JSON object). Regenerate it with the update-baseline command.`,
      )
    }
  })

  it("names the first meta field that is missing or the wrong type", async () => {
    for (const field of [
      "packageName",
      "packageVersion",
      "apiExtractorVersion",
      "apiJsonHash",
      "dtsHash",
      "generatedAt",
    ]) {
      for (const bad of [undefined, 5]) {
        const error = await corrupt((root) => {
          const meta = { ...metaOf(root), [field]: bad }
          writeMeta(root, meta)
        })
        expect((error as Error).message).toBe(
          `${prefix}/baseline.meta.json is corrupted or was manually edited ("${field}" must be a string). Regenerate it with the update-baseline command.`,
        )
      }
    }
    const error = await corrupt((root) =>
      writeMeta(root, { ...metaOf(root), apiJsonSchemaVersion: "1011" }),
    )
    expect((error as Error).message).toBe(
      `${prefix}/baseline.meta.json is corrupted or was manually edited ("apiJsonSchemaVersion" must be a number). Regenerate it with the update-baseline command.`,
    )
  })

  it("refuses a baseline missing either content file", async () => {
    const incomplete = `${prefix}/baseline.meta.json exists at HEAD but baseline.api.json/baseline.d.ts do not -- the committed baseline is incomplete.`
    for (const file of ["baseline.api.json", "baseline.d.ts"]) {
      const error = await corrupt((root) => rmSync(path.join(dirOf(root), file)))
      expect((error as Error).message).toBe(incomplete)
    }
    const both = await corrupt((root) => {
      rmSync(path.join(dirOf(root), "baseline.api.json"))
      rmSync(path.join(dirOf(root), "baseline.d.ts"))
    })
    expect((both as Error).message).toBe(incomplete)
  })

  it("refuses content that no longer matches its recorded hash", async () => {
    const api = await corrupt((root) =>
      writeFileSync(path.join(dirOf(root), "baseline.api.json"), "{}\n"),
    )
    expect((api as Error).message).toBe(
      `${prefix}/baseline.api.json's content does not match the hash recorded in baseline.meta.json -- the committed baseline is corrupted or was manually edited. Regenerate it with the update-baseline command.`,
    )
    const dts = await corrupt((root) =>
      writeFileSync(path.join(dirOf(root), "baseline.d.ts"), "export {}\n"),
    )
    expect((dts as Error).message).toBe(
      `${prefix}/baseline.d.ts's content does not match the hash recorded in baseline.meta.json -- the committed baseline is corrupted or was manually edited. Regenerate it with the update-baseline command.`,
    )
  })

  it("makes its directory when asked to write a nested target", async () => {
    const root = scratch(false)
    mkdirSync(path.join(root, "x"))
    await writeBaselineFiles(root, "deep-target", input)
    expect(readdirSync(path.join(root, ".repo-contract/api-contract/deep-target"))).toHaveLength(3)
  })
})
