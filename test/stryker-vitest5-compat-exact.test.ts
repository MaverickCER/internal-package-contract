import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  LEGACY_JOIN,
  ancestorsOf,
  RUNNER_FILES,
  UPSTREAM_FIX_MARKER,
  VITEST_5_JOIN,
  classify,
  ensureStrykerVitest5Compat,
  findPackageDir,
  majorOf,
} from "../scripts/stryker-vitest5-compat.mjs"

// The filesystem root as `path.resolve` sees it: `/` on POSIX, the current drive's root (`C:\\`) on Windows.
const FS_ROOT = path.parse(path.resolve(path.sep)).root
const ROOT = path.join(FS_ROOT, "work", "app")
const RUNNER = path.join(ROOT, "node_modules", "@stryker-mutator", "vitest-runner")
const RUNNER_DIST = path.join(RUNNER, "dist", "src")
const HELPERS = path.join(RUNNER_DIST, "test-helpers.js")
const SETUP = path.join(RUNNER_DIST, "stryker-setup.js")

const legacy = (label: string) => `// ${label}\nreturn ${LEGACY_JOIN};\n// end ${label}\n`
const patched = (label: string) => `// ${label}\nreturn ${VITEST_5_JOIN};\n// end ${label}\n`

function memoryIo(files: Record<string, string>) {
  const store = new Map(Object.entries(files))
  const writes: [string, string][] = []
  return {
    store,
    writes,
    io: {
      exists: (file: string) => store.has(file),
      readFile: (file: string) => {
        const text = store.get(file)
        if (text === undefined) throw new Error(`unexpected read of ${file}`)
        return text
      },
      writeFile: (file: string, text: string) => {
        writes.push([file, text])
        store.set(file, text)
      },
    },
  }
}

const install = (vitestVersion: string, helpers: string, setup: string) => ({
  [path.join(ROOT, "node_modules", "vitest", "package.json")]: JSON.stringify({
    name: "vitest",
    version: vitestVersion,
  }),
  [path.join(RUNNER, "package.json")]: JSON.stringify({ name: "@stryker-mutator/vitest-runner" }),
  [HELPERS]: helpers,
  [SETUP]: setup,
})

describe("the constants", () => {
  it("name the exact expressions and files the fix is about", () => {
    expect(LEGACY_JOIN).toBe("nameParts.join(' ').trim()")
    expect(VITEST_5_JOIN).toBe("nameParts.join(' > ').trim()")
    expect(UPSTREAM_FIX_MARKER).toBe("testNameSeparator")
    expect(RUNNER_FILES).toEqual(["test-helpers.js", "stryker-setup.js"])
  })
})

describe("majorOf()", () => {
  it("reads the leading number of a semver string", () => {
    expect(majorOf("5.0.3")).toBe(5)
    expect(majorOf("4.1.11")).toBe(4)
    expect(majorOf("10.2.1")).toBe(10)
    expect(majorOf("0.9.0")).toBe(0)
  })

  it("returns undefined when the string does not start with a major and a dot", () => {
    expect(majorOf("v5.0.0")).toBeUndefined()
    expect(majorOf("5")).toBeUndefined()
    expect(majorOf("latest")).toBeUndefined()
    expect(majorOf("")).toBeUndefined()
    expect(majorOf("x5.0.0")).toBeUndefined()
  })
})

describe("classify()", () => {
  it("recognises each state of a runner file", () => {
    expect(classify(patched("a"))).toBe("patched")
    expect(classify(legacy("a"))).toBe("needs-patch")
    expect(classify("const separator = inject('testNameSeparator')")).toBe("upstream-fixed")
    expect(classify("nothing to see")).toBe("unrecognised")
    expect(classify("")).toBe("unrecognised")
  })

  it("prefers the patched form over the legacy form, and the legacy form over the upstream marker", () => {
    expect(classify(`${legacy("a")}${patched("b")}`)).toBe("patched")
    expect(classify(`${legacy("a")}\n${UPSTREAM_FIX_MARKER}`)).toBe("needs-patch")
    expect(classify(`${patched("a")}\n${UPSTREAM_FIX_MARKER}`)).toBe("patched")
  })
})

