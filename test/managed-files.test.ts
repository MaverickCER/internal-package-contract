import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MANAGED_FILE_SCHEMA, managedFileId, managedFilesCheck } from "../checks/managed-files.js"
import {
  COPIES,
  copyHeader,
  enrolledCopies,
  inspectManaged,
  MANAGED,
  meaning,
  pinOf,
  renderManaged,
} from "../scripts/managed-files/inspect.mjs"
import { run, unifiedDiff } from "../scripts/managed-files/sync.mjs"
import { REQUIRED_FIELDS } from "../scripts/exception-fields.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

const packageRoot = path.resolve(import.meta.dirname, "..")
const SHA = "a".repeat(40)
const SHA2 = "b".repeat(40)
const PINS = { ipcRef: "v1.2.3", ipcSha: SHA }

describe("MANAGED", () => {
  it("lists exactly the files this package owns, each with a template that exists", () => {
    expect(MANAGED.map((file) => file.to)).toEqual([
      ".github/workflows/release.yml",
      ".github/workflows/sync-internal-package-contract.yml",
      ".changeset/config.json",
    ])
    for (const file of MANAGED) expect(existsSync(path.join(packageRoot, file.from))).toBe(true)
  })
})

describe("meaning", () => {
  it("ignores comments, blank lines, trailing comments and the pinned commit of a workflow", () => {
    const a = `# header\nname: Release\n\non:\n  push: # when\n    branches: [main]\nuses: x/y/z.yml@${SHA} # v1.0.0\n`
    const b = `name: Release\non:\n  push:\n    branches: [main]\n    # a note\nuses: x/y/z.yml@${SHA2} # v2.0.0\n`
    expect(meaning("workflow", a)).toBe(meaning("workflow", b))
    expect(meaning("workflow", a)).toBe(
      "name: Release\non:\n  push:\n    branches: [main]\nuses: x/y/z.yml@PIN",
    )
  })
  it("treats an unfilled pin placeholder as a pin", () => {
    expect(meaning("workflow", "uses: x@{{ipcSha}} # {{ipcRef}}\n")).toBe("uses: x@PIN")
  })
  it("sees a change to what a workflow does", () => {
    expect(meaning("workflow", "permissions:\n  id-token: write\n")).not.toBe(
      meaning("workflow", "permissions:\n  id-token: read\n"),
    )
    expect(meaning("workflow", "uses: a/b@" + SHA)).not.toBe(
      meaning("workflow", "uses: a/c@" + SHA),
    )
  })
  it("compares JSON by value, not by formatting or key spacing", () => {
    expect(meaning("json", '{ "a": 1,\n "b": [1, 2] }')).toBe(meaning("json", '{"a":1,"b":[1,2]}'))
    expect(meaning("json", '{"a":1}')).not.toBe(meaning("json", '{"a":2}'))
  })
})

describe("pinOf and renderManaged", () => {
  it("reads the commit and version a workflow is pinned at", () => {
    expect(pinOf(`uses: o/r/.github/workflows/x.yml@${SHA} # v0.11.0`)).toEqual({
      ipcRef: "v0.11.0",
      ipcSha: SHA,
    })
    expect(pinOf("uses: o/r@main")).toBeUndefined()
    expect(pinOf(`uses: o/r@${SHA}`)).toBeUndefined()
  })
  it("fills the pin placeholders in a template", () => {
    expect(renderManaged("uses: x@{{ipcSha}} # {{ipcRef}}", PINS)).toBe(`uses: x@${SHA} # v1.2.3`)
  })
})

