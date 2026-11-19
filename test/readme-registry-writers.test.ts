import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "..")
const WRITER_CALL =
  /\b(?:loadAndReconcileExceptionRegistry|reconcileAndPersistExceptionRegistry)\s*[<(]/

const sources = (dir: string): string[] =>
  readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .filter(
      (file) => /\.(?:ts|mjs)$/.test(file) && !file.endsWith(".d.ts") && !file.endsWith(".d.mts"),
    )
    .map((file) => path.posix.join(dir, file.split(path.sep).join("/")))

const read = (file: string): string => readFileSync(path.join(root, file), "utf8")

// A check file opens its TSDoc with "`Id`: what it checks", the id `contract.ts` registers.
const checkIdOf = (checkFile: string): string => {
  const id = /^ \* `(\w+)`:/m.exec(read(checkFile))?.[1]
  if (id === undefined) throw new Error(`${checkFile} does not open with its check id`)
  return id
}

// A script belongs to the check whose file names its path.
const owningCheck = (script: string): string => {
  const stem = script.replace(/\.(?:ts|mjs)$/, "")
  const owner = sources("checks").find((file) => read(file).includes(stem))
  if (owner === undefined) throw new Error(`no file under checks/ names ${stem}`)
  return owner
}

const writers = (): string[] =>
  [...sources("checks"), ...sources("scripts")]
    .filter((file) => WRITER_CALL.test(read(file)))
    .map((file) => checkIdOf(file.startsWith("checks/") ? file : owningCheck(file)))

const checksSection = (): string => {
  const readme = read("README.md")
  const start = readme.indexOf("## The checks")
  return readme.slice(start, readme.indexOf("\n### ", start))
}

describe("README 'The checks': the checks that write a registry stub", () => {
  it("finds the writers through their registry calls, CodeRabbit's script included", () => {
    expect(new Set(writers())).toEqual(
      new Set(["CodeRabbit", "CodeScanning", "DistNoUrls", "SecurityDeps", "SecuritySocket"]),
    )
  })

  it("names every check that calls a registry writer", () => {
    const section = checksSection()
    for (const id of writers()) expect(section, id).toContain(`\`${id}\``)
  })
})
