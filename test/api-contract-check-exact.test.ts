import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  main,
  parseReleaseTagArg,
  resolveAssignabilityQuery,
  runApiContractCheck,
} from "../scripts/api-contract/check.js"
import { loadApiModel } from "../scripts/api-contract/extractor-adapter.js"
import { buildItemIndex, buildReferenceIndex } from "../scripts/api-contract/type-assignability.js"
import { getApiExtractorVersion } from "../scripts/api-contract/extractor-adapter.js"
import { summarizeChanges } from "../scripts/api-contract/summarize-changes.js"

const tsc = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
)
const tsx = path.resolve(import.meta.dirname, "../node_modules/.bin/tsx")
const checkScript = path.resolve(import.meta.dirname, "../scripts/api-contract/check.ts")

const INDEX = `/** @public */
export function keep(value: string): string {
  return value
}
/** @public */
export function gone(): void {}
/** @public */
export function generic<T>(value: T): T {
  return value
}
/** @public */
export interface Shape {
  readonly id: string
  size: number
}
/** @public */
export interface Versioned {
  version: 1
  name: string
}
/** @beta */
export function betaB(): void {}
/** @beta */
export function betaA(): void {}
`

const EXTRA = `/** @public */
export function other(): void {}
/** @public */
export function removable(): void {}
`

interface Repo {
  readonly root: string
  readonly setSources: (index: string, extra?: string) => void
  readonly run: (tag?: "public" | "beta" | "alpha") => ReturnType<typeof runApiContractCheck>
}

