import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { sha256 } from "../scripts/api-contract/baseline-store.js"
import { main, runUpdateBaseline } from "../scripts/api-contract/update-baseline.js"

const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)

const SOURCE = `/** @public */
export function keep(value: string): string {
  return value
}
`
const CHANGED = `${SOURCE}/** @public */\nexport function extra(): void {}\n`

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A fresh git repository holding `SOURCE` at `version`, built but with no baseline committed yet. */
function makeRepo(version: string) {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-update-baseline-"))
  roots.push(root)
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  write("package.json", JSON.stringify({ name: "fx", version, type: "module" }))
  write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "dist/.dts",
        rootDir: "src",
        skipLibCheck: true,
      },
      include: ["src"],
    }),
  )
  write("typedoc.json", JSON.stringify({ entryPoints: ["src/index.ts"] }))
  write(".gitignore", "dist/\n.repo-contract/api-contract/*/current*\n")
  const source = (text: string) => {
    write("src/index.ts", text)
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
  }
  const setVersion = (next: string) =>
    write("package.json", JSON.stringify({ name: "fx", version: next, type: "module" }))
  const commit = () => {
    git("add", "-A")
    git("commit", "-q", "-m", "x")
  }
  source(SOURCE)
  return { root, write, source, setVersion, commit }
}

const baselineDir = (root: string) => path.join(root, ".repo-contract/api-contract/index")
const review = "Review .repo-contract/api-contract/index/baseline.* and commit."

/** A repo with a baseline for `SOURCE` at `version`, committed. */
async function committed(version: string) {
  const repo = makeRepo(version)
  await runUpdateBaseline(repo.root)
  repo.commit()
  return repo
}

describe("runUpdateBaseline()", { timeout: 180_000 }, () => {
  it("bootstraps a target that has no baseline yet", async () => {
    const repo = makeRepo("1.0.0")
    const [outcome] = await runUpdateBaseline(repo.root)
    expect(outcome).toEqual({
      target: "index",
      status: "updated",
      message: `Baseline updated to version 1.0.0. ${review}`,
    })
    const meta = JSON.parse(
      readFileSync(path.join(baselineDir(repo.root), "baseline.meta.json"), "utf8"),
    ) as Record<string, unknown>
    expect(meta).toMatchObject({ packageName: "fx", packageVersion: "1.0.0" })
  })

  it("does nothing when the baseline already matches at the same version", async () => {
    const repo = await committed("1.0.0")
    expect(await runUpdateBaseline(repo.root)).toEqual([
      {
        target: "index",
        status: "current",
        message: "Baseline is already at version 1.0.0 with matching contents; nothing to do.",
      },
    ])
  })

  it("refreshes in place when the API changed without a version bump", async () => {
    const repo = await committed("1.0.0")
    repo.source(CHANGED)
    expect(await runUpdateBaseline(repo.root)).toEqual([
      {
        target: "index",
        status: "updated",
        message: `Baseline contents refreshed at version 1.0.0 -- the public API changed without a version bump. ${review}`,
      },
    ])
    expect(readFileSync(path.join(baselineDir(repo.root), "baseline.d.ts"), "utf8")).toContain(
      "extra",
    )
  })

  it("updates to a higher version", async () => {
    const repo = await committed("1.0.0")
    repo.setVersion("1.1.0")
    expect(await runUpdateBaseline(repo.root)).toEqual([
      {
        target: "index",
        status: "updated",
        message: `Baseline updated to version 1.1.0. ${review}`,
      },
    ])
    const meta = JSON.parse(
      readFileSync(path.join(baselineDir(repo.root), "baseline.meta.json"), "utf8"),
    ) as { packageVersion: string }
    expect(meta.packageVersion).toBe("1.1.0")
  })

  it("refuses to roll the baseline backwards", async () => {
    const repo = await committed("1.1.0")
    repo.setVersion("1.0.0")
    expect(await runUpdateBaseline(repo.root)).toEqual([
      {
        target: "index",
        status: "refused",
        message:
          "Refusing to update: package.json declares version 1.0.0, older than the committed baseline's 1.1.0 -- regenerating now would roll the baseline backwards. Bump package.json (normally via the Version Packages PR) first.",
      },
    ])
  })

  it("refuses a package.json version it cannot parse", async () => {
    const repo = await committed("1.0.0")
    repo.setVersion("next")
    expect(await runUpdateBaseline(repo.root)).toEqual([
      {
        target: "index",
        status: "refused",
        message:
          'Refusing to update: could not parse package.json\'s version "next" as major.minor.patch. Fix package.json before running this again.',
      },
    ])
  })

  it("refuses a committed baseline whose recorded version it cannot parse", async () => {
    const repo = await committed("1.0.0")
    const metaPath = path.join(baselineDir(repo.root), "baseline.meta.json")
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>
    writeFileSync(metaPath, JSON.stringify({ ...meta, packageVersion: "weird" }))
    repo.commit()
    expect(await runUpdateBaseline(repo.root)).toEqual([
      {
        target: "index",
        status: "refused",
        message:
          'Refusing to update: the committed baseline records an unparseable version "weird". Regenerate it from a known-good commit.',
      },
    ])
  })

  it("is not current when only the declaration rollup or only the API JSON differs from the baseline", async () => {
    for (const file of ["baseline.d.ts", "baseline.api.json"] as const) {
      const repo = await committed("1.0.0")
      const dir = baselineDir(repo.root)
      const metaPath = path.join(dir, "baseline.meta.json")
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, string>
      const edited = `${readFileSync(path.join(dir, file), "utf8")}\n// edited\n`
      writeFileSync(path.join(dir, file), edited)
      writeFileSync(
        metaPath,
        JSON.stringify({
          ...meta,
          [file === "baseline.d.ts" ? "dtsHash" : "apiJsonHash"]: sha256(edited),
        }),
      )
      repo.commit()
      const [outcome] = await runUpdateBaseline(repo.root)
      expect(outcome?.status, file).toBe("updated")
    }
  })
})