describe("ancestorsOf()", () => {
  it("lists the directory and every ancestor up to the root, nearest first", () => {
    expect(ancestorsOf(path.join(ROOT, "packages", "a"))).toEqual([
      path.join(ROOT, "packages", "a"),
      path.join(ROOT, "packages"),
      ROOT,
      path.join(FS_ROOT, "work"),
      FS_ROOT,
    ])
  })

  it("lists only the root when started at the root", () => {
    expect(ancestorsOf(FS_ROOT)).toEqual([FS_ROOT])
  })

  it("resolves a relative start against the current directory", () => {
    const list = ancestorsOf(".")
    expect(list[0]).toBe(process.cwd())
    expect(list.at(-1)).toBe(path.parse(process.cwd()).root)
  })
})

describe("findPackageDir()", () => {
  it("returns the node_modules directory in the starting directory when its package.json exists", () => {
    const { io } = memoryIo({ [path.join(ROOT, "node_modules", "vitest", "package.json")]: "{}" })
    expect(findPackageDir(ROOT, "vitest", io.exists)).toBe(
      path.join(ROOT, "node_modules", "vitest"),
    )
  })

  it("walks up to an ancestor's node_modules", () => {
    const { io } = memoryIo({
      [path.join(FS_ROOT, "work", "node_modules", "vitest", "package.json")]: "{}",
    })
    expect(findPackageDir(path.join(ROOT, "packages", "a"), "vitest", io.exists)).toBe(
      path.join(FS_ROOT, "work", "node_modules", "vitest"),
    )
  })

  it("handles scoped package names", () => {
    const { io } = memoryIo({ [path.join(RUNNER, "package.json")]: "{}" })
    expect(findPackageDir(ROOT, "@stryker-mutator/vitest-runner", io.exists)).toBe(RUNNER)
  })

  it("skips a directory that has no package.json and returns undefined at the filesystem root", () => {
    const asked: string[] = []
    const found = findPackageDir(ROOT, "vitest", (file) => {
      asked.push(file)
      return false
    })
    expect(found).toBeUndefined()
    expect(asked).toEqual([
      path.join(ROOT, "node_modules", "vitest", "package.json"),
      path.join(FS_ROOT, "work", "node_modules", "vitest", "package.json"),
      path.join(FS_ROOT, "node_modules", "vitest", "package.json"),
    ])
  })
})