const typed = (name: string) => ({
  import: { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` },
})

/** A committed baseline of `INDEX` (and `EXTRA` when `twoTargets`) at `version`. */
async function makeRepo(version: string, twoTargets: boolean): Promise<Repo> {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-check-exact-"))
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
  const write = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    writeFileSync(path.join(root, rel), text)
  }
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.com")
  git("config", "user.name", "t")
  write(
    "package.json",
    JSON.stringify({
      name: "fx",
      version,
      type: "module",
      exports: twoTargets
        ? { ".": typed("index"), "./extra": typed("extra") }
        : { ".": typed("index") },
    }),
  )
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
  write(
    "typedoc.json",
    JSON.stringify({
      entryPoints: twoTargets ? ["src/index.ts", "src/extra/index.ts"] : ["src/index.ts"],
    }),
  )
  write(".gitignore", "dist/\n.repo-contract/api-contract/*/current*\n")
  const setSources = (index: string, extra = EXTRA) => {
    write("src/index.ts", index)
    if (twoTargets) write("src/extra/index.ts", extra)
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })
  }
  setSources(INDEX)
  const run = (tag: "public" | "beta" | "alpha" = "public") => runApiContractCheck(root, tag)
  await run()
  git("add", "-A")
  git("commit", "-q", "-m", "baseline")
  return { root, setSources, run }
}

const replace = (text: string, from: string, to: string) => {
  expect(text).toContain(from)
  return text.replace(from, to)
}

const roots: string[] = []
const repo = async (version: string, twoTargets: boolean) => {
  const made = await makeRepo(version, twoTargets)
  roots.push(made.root)
  return made
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const addChangeset = (root: string, level: string) => {
  mkdirSync(path.join(root, ".changeset"), { recursive: true })
  writeFileSync(path.join(root, ".changeset", "a.md"), `---\n"fx": ${level}\n---\n\nnote\n`)
}

describe("the first run, with no committed baseline", () => {
  it("records an initial baseline and requires nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-check-initial-"))
    roots.push(root)
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root, stdio: "ignore" })
    const write = (rel: string, text: string) => {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), text)
    }
    write("package.json", JSON.stringify({ name: "fx", version: "0.0.1", type: "module" }))
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
    write("src/index.ts", INDEX)
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "ignore" })

    const evidence = await runApiContractCheck(root, "public")
    const [target] = evidence.targets
    expect(target).toMatchObject({
      target: "index",
      initialBaseline: true,
      diff: [],
      lowerTierDiff: [],
      impact: "unchanged",
      requiredLevel: "none",
      minimumRequiredVersion: "0.1.0",
      summary: summarizeChanges([], "unchanged", true),
    })
    expect(target?.current).toMatchObject({
      packageName: "fx",
      apiExtractorVersion: getApiExtractorVersion(),
    })
    expect(target?.current.apiJsonHash).toMatch(/^[0-9a-f]{64}$/)
    expect(evidence).toMatchObject({
      currentVersion: "0.0.1",
      requiredLevel: "none",
      minimumRequiredVersion: "0.1.0",
      summary: `[index] ${summarizeChanges([], "unchanged", true)}`,
    })
  }, 120_000)
})

describe("one target at 1.2.0", { timeout: 180_000 }, () => {
  let fx: Repo
  beforeAll(async () => {
    fx = await repo("1.2.0", false)
  }, 120_000)

  it("reports a breaking change in full, with the beta changes kept apart and everything sorted", async () => {
    let source = replace(INDEX, "/** @public */\nexport function gone(): void {}\n", "")
    source = replace(
      source,
      "export function betaB(): void {}",
      "export function betaB(x: string): void { void x }",
    )
    source = replace(
      source,
      "export function betaA(): void {}",
      "export function betaA(x: string): void { void x }",
    )
    source = replace(
      source,
      "  version: 1\n  name: string",
      "  version: 1\n  name: string\n  extra?: number",
    )
    fx.setSources(source)
    const evidence = await fx.run()
    const [target] = evidence.targets
    if (!target) throw new Error("no target")

    const ids = target.diff.map((change) => change.id)
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
    expect(target.diff.map((change) => change.kind).sort()).toEqual(
      ["export-removed", "property-added", "schema-version-literal-stale"].sort(),
    )
    const lowerIds = target.lowerTierDiff.map((change) => change.id)
    expect(lowerIds).toHaveLength(2)
    expect(lowerIds).toEqual([...lowerIds].sort((a, b) => a.localeCompare(b)))
    for (const id of lowerIds) expect(ids).not.toContain(id)

    expect(target).toMatchObject({
      target: "index",
      initialBaseline: false,
      impact: "breaking",
      requiredLevel: "major",
      minimumRequiredVersion: "2.0.0",
      baselineVersion: "1.2.0",
      summary: summarizeChanges(target.diff, "breaking", false),
    })
    expect(target.baseline).toMatchObject({
      packageName: "fx",
      apiExtractorVersion: getApiExtractorVersion(),
    })
    expect(target.baseline?.apiJsonHash).toMatch(/^[0-9a-f]{64}$/)
    expect(target.baseline?.apiJsonSchemaVersion).toBe(target.current.apiJsonSchemaVersion)
    expect(evidence).toMatchObject({
      currentVersion: "1.2.0",
      requiredLevel: "major",
      minimumRequiredVersion: "2.0.0",
      summary: `[index] ${target.summary}`,
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: false },
    })

    addChangeset(fx.root, "minor")
    expect((await fx.run()).changesets).toMatchObject({
      changesetCount: 1,
      declaredLevel: "minor",
      satisfied: false,
    })
    addChangeset(fx.root, "major")
    expect((await fx.run()).changesets).toMatchObject({
      changesetCount: 1,
      declaredLevel: "major",
      satisfied: true,
    })
    rmSync(path.join(fx.root, ".changeset"), { recursive: true, force: true })
  })

  it("calls drift under an unchanged version literal breaking even when the shape change alone is compatible", async () => {
    fx.setSources(
      replace(
        INDEX,
        "  version: 1\n  name: string",
        "  version: 1\n  name: string\n  extra?: number",
      ),
    )
    const [target] = (await fx.run()).targets
    expect(target?.diff.map((change) => change.kind).sort()).toEqual(
      ["property-added", "schema-version-literal-stale"].sort(),
    )
    expect(target).toMatchObject({ impact: "breaking", requiredLevel: "major" })
  })

  it("requires nothing for no change", async () => {
    fx.setSources(INDEX)
    const evidence = await fx.run()
    expect(evidence.targets[0]).toMatchObject({
      impact: "unchanged",
      requiredLevel: "none",
      minimumRequiredVersion: "1.2.0",
      diff: [],
      summary: summarizeChanges([], "unchanged", false),
    })
    expect(evidence).toMatchObject({
      requiredLevel: "none",
      minimumRequiredVersion: "1.2.0",
      changesets: { changesetCount: 0, declaredLevel: "none", satisfied: true },
    })
  })

  it("requires a minor for a widening and only a patch for a compatible change that adds nothing", async () => {
    fx.setSources(`${INDEX}/** @public */\nexport function added(): void {}\n`)
    expect((await fx.run()).targets[0]).toMatchObject({
      impact: "compatible",
      requiredLevel: "minor",
      minimumRequiredVersion: "1.3.0",
    })
    fx.setSources(replace(INDEX, "  size: number", "  readonly size: number"))
    expect((await fx.run()).targets[0]).toMatchObject({
      impact: "compatible",
      requiredLevel: "patch",
      minimumRequiredVersion: "1.2.1",
    })
    fx.setSources(
      replace(
        INDEX,
        "/** @beta */\nexport function betaB",
        "/** @public */\nexport function betaB",
      ),
    )
    expect((await fx.run()).targets[0]?.requiredLevel).toBe("minor")
  })

  it("is indeterminate for an unclassifiable change", async () => {
    fx.setSources(replace(INDEX, "generic<T>(value: T): T", "generic<T, U = T>(value: T): T"))
    const evidence = await fx.run()
    expect(evidence.targets[0]).toMatchObject({ impact: "unknown" })
    expect(evidence.targets[0]?.requiredLevel).toBeUndefined()
    expect(evidence.targets[0]?.minimumRequiredVersion).toBeUndefined()
    expect(evidence.requiredLevel).toBeUndefined()
    expect(evidence.minimumRequiredVersion).toBeUndefined()
    expect(evidence.changesets.satisfied).toBeNull()
  })

  it("leaves no baseline scratch file behind", async () => {
    fx.setSources(INDEX)
    await fx.run()
    const prefix = `ipc-api-contract-baseline-${String(process.pid)}-`
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith(prefix))).toEqual([])
  })

  it("reads the widest widening: one addition among other compatible changes is enough for a minor", async () => {
    fx.setSources(
      `${replace(INDEX, "  size: number", "  readonly size: number")}/** @public */\nexport function added(): void {}\n`,
    )
    expect((await fx.run()).targets[0]).toMatchObject({ requiredLevel: "minor" })
  })

  it("honours --release-tag on the command line, defaulting to public", async () => {
    fx.setSources(
      replace(
        INDEX,
        "export function betaB(): void {}",
        "export function betaB(x: string): void { void x }",
      ),
    )
    const cli = (...args: string[]) =>
      execFileSync(tsx, [checkScript, ...args], {
        cwd: fx.root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    const impact = (stdout: string) =>
      (JSON.parse(stdout) as { targets: { impact: string }[] }).targets[0]?.impact

    const plain = cli()
    expect(impact(plain)).toBe("unchanged")
    expect(plain).toBe(JSON.stringify(JSON.parse(plain)))
    expect(impact(cli("--release-tag=beta"))).toBe("breaking")
    expect(impact(cli("--release-tag=alpha"))).toBe("breaking")
    expect(impact(cli("--release-tag=public"))).toBe("unchanged")
    expect(impact(cli("--release-tag=bogus"))).toBe("unchanged")
    expect(impact(cli("--release-tag="))).toBe("unchanged")
    expect(impact(cli("--other", "--release-tag=beta"))).toBe("breaking")
    expect(JSON.parse(cli("--release-tag=beta"))).toEqual(
      JSON.parse(JSON.stringify(await fx.run("beta"))),
    )
  })
})

describe("parseReleaseTagArg() and main()", () => {
  it("takes the tag from --release-tag=, anywhere, and only beta or alpha count", () => {
    expect(parseReleaseTagArg([])).toBe("public")
    expect(parseReleaseTagArg(["--release-tag=beta"])).toBe("beta")
    expect(parseReleaseTagArg(["--release-tag=alpha"])).toBe("alpha")
    expect(parseReleaseTagArg(["--release-tag=public"])).toBe("public")
    expect(parseReleaseTagArg(["--release-tag=gamma"])).toBe("public")
    expect(parseReleaseTagArg(["--release-tag="])).toBe("public")
    expect(parseReleaseTagArg(["--release-tag"])).toBe("public")
    expect(parseReleaseTagArg(["x", "--release-tag=beta", "--release-tag=alpha"])).toBe("beta")
    expect(parseReleaseTagArg(["beta"])).toBe("public")
    expect(parseReleaseTagArg(["x--release-tag=beta"])).toBe("public")
  })

  it("writes the evidence as one JSON document, using the tag from argv", async () => {
    const fx = await repo("1.2.0", false)
    fx.setSources(
      replace(
        INDEX,
        "export function betaB(): void {}",
        "export function betaB(x: string): void { void x }",
      ),
    )
    const written: string[] = []
    await main(["node", "check.ts", "--release-tag=beta"], fx.root, (text) => written.push(text))
    expect(written).toHaveLength(1)
    expect(JSON.parse(written[0] ?? "")).toEqual(JSON.parse(JSON.stringify(await fx.run("beta"))))
    expect(written[0]).toBe(JSON.stringify(JSON.parse(written[0] ?? "")))
  })

  it("copes with a package version it cannot parse", async () => {
    const fx = await repo("next", false)
    fx.setSources(replace(INDEX, "/** @public */\nexport function gone(): void {}\n", ""))
    const evidence = await fx.run()
    expect(evidence.targets[0]).toMatchObject({ impact: "breaking", requiredLevel: "major" })
    expect(evidence.requiredLevel).toBe("major")
  })
})

describe("resolveAssignabilityQuery()", { timeout: 120_000 }, () => {
  it("answers from the located excerpts, and is unknown when it cannot locate them", async () => {
    const fx = await repo("1.2.0", false)
    const outDir = path.join(fx.root, ".repo-contract/api-contract/index")
    const { pkg } = loadApiModel(path.join(outDir, "current.api.json"))
    const itemIndex = buildItemIndex(pkg)
    const refIndex = buildReferenceIndex(pkg)
    const dts = readFileSync(path.join(outDir, "current.d.ts"), "utf8")
    const context = {
      baselineDts: dts,
      currentDts: dts,
      baselineRefIndex: refIndex,
      currentRefIndex: refIndex,
      baselineItemIndex: itemIndex,
      currentItemIndex: itemIndex,
    }
    const reference = (name: string) => {
      const found = [...itemIndex.keys()].find((key) => key.includes(name))
      if (!found) throw new Error(`no ${name}`)
      return found
    }
    const size = reference("size")
    const query = (overrides: object) => ({
      oldCanonicalReference: size,
      newCanonicalReference: size,
      position: "property" as const,
      direction: "covariant" as const,
      ...overrides,
    })

    expect(resolveAssignabilityQuery(context, query({}))).toBe("compatible")
    expect(resolveAssignabilityQuery(context, query({ direction: "invariant" }))).toBe("compatible")
    expect(resolveAssignabilityQuery(context, query({ oldCanonicalReference: "missing" }))).toBe(
      "unknown",
    )
    expect(resolveAssignabilityQuery(context, query({ newCanonicalReference: "missing" }))).toBe(
      "unknown",
    )
    expect(resolveAssignabilityQuery(context, query({ position: "return" }))).toBe("unknown")
    expect(resolveAssignabilityQuery(context, query({ position: "variable" }))).toBe("unknown")
    expect(resolveAssignabilityQuery(context, query({ position: "type-alias" }))).toBe("unknown")
    expect(resolveAssignabilityQuery(context, query({ position: "parameter" }))).toBe("unknown")
    const keep = reference("keep")
    expect(
      resolveAssignabilityQuery(
        context,
        query({ oldCanonicalReference: keep, newCanonicalReference: keep, position: "return" }),
      ),
    ).toBe("compatible")
    expect(
      resolveAssignabilityQuery(
        context,
        query({
          oldCanonicalReference: keep,
          newCanonicalReference: keep,
          position: "parameter",
          parameterIndex: 0,
        }),
      ),
    ).toBe("compatible")
    expect(
      resolveAssignabilityQuery(
        context,
        query({
          oldCanonicalReference: keep,
          newCanonicalReference: keep,
          position: "parameter",
          parameterIndex: 5,
        }),
      ),
    ).toBe("unknown")
  })
})

describe("one target at 0.3.0", { timeout: 180_000 }, () => {
  let fx: Repo
  beforeAll(async () => {
    fx = await repo("0.3.0", false)
  }, 120_000)

  it("deflates a breaking change to a minor and a widening to a patch", async () => {
    fx.setSources(replace(INDEX, "/** @public */\nexport function gone(): void {}\n", ""))
    expect((await fx.run()).targets[0]).toMatchObject({
      impact: "breaking",
      requiredLevel: "minor",
      minimumRequiredVersion: "0.4.0",
    })
    fx.setSources(`${INDEX}/** @public */\nexport function added(): void {}\n`)
    expect((await fx.run()).targets[0]).toMatchObject({
      impact: "compatible",
      requiredLevel: "patch",
      minimumRequiredVersion: "0.3.1",
    })
    fx.setSources(
      replace(
        INDEX,
        "/** @beta */\nexport function betaB",
        "/** @public */\nexport function betaB",
      ),
    )
    expect((await fx.run()).targets[0]?.requiredLevel).toBe("patch")
  })
})

describe("two targets", { timeout: 240_000 }, () => {
  const unknown = (text: string) =>
    replace(text, "generic<T>(value: T): T", "generic<T, U = T>(value: T): T")
  const breakingExtra = replace(EXTRA, "/** @public */\nexport function removable(): void {}\n", "")
  const wideningExtra = `${EXTRA}/** @public */\nexport function added(): void {}\n`

  it("folds the targets into one requirement, joining their summaries", async () => {
    const fx = await repo("1.2.0", true)
    fx.setSources(INDEX, breakingExtra)
    const evidence = await fx.run()
    expect(evidence.targets.map((target) => target.target)).toEqual(["index", "extra"])
    expect(evidence.requiredLevel).toBe("major")
    expect(evidence.summary).toBe(
      evidence.targets.map((target) => `[${target.target}] ${target.summary}`).join("\n\n"),
    )

    fx.setSources(INDEX, wideningExtra)
    expect((await fx.run()).requiredLevel).toBe("minor")
    fx.setSources(INDEX, EXTRA)
    expect((await fx.run()).requiredLevel).toBe("none")
  })

  it("lets an unclassifiable target leave the requirement open unless another already needs the ceiling", async () => {
    const fx = await repo("1.2.0", true)
    fx.setSources(unknown(INDEX), EXTRA)
    let evidence = await fx.run()
    expect(evidence.requiredLevel).toBeUndefined()
    expect(evidence.minimumRequiredVersion).toBeUndefined()
    expect(evidence.changesets.satisfied).toBeNull()

    fx.setSources(unknown(INDEX), wideningExtra)
    expect((await fx.run()).requiredLevel).toBeUndefined()

    fx.setSources(unknown(INDEX), breakingExtra)
    evidence = await fx.run()
    expect(evidence.requiredLevel).toBe("major")
    expect(evidence.minimumRequiredVersion).toBe("2.0.0")
    expect(evidence.changesets.satisfied).toBe(false)
  })

  it("keeps the open requirement open below 1.0.0 unless a minor is already needed", async () => {
    const fx = await repo("0.3.0", true)
    fx.setSources(unknown(INDEX), wideningExtra)
    expect((await fx.run()).requiredLevel).toBeUndefined()

    fx.setSources(unknown(INDEX), breakingExtra)
    const evidence = await fx.run()
    expect(evidence.requiredLevel).toBe("minor")
    expect(evidence.minimumRequiredVersion).toBe("0.4.0")
  })
})
