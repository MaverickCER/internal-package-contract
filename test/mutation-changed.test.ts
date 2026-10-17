import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { importsOf, run, targetsOf } from "../scripts/mutation/changed.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-mutation-changed-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.test")
  git("config", "user.name", "t")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const git = (...args: string[]): void => {
  spawnSync("git", args, { cwd: dir })
}
const put = (file: string, text = "export {}\n"): void => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), text)
}
const commit = (): void => {
  git("add", "-A")
  git("commit", "-q", "-m", "x")
}
const withIo = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

describe("importsOf", () => {
  it("lists the source files a test imports by a relative path, whatever the extension it names", () => {
    put("src/a.ts")
    put("src/b.tsx")
    put("src/c.mts")
    put("src/d.mjs")
    put("src/deep/e.ts")
    put("src/other.test.ts")
    put(
      "test/x.test.ts",
      [
        'import { a } from "../src/a.js"',
        'import b from "../src/b.js"',
        'import { c } from "../src/c.mjs"',
        'import { d } from "../src/d.mjs"',
        'const e = await import("../src/deep/e.js")',
        'import { t } from "../src/other.test.js"',
        'import { gone } from "../src/missing.js"',
        'import vitest from "vitest"',
        'import { local } from "./sibling.js"',
      ].join("\n"),
    )
    expect(importsOf(dir, "test/x.test.ts").sort()).toEqual([
      "src/a.ts",
      "src/b.tsx",
      "src/c.mts",
      "src/d.mjs",
      "src/deep/e.ts",
    ])
  })

  it("changes only the end of a name that ends in an extension it swaps", () => {
    put("src/x.js.ts")
    put("src/y.mjs.mts")
    put("src/z.js.tsx")
    put(
      "test/z.test.ts",
      'import "../src/x.js.js"\nimport "../src/y.mjs.mjs"\nimport "../src/z.js.js"\n',
    )
    expect(importsOf(dir, "test/z.test.ts").sort()).toEqual([
      "src/x.js.ts",
      "src/y.mjs.mts",
      "src/z.js.tsx",
    ])
  })

  it("does not take a file that is not a source file, or a test, for one", () => {
    put("src/data.json", "{}")
    put("src/notes.md", "x")
    put("src/helper.test.ts")
    put(
      "test/y.test.ts",
      'import "../src/data.json"\nimport "../src/notes.md"\nimport "../src/helper.test.ts"\n',
    )
    expect(importsOf(dir, "test/y.test.ts")).toEqual([])
  })
})

describe("targetsOf", () => {
  it("is the source files a change touches and those a touched test imports, once each, in order, and nothing deleted", () => {
    put("src/untouched.ts")
    put("src/edited.ts")
    put("src/removed.ts")
    put("src/imported.ts")
    put("test/old.test.ts", 'import "../src/untouched.js"\n')
    commit()
    put("src/edited.ts", "export const x = 1\n")
    rmSync(path.join(dir, "src/removed.ts"))
    put("src/new.ts")
    put(
      "test/old.test.ts",
      'import "../src/untouched.js"\nimport "../src/imported.js"\nimport "../src/edited.js"\n',
    )
    put("docs/readme.md", "# x\n")
    expect(targetsOf(dir, "main")).toEqual([
      "src/edited.ts",
      "src/imported.ts",
      "src/new.ts",
      "src/untouched.ts",
    ])
  })

  it("does not follow the imports of a source file, only of a test", () => {
    put("src/edited.ts", 'import "./dependency.js"\n')
    put("src/dependency.ts")
    commit()
    put("src/edited.ts", 'import "./dependency.js"\nexport const x = 1\n')
    expect(targetsOf(dir, "main")).toEqual(["src/edited.ts"])
  })

  it("is empty when nothing a mutant could be made of changed", () => {
    put("a.txt", "a")
    commit()
    put("docs/readme.md", "# x\n")
    put("package.json", "{}")
    expect(targetsOf(dir, "main")).toEqual([])
  })

  it("treats a file named like a test but outside a test folder as a test, and a test folder file as one too", () => {
    put("src/a.ts")
    commit()
    put("src/a.spec.ts", 'import "./a.js"\n')
    put("test/helper.ts", 'import "../src/a.js"\n')
    expect(targetsOf(dir, "main")).toEqual(["src/a.ts"])
  })
})