describe("inspectManaged", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-managed-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  const states = () =>
    Object.fromEntries(
      inspectManaged({ cwd: dir, packageRoot, pins: PINS }).map((entry) => [entry.to, entry.state]),
    )
  const writeCurrent = () => {
    for (const entry of inspectManaged({ cwd: dir, packageRoot, pins: PINS }))
      put(entry.to, entry.wanted)
  }

  it("reports every file missing in an empty repository, with the text it would write", () => {
    const entries = inspectManaged({ cwd: dir, packageRoot, pins: PINS })
    expect(entries.map((entry) => entry.state)).toEqual(["missing", "missing", "missing"])
    expect(entries[0]?.have).toBeUndefined()
    expect(entries[0]?.wanted).toContain(`@${SHA} # v1.2.3`)
  })
  it("reports current once the files are written, even with different comments and a newer pin", () => {
    writeCurrent()
    expect(states()).toEqual({
      ".github/workflows/release.yml": "current",
      ".github/workflows/sync-internal-package-contract.yml": "current",
      ".changeset/config.json": "current",
    })
    const release = readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8")
    put(
      ".github/workflows/release.yml",
      `# my own header\n${release.replaceAll(SHA, SHA2).replaceAll("v1.2.3", "v9.9.9")}\n\n`,
    )
    expect(states()[".github/workflows/release.yml"]).toBe("current")
  })
  it("reports drift when a file's meaning changes, and shows the template for the consumer's own pin", () => {
    writeCurrent()
    const release = readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8")
    put(
      ".github/workflows/release.yml",
      release.replace("id-token: write", "id-token: none").replaceAll(SHA, SHA2),
    )
    const entry = inspectManaged({ cwd: dir, packageRoot, pins: PINS }).find((e) =>
      e.to.endsWith("release.yml"),
    )
    expect(entry?.state).toBe("drifted")
    expect(entry?.wanted).toContain(`@${SHA2} # v1.2.3`)
    expect(entry?.have).toContain("id-token: none")
  })
})

describe("unifiedDiff", () => {
  it("shows what changes to get from the consumer's file to the standard's", () => {
    const diff = unifiedDiff("a\nb\n", "a\nc\n")
    expect(diff).toContain("@@")
    expect(diff).toContain("-c")
    expect(diff).toContain("+b")
    expect(diff).not.toContain("diff --git")
  })
  it("says so when the files do not differ", () => {
    expect(unifiedDiff("same\n", "same\n")).toBe("(the files differ)\n")
  })
})

describe("sync (run)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-sync-"))
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/internal-package-contract": {
            resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`,
          },
        },
      }),
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const sink = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
  }
  const sync = (...args: string[]) => {
    const s = sink()
    return { code: run(args, dir, packageRoot, s.io), out: s.out.join(""), err: s.err.join("") }
  }

  it("reports missing files and changes nothing without --apply", () => {
    const result = sync()
    expect(result.code).toBe(1)
    expect(result.out).toContain("missing  .github/workflows/release.yml")
    expect(result.out).toContain("Run `internal-package-contract sync --apply`")
    expect(existsSync(path.join(dir, ".github/workflows/release.yml"))).toBe(false)
  })
  it("writes the missing files with --apply, pinned to the lockfile's commit, and is then a no-op", () => {
    const first = sync("--apply")
    expect(first.code).toBe(0)
    expect(first.out).toContain("written  .github/workflows/release.yml")
    expect(readFileSync(path.join(dir, ".github/workflows/release.yml"), "utf8")).toContain(
      `@${SHA} # v`,
    )
    const before = readFileSync(path.join(dir, ".changeset/config.json"), "utf8")
    const second = sync("--apply")
    expect(second.code).toBe(0)
    expect(second.out).toBe(
      "current  .github/workflows/release.yml\ncurrent  .github/workflows/sync-internal-package-contract.yml\ncurrent  .changeset/config.json\n",
    )
    expect(readFileSync(path.join(dir, ".changeset/config.json"), "utf8")).toBe(before)
    expect(sync().code).toBe(0)
  })
  it("will not write a pinned workflow when there is no commit to pin it to", () => {
    rmSync(path.join(dir, "package-lock.json"))
    const result = sync("--apply")
    expect(result.code).toBe(1)
    expect(result.out).toContain(
      "missing  .github/workflows/release.yml (no commit of internal-package-contract to pin it to: run npm install, then sync again)",
    )
    expect(existsSync(path.join(dir, ".github/workflows/release.yml"))).toBe(false)
    expect(existsSync(path.join(dir, ".changeset/config.json"))).toBe(true)
  })
  it("shows a drifted file and leaves it alone unless --update is given", () => {
    sync("--apply")
    const file = path.join(dir, ".github/workflows/release.yml")
    const original = readFileSync(file, "utf8")
    const edited = original.replace("id-token: write", "id-token: none")
    writeFileSync(file, edited)
    const shown = sync("--apply")
    expect(shown.code).toBe(1)
    expect(shown.out).toContain("drifted  .github/workflows/release.yml")
    expect(shown.out).toContain("-      id-token: none")
    expect(shown.out).toContain("+      id-token: write")
    expect(shown.out).toContain("Drifted files were left as they are; add --update")
    expect(readFileSync(file, "utf8")).toBe(edited)
    const updated = sync("--apply", "--update")
    expect(updated.code).toBe(0)
    expect(updated.out).toContain("updated  .github/workflows/release.yml")
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(sync().code).toBe(0)
  })
  it("rejects an unknown flag and --update without --apply", () => {
    expect(sync("--nope")).toMatchObject({ code: 2 })
    expect(sync("--nope").err).toBe(
      "[sync] unknown argument: --nope\nUsage: internal-package-contract sync [--apply [--update]] [--add <copy>]\n",
    )
    expect(sync("--update").code).toBe(2)
    expect(sync("--update").err).toBe(
      "[sync] --update needs --apply.\nUsage: internal-package-contract sync [--apply [--update]] [--add <copy>]\n",
    )
  })
  it("is reachable as `internal-package-contract sync`", () => {
    const bin = path.join(packageRoot, "bin", "contract.mjs")
    const result = spawnSync(process.execPath, [bin, "sync"], { cwd: dir, encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("missing  .github/workflows/release.yml")
  })
})