describe("main()", { timeout: 180_000 }, () => {
  const capture = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
    }
  }

  it("writes updated and current outcomes to stdout and exits 0", async () => {
    const repo = makeRepo("1.0.0")
    const first = capture()
    expect(await main(repo.root, first.io)).toBe(0)
    expect(first.out).toEqual([`[index] Baseline updated to version 1.0.0. ${review}\n`])
    expect(first.err).toEqual([])
    repo.commit()
    const second = capture()
    expect(await main(repo.root, second.io)).toBe(0)
    expect(second.out).toEqual([
      "[index] Baseline is already at version 1.0.0 with matching contents; nothing to do.\n",
    ])
  })

  it("writes refused outcomes to stderr and exits 1", async () => {
    const repo = await committed("1.1.0")
    repo.setVersion("1.0.0")
    const run = capture()
    expect(await main(repo.root, run.io)).toBe(1)
    expect(run.out).toEqual([])
    expect(run.err).toHaveLength(1)
    expect(run.err[0]).toMatch(
      /^\[index\] Refusing to update: package\.json declares version 1\.0\.0.*\n$/,
    )
  })
})

describe("main() over several targets", { timeout: 240_000 }, () => {
  it("exits non-zero when any target is refused, while still reporting the ones that were fine", async () => {
    const repo = makeRepo("1.0.0")
    repo.write(
      "typedoc.json",
      JSON.stringify({ entryPoints: ["src/index.ts", "src/extra/index.ts"] }),
    )
    repo.write(
      "package.json",
      JSON.stringify({
        name: "fx",
        version: "1.0.0",
        type: "module",
        exports: {
          ".": { import: { types: "./dist/index.d.ts", default: "./dist/index.js" } },
          "./extra": { import: { types: "./dist/extra.d.ts", default: "./dist/extra.js" } },
        },
      }),
    )
    repo.write("src/extra/index.ts", "/** @public */\nexport function other(): void {}\n")
    repo.source(SOURCE)
    await runUpdateBaseline(repo.root)
    const extraMeta = path.join(repo.root, ".repo-contract/api-contract/extra/baseline.meta.json")
    const meta = JSON.parse(readFileSync(extraMeta, "utf8")) as Record<string, unknown>
    writeFileSync(extraMeta, JSON.stringify({ ...meta, packageVersion: "weird" }))
    repo.commit()

    const out: string[] = []
    const err: string[] = []
    const code = await main(repo.root, { stdout: (t) => out.push(t), stderr: (t) => err.push(t) })
    expect(code).toBe(1)
    expect(out).toEqual([
      "[index] Baseline is already at version 1.0.0 with matching contents; nothing to do.\n",
    ])
    expect(err).toHaveLength(1)
    expect(err[0]).toContain(
      "[extra] Refusing to update: the committed baseline records an unparseable version",
    )
  })
})