describe("ensureStrykerVitest5Compat()", () => {
  it("does nothing when Vitest is not installed", () => {
    const { io, writes } = memoryIo({ [path.join(RUNNER, "package.json")]: "{}" })
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "not-needed",
      vitestVersion: undefined,
      patched: [],
    })
    expect(writes).toEqual([])
  })

  it("does nothing when the Stryker Vitest runner is not installed", () => {
    const { io, writes } = memoryIo({
      [path.join(ROOT, "node_modules", "vitest", "package.json")]: '{"version":"5.0.3"}',
    })
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "not-needed",
      vitestVersion: undefined,
      patched: [],
    })
    expect(writes).toEqual([])
  })

  it("does nothing on Vitest 4, whatever the runner files look like", () => {
    const { io, writes } = memoryIo(install("4.99.0", legacy("h"), legacy("s")))
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "not-needed",
      vitestVersion: "4.99.0",
      patched: [],
    })
    expect(writes).toEqual([])
  })

  it("does nothing when the Vitest version has no readable major", () => {
    const { io, writes } = memoryIo(install("next", legacy("h"), legacy("s")))
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "not-needed",
      vitestVersion: "next",
      patched: [],
    })
    expect(writes).toEqual([])
  })

  it("rewrites both runner files on Vitest 5.0.0, keeping everything else in them", () => {
    const { io, writes, store } = memoryIo(install("5.0.0", legacy("helpers"), legacy("setup")))
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "patched",
      vitestVersion: "5.0.0",
      patched: [HELPERS, SETUP],
    })
    expect(writes).toEqual([
      [HELPERS, patched("helpers")],
      [SETUP, patched("setup")],
    ])
    expect(store.get(HELPERS)).toBe(patched("helpers"))
    expect(store.get(SETUP)).toBe(patched("setup"))
  })

  it("treats a two-digit Vitest major as 5 or later", () => {
    const { io } = memoryIo(install("10.0.0", legacy("h"), legacy("s")))
    expect(ensureStrykerVitest5Compat(ROOT, io).status).toBe("patched")
  })

  it("is a no-op the second time", () => {
    const { io, writes } = memoryIo(install("5.0.3", legacy("h"), legacy("s")))
    expect(ensureStrykerVitest5Compat(ROOT, io).status).toBe("patched")
    writes.length = 0
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "already-patched",
      vitestVersion: "5.0.3",
      patched: [],
    })
    expect(writes).toEqual([])
  })

  it("rewrites only the file that still needs it when the other is already patched", () => {
    const { io, writes } = memoryIo(install("5.0.3", legacy("helpers"), patched("setup")))
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "patched",
      vitestVersion: "5.0.3",
      patched: [HELPERS],
    })
    expect(writes).toEqual([[HELPERS, patched("helpers")]])

    const second = memoryIo(install("5.0.3", patched("helpers"), legacy("setup")))
    expect(ensureStrykerVitest5Compat(ROOT, second.io).patched).toEqual([SETUP])
    expect(second.writes).toEqual([[SETUP, patched("setup")]])
  })

  it("leaves a runner that already carries the upstream fix alone", () => {
    const fixed = `const separator = inject('${UPSTREAM_FIX_MARKER}')`
    const { io, writes } = memoryIo(install("5.0.3", fixed, fixed))
    expect(ensureStrykerVitest5Compat(ROOT, io)).toEqual({
      status: "upstream-fixed",
      vitestVersion: "5.0.3",
      patched: [],
    })
    expect(writes).toEqual([])
  })

  it("refuses to rewrite one file when the other is not understood", () => {
    const upstreamMixed = memoryIo(
      install("5.0.3", legacy("h"), `inject('${UPSTREAM_FIX_MARKER}')`),
    )
    expect(ensureStrykerVitest5Compat(ROOT, upstreamMixed.io)).toEqual({
      status: "unrecognised",
      vitestVersion: "5.0.3",
      patched: [],
    })
    expect(upstreamMixed.writes).toEqual([])

    const unknown = memoryIo(install("5.0.3", "something else entirely", legacy("s")))
    expect(ensureStrykerVitest5Compat(ROOT, unknown.io).status).toBe("unrecognised")
    expect(unknown.writes).toEqual([])

    const bothUnknown = memoryIo(install("5.0.3", "x", "y"))
    expect(ensureStrykerVitest5Compat(ROOT, bothUnknown.io).status).toBe("unrecognised")
  })

  it("finds Vitest and the runner hoisted in an ancestor directory", () => {
    const hoisted = (file: string) =>
      file.replace(path.join(ROOT, "node_modules"), path.join(FS_ROOT, "work", "node_modules"))
    const files = Object.fromEntries(
      Object.entries(install("5.0.3", legacy("h"), legacy("s"))).map(([file, text]) => [
        hoisted(file),
        text,
      ]),
    )
    const { io, writes } = memoryIo(files)
    const result = ensureStrykerVitest5Compat(path.join(ROOT, "packages", "a"), io)
    expect(result.status).toBe("patched")
    expect(writes.map(([file]) => file)).toEqual([hoisted(HELPERS), hoisted(SETUP)])
  })

  it("reads and writes the real file system when no io is given", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stryker-v5-compat-"))
    try {
      const runnerDist = path.join(
        dir,
        "node_modules",
        "@stryker-mutator",
        "vitest-runner",
        "dist",
        "src",
      )
      mkdirSync(runnerDist, { recursive: true })
      mkdirSync(path.join(dir, "node_modules", "vitest"), { recursive: true })
      writeFileSync(path.join(dir, "node_modules", "vitest", "package.json"), '{"version":"5.0.3"}')
      writeFileSync(
        path.join(dir, "node_modules", "@stryker-mutator", "vitest-runner", "package.json"),
        "{}",
      )
      writeFileSync(path.join(runnerDist, "test-helpers.js"), legacy("real helpers"))
      writeFileSync(path.join(runnerDist, "stryker-setup.js"), legacy("real setup"))

      const result = ensureStrykerVitest5Compat(dir)

      expect(result.status).toBe("patched")
      expect(readFileSync(path.join(runnerDist, "test-helpers.js"), "utf8")).toBe(
        patched("real helpers"),
      )
      expect(readFileSync(path.join(runnerDist, "stryker-setup.js"), "utf8")).toBe(
        patched("real setup"),
      )
      expect(ensureStrykerVitest5Compat(dir).status).toBe("already-patched")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