const NOW = new Date("2026-10-11T12:00:00Z")
const complete = (extra: Record<string, unknown> = {}) => ({
  id: "managed-file:.github/workflows/release.yml",
  version: 2,
  path: ".github/workflows/release.yml",
  ...Object.fromEntries(REQUIRED_FIELDS.map((key) => [key, `${key} written`])),
  expires: "",
  ...extra,
})
const DRIFT = {
  ok: true,
  state: "problem",
  files: [{ to: ".github/workflows/release.yml", state: "drifted" }],
}

describe("managedFilesCheck (policy)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-managed-check-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const registry = (records: unknown[]) => {
    mkdirSync(path.join(dir, ".repo-contract", "exceptions"), { recursive: true })
    writeFileSync(
      path.join(dir, ".repo-contract", "exceptions", "managed-files.json"),
      JSON.stringify({ exceptions: records }),
    )
  }
  const judge = (value: unknown) =>
    managedFilesCheck({ cwd: dir, now: NOW }).policy(makeContext(makeJsonResult(value)))

  it("runs the bundled script and asks for JSON", () => {
    const check = managedFilesCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-managed-files\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes a private package and one whose files match", async () => {
    expect((await judge({ ok: true, state: "exempt", files: [] })).rationale).toBe(
      "ManagedFiles: this package is private, so it owns no files in a consumer.",
    )
    expect(await judge({ ok: true, state: "current", files: [] })).toEqual({
      outcome: "pass",
      rationale: "ManagedFiles: every file this package owns matches the standard.",
    })
  })
  it("fails drift with no record, naming the id to add and how to fix it", async () => {
    const result = await judge(DRIFT)
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe(
      [
        "ManagedFiles: 1 file(s) this package owns do not match the standard. Run `internal-package-contract sync` to see the difference and `sync --apply --update` to restore them, or record why each differs in .repo-contract/exceptions/managed-files.json:",
        "- .github/workflows/release.yml is drifted; add managed-file:.github/workflows/release.yml to accept it",
      ].join("\n"),
    )
  })
  it("fails a missing file the same way, and an incomplete or expired record", async () => {
    const missing = await judge({
      ok: true,
      state: "problem",
      files: [{ to: ".changeset/config.json", state: "missing" }],
    })
    expect(missing.rationale).toContain(
      "- .changeset/config.json is missing; add managed-file:.changeset/config.json to accept it",
    )
    registry([complete({ constraint: "" })])
    expect((await judge(DRIFT)).rationale).toContain(
      "complete managed-file:.github/workflows/release.yml (missing: constraint) to accept it",
    )
    registry([complete({ expires: "2026-01-01" })])
    expect((await judge(DRIFT)).rationale).toContain("expires (2026-01-01 has passed)")
  })
  it("passes drift a complete record accepts, listing it", async () => {
    registry([complete()])
    expect(await judge(DRIFT)).toEqual({
      outcome: "pass",
      rationale: [
        "ManagedFiles: 1 managed file(s) differ from the standard, each accepted by a reviewed record:",
        "- .github/workflows/release.yml is drifted, accepted by managed-file:.github/workflows/release.yml",
      ].join("\n"),
    })
  })
  it("judges the supplied clock, not the real one", async () => {
    registry([complete({ expires: "2026-10-12" })])
    const result = await managedFilesCheck({
      cwd: dir,
      now: new Date("2026-10-13T00:00:00Z"),
    }).policy(makeContext(makeJsonResult(DRIFT)))
    expect(result.outcome).toBe("fail")
  })
  it("fails with every problem when the registry is malformed", async () => {
    registry([
      complete({ path: "other", id: "managed-file:.github/workflows/release.yml" }),
      complete({ path: "" }),
    ])
    const result = await judge(DRIFT)
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "ManagedFiles: .repo-contract/exceptions/managed-files.json failed to load, so a drifted file cannot be judged:",
    )
    expect(result.rationale).toContain("- exceptions[1].path must be a non-empty string.")
  })
  it("fails closed on output that is not the envelope or a run that did not finish", async () => {
    const bad = await managedFilesCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad.rationale).toBe("ManagedFiles: output could not be parsed as JSON.\noops")
    const stuck = await managedFilesCheck().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(stuck.rationale).toBe(
      "check-managed-files did not run to completion (status: timed_out).",
    )
  })
})