describe("run", () => {
  const seams = (status: number | null, patterns: string[] = ["src/**/*.ts", "!src/skip/**"]) => {
    const calls: { args: string[]; cwd: string }[] = []
    return {
      calls,
      seams: {
        spawn: (args: string[], cwd: string) => {
          calls.push({ args, cwd })
          return status
        },
        mutatePatterns: () => Promise.resolve(patterns),
        baseOf: () => "main",
      },
    }
  }
  const report = (statuses: string[]): void =>
    put(
      "reports/mutation/mutation.json",
      JSON.stringify({
        files: { "src/a.ts": { mutants: statuses.map((status) => ({ status })) } },
      }),
    )

  it("mutates what changed, with the package's own exclusions, and says it is advice", async () => {
    put("src/a.ts")
    commit()
    put("src/a.ts", "export const x = 1\n")
    report(["Killed", "Killed", "Killed"])
    const { calls, seams: s } = seams(0)
    const { out, err, io } = withIo()
    expect(await run([], dir, io, s)).toBe(0)
    expect(calls).toEqual([{ args: ["--mutate", "src/a.ts,!src/skip/**"], cwd: dir }])
    expect(out.join("")).toBe(
      "\nMutation of 1 file(s) (src/a.ts): 3 killed, 0 not caught.\n" +
        "This is advice, not the gate: a full `Mutation` run, which tries every mutant in every file, is what says a change is finished.\n",
    )
    expect(err).toEqual([])
  })

  it("fails when a mutant was not caught, counting survivors, uncovered mutants and timeouts, and not the ones it ignored", async () => {
    put("src/a.ts")
    report(["Killed", "Survived", "NoCoverage", "Timeout", "Ignored", "CompileError"])
    const { seams: s } = seams(0)
    const { out, io } = withIo()
    expect(await run(["src/a.ts"], dir, io, s)).toBe(1)
    expect(out.join("")).toContain("1 killed, 3 not caught.")
  })

  it("fails when Stryker itself did not finish, whatever an old report says", async () => {
    put("src/a.ts")
    report(["Survived"])
    const { out, io } = withIo()
    expect(await run(["src/a.ts"], dir, io, seams(1).seams)).toBe(1)
    expect(out.join("")).toContain("0 killed, 0 not caught.")
    expect(await run(["src/a.ts"], dir, io, seams(null).seams)).toBe(1)
  })

  it("does not read a report that is not there, and passes when everything was caught", async () => {
    put("src/a.ts")
    const { out, io } = withIo()
    expect(await run(["src/a.ts"], dir, io, seams(0).seams)).toBe(0)
    expect(out.join("")).toContain("0 killed, 0 not caught.")
  })

  it("mutates exactly the files it is given, ignoring what changed", async () => {
    put("src/a.ts")
    put("src/b.ts")
    const { calls, seams: s } = seams(0)
    const { out, io } = withIo()
    await run(["src/b.ts", "src/a.ts"], dir, io, s)
    expect(calls[0]?.args).toEqual(["--mutate", "src/b.ts,src/a.ts,!src/skip/**"])
    expect(out.join("")).toContain("Mutation of 2 file(s) (src/b.ts, src/a.ts):")
  })

  it("measures against the base it is given", async () => {
    put("src/a.ts")
    commit()
    git("branch", "other")
    put("src/b.ts")
    commit()
    const { calls, seams: s } = seams(0)
    await run(["--base", "other"], dir, withIo().io, s)
    expect(calls[0]?.args).toEqual(["--mutate", "src/b.ts,!src/skip/**"])
  })

  it("says so, and runs nothing, when nothing changed that a mutant could be made of", async () => {
    put("a.txt", "a")
    commit()
    const { calls, seams: s } = seams(0)
    const { out, io } = withIo()
    expect(await run([], dir, io, s)).toBe(0)
    expect(out.join("")).toBe(
      "Nothing to mutate: no source file changed, and no changed test imports one.\n",
    )
    expect(calls).toEqual([])
  })

  it("refuses an option it does not know, a --base with no value, and a change with nothing to measure it against", async () => {
    const unknown = withIo()
    expect(await run(["--nope"], dir, unknown.io, seams(0).seams)).toBe(1)
    expect(unknown.err.join("")).toContain("mutation: unknown option --nope.")
    const missing = withIo()
    expect(await run(["--base"], dir, missing.io, seams(0).seams)).toBe(1)
    expect(missing.err.join("")).toContain("mutation: --base needs a value.")
    const none = withIo()
    expect(await run([], dir, none.io, { ...seams(0).seams, baseOf: () => undefined })).toBe(1)
    expect(none.err.join("")).toContain("nothing to measure a change against")
    const named = withIo()
    put("src/a.ts")
    expect(
      await run(["src/a.ts"], dir, named.io, { ...seams(0).seams, baseOf: () => undefined }),
    ).toBe(0)
  })
})