describe("MANAGED_FILE_SCHEMA", () => {
  const core = { id: "managed-file:a.yml", version: 2 as const, justification: "j" }
  it("declares its namespace and key, derives the id from the path", () => {
    expect(MANAGED_FILE_SCHEMA.namespace).toBe("managed-file:")
    expect(MANAGED_FILE_SCHEMA.metadataKeys).toEqual(["path"])
    expect(managedFileId("a.yml")).toBe("managed-file:a.yml")
    expect(MANAGED_FILE_SCHEMA.validateRecord(core, { path: "a.yml" }, 0, [])).toEqual({
      id: core.id,
      version: 1,
      justification: "j",
      path: "a.yml",
    })
  })
  it("rejects a missing path and an id that does not match it", () => {
    const errors: string[] = []
    expect(MANAGED_FILE_SCHEMA.validateRecord(core, {}, 2, errors)).toBeUndefined()
    expect(MANAGED_FILE_SCHEMA.validateRecord(core, { path: "b.yml" }, 3, errors)).toBeUndefined()
    expect(errors).toEqual([
      "exceptions[2].path must be a non-empty string.",
      'exceptions[3].id "managed-file:a.yml" does not match the id derived from its own path ("managed-file:b.yml").',
    ])
  })
})

describe("check-managed-files (script)", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-managed-script-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const script = path.resolve(import.meta.dirname, "../scripts/check-managed-files.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
  it("exempts a private package", () => {
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ private: true }))
    expect(envelope()).toEqual({ ok: true, state: "exempt", files: [] })
  })
  it("lists the missing files of a public package, with no package.json needed", () => {
    expect(envelope()).toEqual({
      ok: true,
      state: "problem",
      files: [
        { to: ".github/workflows/release.yml", state: "missing" },
        { to: ".github/workflows/sync-internal-package-contract.yml", state: "missing" },
        { to: ".changeset/config.json", state: "missing" },
      ],
    })
  })
  it("reports current once the files exist as the standard has them", () => {
    for (const entry of inspectManaged({ cwd: dir, packageRoot, pins: PINS })) {
      mkdirSync(path.dirname(path.join(dir, entry.to)), { recursive: true })
      writeFileSync(path.join(dir, entry.to), entry.wanted)
    }
    expect(envelope()).toEqual({ ok: true, state: "current", files: [] })
  })
})

describe("meaning -- comment handling", () => {
  it("drops a comment-only line at any indentation and a trailing comment", () => {
    expect(meaning("workflow", "# top\n  # indented\n\tkey: v # trailing\nnext: 1\n")).toBe(
      "\tkey: v\nnext: 1",
    )
  })
  it("keeps a hash that is part of a value", () => {
    expect(meaning("workflow", "url: https://x.test/a#frag\nname: a#b\n")).toBe(
      "url: https://x.test/a#frag\nname: a#b",
    )
  })
  it("drops blank lines and trailing spaces", () => {
    expect(meaning("workflow", "a: 1   \n\n   \nb: 2\n")).toBe("a: 1\nb: 2")
  })
})

describe("unifiedDiff -- exact output and cleanup", () => {
  it("returns the hunk from the consumer's file to the standard's, exactly", () => {
    expect(unifiedDiff("a\nb\n", "a\nc\n")).toBe("@@ -1,2 +1,2 @@\n a\n-c\n+b\n")
  })
  it("leaves no temporary directory behind", () => {
    const leftovers = () =>
      readdirSync(tmpdir()).filter((name) => name.startsWith("ipc-sync-diff-")).length
    const before = leftovers()
    unifiedDiff("x\n", "y\n")
    unifiedDiff("same\n", "same\n")
    expect(leftovers()).toBe(before)
  })
})

describe("sync -- exact lines", () => {
  it("reports a missing file with no suffix when a commit is known to pin it to", () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), "ipc-sync-exact-"))
    try {
      writeFileSync(
        path.join(dir2, "package-lock.json"),
        JSON.stringify({
          packages: {
            "node_modules/internal-package-contract": {
              resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`,
            },
          },
        }),
      )
      const out: string[] = []
      run([], dir2, packageRoot, { out: (t) => out.push(t), err: () => {} })
      expect(out[0]).toBe("missing  .github/workflows/release.yml\n")
      expect(out[2]).toBe("missing  .changeset/config.json\n")
    } finally {
      rmSync(dir2, { recursive: true, force: true })
    }
  })
})

describe("managedFilesCheck (policy) -- exact results", () => {
  let dir3: string
  beforeEach(() => {
    dir3 = mkdtempSync(path.join(tmpdir(), "ipc-managed-exact-"))
  })
  afterEach(() => rmSync(dir3, { recursive: true, force: true }))
  const at = (records: unknown[]) => {
    mkdirSync(path.join(dir3, ".repo-contract", "exceptions"), { recursive: true })
    writeFileSync(
      path.join(dir3, ".repo-contract", "exceptions", "managed-files.json"),
      JSON.stringify({ exceptions: records }),
    )
  }
  const judge3 = (value: unknown) =>
    managedFilesCheck({ cwd: dir3, now: NOW }).policy(makeContext(makeJsonResult(value)))

  it("passes a private package with a pass outcome", async () => {
    expect(await judge3({ ok: true, state: "exempt", files: [] })).toEqual({
      outcome: "pass",
      rationale: "ManagedFiles: this package is private, so it owns no files in a consumer.",
    })
  })
  it("lists every registry error on its own line, in order", async () => {
    at([complete({ path: "" }), complete({ path: "" })])
    expect((await judge3(DRIFT)).rationale).toBe(
      [
        "ManagedFiles: .repo-contract/exceptions/managed-files.json failed to load, so a drifted file cannot be judged:",
        "- exceptions[0].path must be a non-empty string.",
        "- exceptions[1].path must be a non-empty string.",
      ].join("\n"),
    )
  })
  it("lists several missing fields in one record, comma separated", async () => {
    at([complete({ constraint: "", residualRisk: "" })])
    expect((await judge3(DRIFT)).rationale).toContain(
      "complete managed-file:.github/workflows/release.yml (missing: constraint, residualRisk) to accept it",
    )
  })
})

describe("managed copies of shared code", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-copies-"))
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }))
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/internal-package-contract": {
            resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`,
          },
        },
      }),
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const sink = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
  }
  const sync = (...args: string[]) => {
    const s = sink()
    return { code: run(args, dir, packageRoot, s.io), out: s.out.join(""), err: s.err.join("") }
  }
  const copyPath = path.join("src", "_ipc", "generated-banner.ts")
  const canonical = () =>
    readFileSync(path.join(packageRoot, "runtime", "generated-banner.ts"), "utf8")

  it("lists the copies this package offers, and a header that says where to change them", () => {
    expect(COPIES).toEqual([
      {
        name: "generated-banner",
        from: "runtime/generated-banner.ts",
        to: "src/_ipc/generated-banner.ts",
      },
    ])
    expect(copyHeader("runtime/x.ts")).toBe(
      "// Managed by internal-package-contract. Do not edit this file: change runtime/x.ts in the standard and run `internal-package-contract sync`.\n\n",
    )
  })
  it("reads the enrolled copies from package.json, and nothing from a missing or odd one", () => {
    expect(enrolledCopies(dir)).toEqual([])
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { copies: ["a", 5, "b"] } }),
    )
    expect(enrolledCopies(dir)).toEqual(["a", "b"])
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { copies: "a" } }),
    )
    expect(enrolledCopies(dir)).toEqual([])
    rmSync(path.join(dir, "package.json"))
    expect(enrolledCopies(dir)).toEqual([])
  })
  it("does not inspect a copy the package has not enrolled in", () => {
    const targets = inspectManaged({ cwd: dir, packageRoot, pins: PINS }).map((entry) => entry.to)
    expect(targets).not.toContain("src/_ipc/generated-banner.ts")
  })
  it("compares an enrolled copy byte for byte, with the header and the canonical text", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ "internal-package-contract": { copies: ["generated-banner"] } }),
    )
    const entry = inspectManaged({ cwd: dir, packageRoot, pins: PINS }).find(
      (e) => e.to === "src/_ipc/generated-banner.ts",
    )
    expect(entry?.state).toBe("missing")
    expect(entry?.wanted).toBe(`${copyHeader("runtime/generated-banner.ts")}${canonical()}`)
    expect(meaning("copy", "a  b\n")).toBe("a  b\n")
  })
  it("enrolls, writes the copy, and is then a no-op", () => {
    const first = sync("--add", "generated-banner")
    expect(first.code).toBe(0)
    expect(first.out).toContain("enrolled generated-banner in package.json")
    expect(first.out).toContain("written  src/_ipc/generated-banner.ts")
    expect(
      JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))["internal-package-contract"],
    ).toEqual({
      copies: ["generated-banner"],
    })
    expect(readFileSync(path.join(dir, copyPath), "utf8")).toBe(
      `${copyHeader("runtime/generated-banner.ts")}${canonical()}`,
    )
    const again = sync("--add", "generated-banner")
    expect(again.out).toContain("current  src/_ipc/generated-banner.ts")
    expect(
      JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))["internal-package-contract"]
        .copies,
    ).toEqual(["generated-banner"])
  })
  it("reports a hand-edited copy as drifted and restores it only with --update", () => {
    sync("--add", "generated-banner")
    const file = path.join(dir, copyPath)
    const original = readFileSync(file, "utf8")
    writeFileSync(file, `${original}\n// hand edit\n`)
    const shown = sync()
    expect(shown.code).toBe(1)
    expect(shown.out).toContain("drifted  src/_ipc/generated-banner.ts")
    expect(shown.out).toContain("-// hand edit")
    expect(sync("--apply", "--update").code).toBe(0)
    expect(readFileSync(file, "utf8")).toBe(original)
  })
  it("keeps other package.json settings when enrolling, and rejects an unknown copy", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", "internal-package-contract": { other: 1 } }),
    )
    sync("--add", "generated-banner")
    expect(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))).toEqual({
      name: "x",
      "internal-package-contract": { other: 1, copies: ["generated-banner"] },
    })
    const unknown = sync("--add", "nope")
    expect(unknown.code).toBe(2)
    expect(unknown.err).toBe(
      "[sync] unknown managed copy: nope. Available: generated-banner.\nUsage: internal-package-contract sync [--apply [--update]] [--add <copy>]\n",
    )
    expect(sync("--add").err).toContain("unknown managed copy: (none given).")
  })
})

describe("sync --add with several managed copies", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-copies-many-"))
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }))
    writeFileSync(
      path.join(dir, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/internal-package-contract": {
            resolved: `git+ssh://git@github.com/MaverickCER/internal-package-contract.git#${SHA}`,
          },
        },
      }),
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const offered = [{ name: "generated-banner" }, { name: "other-copy" }]
  const sync = (...args: string[]) => {
    const out: string[] = []
    const err: string[] = []
    const code = run(
      args,
      dir,
      packageRoot,
      { out: (t) => out.push(t), err: (t) => err.push(t) },
      offered,
    )
    return { code, out: out.join(""), err: err.join("") }
  }
  const enrolled = () =>
    JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))["internal-package-contract"]
      ?.copies
  it("lists every copy on offer, comma separated, when the name is unknown", () => {
    expect(sync("--add", "nope").err).toBe(
      "[sync] unknown managed copy: nope. Available: generated-banner, other-copy.\nUsage: internal-package-contract sync [--apply [--update]] [--add <copy>]\n",
    )
  })
  it("accepts any of the copies on offer", () => {
    expect(sync("--add", "generated-banner").code).toBe(0)
    expect(enrolled()).toEqual(["generated-banner"])
  })
  it("keeps the enrolled copies sorted and without duplicates", () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        "internal-package-contract": { copies: ["other-copy", "generated-banner"] },
      }),
    )
    sync("--add", "generated-banner")
    expect(enrolled()).toEqual(["generated-banner", "other-copy"])
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
    manifest["internal-package-contract"].copies = ["z-copy"]
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest))
    sync("--add", "generated-banner")
    expect(enrolled()).toEqual(["generated-banner", "z-copy"])
  })
  it("lets --update accompany --add without --apply, since adding writes", () => {
    sync("--add", "generated-banner")
    const file = path.join(dir, "src", "_ipc", "generated-banner.ts")
    const original = readFileSync(file, "utf8")
    writeFileSync(file, `${original}\n// edit\n`)
    const result = sync("--add", "generated-banner", "--update")
    expect(result.code).toBe(0)
    expect(result.out).toContain("updated  src/_ipc/generated-banner.ts")
    expect(readFileSync(file, "utf8")).toBe(original)
  })
})
