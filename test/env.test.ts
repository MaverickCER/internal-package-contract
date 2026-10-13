import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { envContractCheck } from "../checks/env-contract.js"
import {
  DOCS_PATH,
  ISSUE_LABEL,
  SCHEMA_PATH,
  STANDARD_PACKAGE,
  inspectEnv,
  lintFriendly,
  loadEnvCap,
  run,
  syncRotationIssue,
  withoutMachine,
  isCaseless,
} from "../scripts/env/run.mjs"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-env-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), text)
}
const read = (rel: string): string => readFileSync(path.join(dir, rel), "utf8")
const schema = (expiresAt?: string, owner = true): string =>
  [
    'import { createEnv, documentEnv } from "internal-package-contract/env-cap"',
    'const s = { A_TOKEN: { default: "", validator: () => true } }',
    'export const e = createEnv(s, { name: "ci" })',
    `documentEnv(s, { category: "CI", variables: { A_TOKEN: { description: "A token.", ${owner ? 'owner: "me", ' : ""}refreshInstructions: "Replace it.", sensitivity: "secret"${expiresAt === undefined ? "" : `, expiresAt: "${expiresAt}"`} } } })`,
  ].join("\n")
const io = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}
const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

const shipped = [
  'import { createEnv, documentEnv } from "internal-package-contract/env-cap"',
  'const s = { SHIPPED_TOKEN: { default: "", validator: () => true } }',
  'export const e = createEnv(s, { name: "shipped" })',
  'documentEnv(s, { category: "Shipped", variables: { SHIPPED_TOKEN: { description: "Said once, by the standard.", refreshInstructions: "Ask the standard.", sensitivity: "secret" } } })',
].join("\n")
const install = (name = "internal-package-contract"): void => {
  write(
    `node_modules/${name}/package.json`,
    JSON.stringify({ name, envCap: { schema: "./ci/env.schema.ts" } }),
  )
  write(`node_modules/${name}/ci/env.schema.ts`, shipped)
}

describe("the contract the standard ships", () => {
  it("is part of a package's own, so the package never writes it again", async () => {
    write("package.json", JSON.stringify({ name: "consumer" }))
    install()
    write("ci/env.schema.ts", schema("2099-01-01"))
    const report = await inspectEnv({ cwd: dir })
    expect(report.state).toBe("present")
    expect(report.contracts).toBe(2)
    expect(report.expected).toContain("SHIPPED_TOKEN")
    expect(report.expected).toContain("A_TOKEN")
    expect(report.expected).toContain(
      "Source: `node_modules/internal-package-contract/ci/env.schema.ts`",
    )
    expect(report.expected).toContain("Source: `ci/env.schema.ts`")
  })

  it("is enough on its own: a package with no contract of its own still documents what the standard needs", async () => {
    write("package.json", JSON.stringify({ name: "consumer" }))
    install()
    const report = await inspectEnv({ cwd: dir })
    expect(report.state).toBe("present")
    expect(report.contracts).toBe(1)
    expect(report.stale).toEqual([DOCS_PATH])
  })

  it("says where it was read from without the machine's own path, even through a symbolic link", async () => {
    write("package.json", JSON.stringify({ name: "consumer" }))
    install()
    const link = `${dir}-link`
    symlinkSync(dir, link)
    try {
      const report = await inspectEnv({ cwd: link })
      expect(report.expected).toContain(
        "Source: `node_modules/internal-package-contract/ci/env.schema.ts`",
      )
      expect(report.expected).not.toContain(path.basename(dir))
    } finally {
      rmSync(link, { force: true })
    }
  })

  it("is not read twice by the standard itself, whose own file it is", async () => {
    write("package.json", JSON.stringify({ name: STANDARD_PACKAGE }))
    install()
    write("ci/env.schema.ts", shipped)
    const report = await inspectEnv({ cwd: dir })
    expect(report.contracts).toBe(1)
    expect(report.findings).toEqual([])
  })

  it("is quietly absent when it is not installed", async () => {
    write("package.json", JSON.stringify({ name: "consumer" }))
    expect((await inspectEnv({ cwd: dir })).state).toBe("absent")
  })

  it("is read for a package whose manifest has no name, and for a directory with no manifest", async () => {
    write("package.json", "{}")
    install()
    expect((await inspectEnv({ cwd: dir })).contracts).toBe(1)
    rmSync(path.join(dir, "package.json"))
    expect((await inspectEnv({ cwd: dir })).contracts).toBe(1)
  })
})

describe("inspectEnv", () => {
  it("finds nothing to report, and nothing stale, when the package has no contract", async () => {
    write("package.json", "{}")
    expect(await inspectEnv({ cwd: dir })).toEqual({
      state: "absent",
      contracts: 0,
      findings: [],
      stale: [],
    })
  })

  it("reads only ci/env.schema.ts, not another env.schema.ts in the package", async () => {
    write("src/env.schema.ts", schema("2020-01-01"))
    expect((await inspectEnv({ cwd: dir })).state).toBe("absent")
  })

  it("counts the contract, and calls the documentation missing until it is written", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    const report = await inspectEnv({ cwd: dir })
    expect(report).toMatchObject({
      state: "present",
      contracts: 1,
      findings: [],
      stale: [DOCS_PATH],
    })
    expect(report.expected).toContain("# Environment Variables")
  })

  it("reports a credential that has expired or is about to, with the days left, and no other family of finding", async () => {
    write(SCHEMA_PATH, schema("2020-01-01"))
    const expired = await inspectEnv({ cwd: dir })
    expect(expired.findings.map((finding) => finding.code)).toEqual(["EXPIRED"])
    write(SCHEMA_PATH, schema(daysFromNow(10)))
    const soon = await inspectEnv({ cwd: dir })
    expect(soon.findings).toHaveLength(1)
    expect(soon.findings[0]).toMatchObject({ severity: "warning", code: "EXPIRING_SOON" })
    expect(soon.findings[0]?.message).toMatch(/^"A_TOKEN" expires in (9|10) day\(s\) \(expiresAt: /)
    expect(
      (await inspectEnv({ cwd: dir })).findings.every(
        (finding) => finding.code !== "ABANDONED_CONTRACT",
      ),
    ).toBe(true)
  })

  it("is current once written, still current later with only the timestamp different, and stale when anything else differs", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    const first = await inspectEnv({ cwd: dir })
    write(DOCS_PATH, first.expected ?? "")
    expect((await inspectEnv({ cwd: dir })).stale).toEqual([])
    write(
      DOCS_PATH,
      (first.expected ?? "").replace(/^_Generated .*_$/m, "_Generated 2001-01-01T00:00:00.000Z_"),
    )
    expect((await inspectEnv({ cwd: dir })).stale).toEqual([])
    write(DOCS_PATH, `${first.expected ?? ""}\nA hand edit.\n`)
    expect((await inspectEnv({ cwd: dir })).stale).toEqual([DOCS_PATH])
  })

  it("is current right after it is written, whatever the section on what changed says", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    const first = await inspectEnv({ cwd: dir })
    expect(first.expected).toContain("## Changes since last report")
    // Written over a document from before the variable existed, the section lists it as added; once that is on
    // disk, the same contract reads "No changes." and is still the same document.
    write(DOCS_PATH, (first.expected ?? "").replaceAll("A_TOKEN", "OLD_TOKEN"))
    const added = await inspectEnv({ cwd: dir })
    expect(added.expected).toContain("- **Added:** `A_TOKEN`")
    expect(added.stale).toEqual([DOCS_PATH])
    write(DOCS_PATH, added.expected ?? "")
    const second = await inspectEnv({ cwd: dir })
    expect(second.expected).toContain("No changes.")
    expect(second.stale).toEqual([])
    const reworded = (first.expected ?? "").replace(
      /(## Changes since last report\n)[\s\S]*?(?=^## )/m,
      "$1\nSomething else entirely.\n\n",
    )
    write(DOCS_PATH, reworded)
    expect((await inspectEnv({ cwd: dir })).stale).toEqual([])
    write(DOCS_PATH, reworded.replace("A_TOKEN", "B_TOKEN"))
    expect((await inspectEnv({ cwd: dir })).stale).toEqual([DOCS_PATH])
  })

  it("reads the contract of a package with thousands of other TypeScript files", async () => {
    write("ci/env.schema.ts", schema("2099-01-01"))
    write("top.ts", "export {}")
    for (let index = 0; index < 1100; index += 1) write(`src/f${String(index)}.ts`, "export {}")
    const report = await inspectEnv({ cwd: dir })
    expect(report.state).toBe("present")
    expect(report.contracts).toBe(1)
  })

  it("takes env-cap from where it is told to", async () => {
    let asked = 0
    const real = await loadEnvCap()
    await inspectEnv({
      cwd: dir,
      load: () => {
        asked += 1
        return Promise.resolve(real)
      },
    })
    expect(asked).toBe(1)
  })
})

describe("loadEnvCap", () => {
  it("gives env-cap's build functions and the Node filesystem they need", async () => {
    const envCap = await loadEnvCap()
    for (const name of ["generateEnvArtifacts"] as const) {
      expect(typeof envCap[name], name).toBe("function")
    }
    expect(typeof envCap.fs.readFile).toBe("function")
  })
})

describe("env (the command)", () => {
  it("refuses an argument it does not know, or more than one", async () => {
    const usage = "Usage: internal-package-contract env [--check | --rotation-issue]\n"
    for (const [argv, named] of [
      [["--nope"], "--nope"],
      [["--check", "--rotation-issue"], "--rotation-issue"],
      [["--check", "extra"], "extra"],
    ] as const) {
      const h = io()
      expect(await run(argv, dir, h.io)).toBe(2)
      expect(h.err.join("")).toBe(`[env] unknown argument: ${named}\n${usage}`)
    }
  })

  it("says there is nothing to document when there is no contract, and writes nothing", async () => {
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe(
      "[env] there is no ci/env.schema.ts, so there is nothing to document (none is required).\n",
    )
    expect(existsSync(path.join(dir, "docs"))).toBe(false)
    for (const mode of ["--check", "--rotation-issue"]) {
      const quiet = io()
      expect(await run([mode], dir, quiet.io, { gh: () => ({ status: 1, stdout: "" }) })).toBe(0)
      expect(quiet.out.join("")).toContain("nothing to document")
    }
  })

  it("writes the document once, formatted, and then leaves it alone", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    const first = io()
    expect(await run([], dir, first.io)).toBe(0)
    expect(first.out.join("")).toBe(`[env] wrote ${DOCS_PATH}\n`)
    const written = read(DOCS_PATH)
    expect(written.startsWith("<!-- GENERATED FILE -- do not edit by hand.")).toBe(true)
    const again = io()
    expect(await run([], dir, again.io)).toBe(0)
    expect(again.out.join("")).toBe(`[env] ${DOCS_PATH} is already current.\n`)
    expect(read(DOCS_PATH)).toBe(written)
  })

  it("writes only the document: no manifest, nothing for the usage report, nothing outside docs", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    await run([], dir, io().io)
    expect(readdirSync(path.join(dir, "docs"))).toEqual(["ENVIRONMENT.md"])
    expect(readdirSync(dir).sort()).toEqual(["ci", "docs"])
  })

  it("writes into a docs folder that is already there", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    mkdirSync(path.join(dir, "docs"))
    write("docs/other.md", "x")
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toBe(`[env] wrote ${DOCS_PATH}\n`)
  })

  it("lists each warning, and still exits 0, when a credential is expiring", async () => {
    write(SCHEMA_PATH, schema("2020-01-01"))
    const h = io()
    expect(await run([], dir, h.io)).toBe(0)
    expect(h.out.join("")).toMatch(
      /^\[env\] warning: "A_TOKEN" .*expired.*\n\[env\] wrote docs\/ENVIRONMENT.md\n$/,
    )
  })

  it("--check exits 1, naming what is stale, and 0 when it is current", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    const stale = io()
    expect(await run(["--check"], dir, stale.io)).toBe(1)
    expect(stale.err.join("")).toBe(
      "[env] stale: docs/ENVIRONMENT.md. Run `npx internal-package-contract env` and commit the result.\n",
    )
    expect(existsSync(path.join(dir, "docs"))).toBe(false)
    await run([], dir, io().io)
    const current = io()
    expect(await run(["--check"], dir, current.io)).toBe(0)
    expect(current.out.join("")).toBe("[env] the generated files are current.\n")
  })

  it("--rotation-issue reports through the GitHub CLI and never fails the run", async () => {
    write(SCHEMA_PATH, schema("2020-01-01"))
    const calls: string[][] = []
    const h = io()
    const gh = (args: string[]) => {
      calls.push(args)
      return { status: 0, stdout: "" }
    }
    expect(await run(["--rotation-issue"], dir, h.io, { gh })).toBe(0)
    expect(h.out.join("")).toContain(
      "[env] opened an issue for 1 credential(s) due for rotation.\n",
    )
    expect(calls[0]).toEqual([
      "issue",
      "list",
      "--label",
      ISSUE_LABEL,
      "--state",
      "open",
      "--json",
      "number",
      "--jq",
      ".[0].number",
    ])
    expect(existsSync(path.join(dir, DOCS_PATH))).toBe(false)
  })
})

describe("syncRotationIssue", () => {
  const due = {
    findings: [
      { code: "EXPIRED", message: '"A" has expired.' },
      { code: "OTHER", message: "not due" },
    ],
  }
  const recorder = (answers: Record<string, { status: number; stdout: string }>) => {
    const calls: string[][] = []
    const gh = (args: string[]) => {
      calls.push(args)
      return answers[args[0] ?? ""] ?? { status: 0, stdout: "" }
    }
    return { calls, gh }
  }

  it("does not touch anything when GitHub cannot be asked", () => {
    const r = recorder({ issue: { status: 1, stdout: "" } })
    expect(syncRotationIssue(due, r.gh)).toBe(
      "could not ask GitHub about the rotation issue, so none was changed.",
    )
    expect(r.calls).toHaveLength(1)
  })

  it("opens an issue, creating its label first, listing only what is due", () => {
    const r = recorder({})
    expect(syncRotationIssue(due, r.gh)).toBe(
      "opened an issue for 1 credential(s) due for rotation.",
    )
    expect(r.calls[1]).toEqual([
      "label",
      "create",
      ISSUE_LABEL,
      "--description",
      "A credential is due for rotation",
      "--force",
    ])
    const create = r.calls[2] ?? []
    expect(create.slice(0, 7)).toEqual([
      "issue",
      "create",
      "--title",
      "Credentials are due for rotation",
      "--label",
      ISSUE_LABEL,
      "--body",
    ])
    expect(create[7]).toBe(
      'These credentials are expiring or have expired. Rotate each as its `refreshInstructions` say, then update its `expiresAt` in `ci/env.schema.ts`:\n\n- "A" has expired.',
    )
  })

  it("says so when the issue could not be opened", () => {
    const r = recorder({ issue: { status: 0, stdout: "" } })
    const gh = (args: string[]) => (args[1] === "create" ? { status: 1, stdout: "" } : r.gh(args))
    expect(syncRotationIssue(due, gh)).toBe("could not open the rotation issue.")
  })

  it("updates the issue that is open instead of opening another", () => {
    const answers = { issue: { status: 0, stdout: "12\n" } }
    const r = recorder(answers)
    expect(syncRotationIssue(due, r.gh)).toBe(
      "updated issue #12: 1 credential(s) due for rotation.",
    )
    expect(r.calls[1]?.slice(0, 4)).toEqual(["issue", "edit", "12", "--body"])
    const failing = (args: string[]) =>
      args[1] === "edit" ? { status: 1, stdout: "" } : { status: 0, stdout: "12" }
    expect(syncRotationIssue(due, failing)).toBe("could not update issue #12.")
  })

  it("closes the issue when nothing is due any more, and says nothing is due when none is open", () => {
    const none = { findings: [{ code: "OTHER", message: "x" }] }
    const open = recorder({ issue: { status: 0, stdout: "7\n" } })
    expect(syncRotationIssue(none, open.gh)).toBe(
      "no credential is due for rotation, so issue #7 was closed.",
    )
    expect(open.calls[1]).toEqual([
      "issue",
      "close",
      "7",
      "--comment",
      "Nothing is due for rotation any more.",
    ])
    const closed = recorder({})
    expect(syncRotationIssue(none, closed.gh)).toBe(
      "no credential is due for rotation, and no issue is open.",
    )
    expect(closed.calls).toHaveLength(1)
  })

  it("counts a credential that is about to expire as due, as well as one that has", () => {
    const r = recorder({})
    expect(
      syncRotationIssue({ findings: [{ code: "EXPIRING_SOON", message: "soon" }] }, r.gh),
    ).toBe("opened an issue for 1 credential(s) due for rotation.")
  })
})

describe("the EnvContract check", () => {
  const judge = (value: unknown) => envContractCheck().policy(makeContext(makeJsonResult(value)))
  it("runs the bundled script and asks for JSON", () => {
    const check = envContractCheck()
    const command = check.run as readonly string[]
    expect(command[0]).toBe("node")
    expect(command[1]).toMatch(/scripts[\\/]check-env-contract\.mjs$/)
    expect(check.output).toEqual({ format: "json" })
  })
  it("passes, saying none is required, when there is no contract", async () => {
    expect(await judge({ ok: true, state: "absent" })).toEqual({
      outcome: "pass",
      rationale: "EnvContract: there is no ci/env.schema.ts, and none is required.",
    })
  })
  it("passes when the contract is documented and current", async () => {
    expect(
      await judge({ ok: true, state: "present", contracts: 2, findings: [], stale: [] }),
    ).toEqual({
      outcome: "pass",
      rationale: "EnvContract: 2 contract(s) documented, and the generated files are current.",
    })
  })
  it("warns, never fails, listing each finding and each stale file", async () => {
    expect(
      await judge({
        ok: true,
        state: "present",
        contracts: 1,
        findings: [{ message: '"A" expires in 3 day(s).' }, { message: '"B" has expired.' }],
        stale: ["docs/ENVIRONMENT.md"],
      }),
    ).toEqual({
      outcome: "warn",
      rationale:
        'EnvContract: 3 thing(s) to look at in the environment contract:\n- "A" expires in 3 day(s).\n- "B" has expired.\n- docs/ENVIRONMENT.md is out of date; run `internal-package-contract env` and commit it.',
    })
  })
  it("warns when only the generated file is out of date, and when only a finding is", async () => {
    const stale = await judge({
      ok: true,
      state: "present",
      contracts: 1,
      stale: ["docs/ENVIRONMENT.md"],
    })
    expect(stale.outcome).toBe("warn")
    expect(stale.rationale).toContain("1 thing(s)")
    expect(stale.rationale).toBe(
      "EnvContract: 1 thing(s) to look at in the environment contract:\n- docs/ENVIRONMENT.md is out of date; run `internal-package-contract env` and commit it.",
    )
    const finding = await judge({
      ok: true,
      state: "present",
      contracts: 1,
      findings: [{ message: "x" }],
    })
    expect(finding.rationale).toBe(
      "EnvContract: 1 thing(s) to look at in the environment contract:\n- x",
    )
  })
  it("warns, with the reason, when the contract could not be read", async () => {
    expect(await judge({ ok: false, message: "could not parse" })).toEqual({
      outcome: "warn",
      rationale:
        "EnvContract: the environment contract could not be read, so it was not checked: could not parse",
    })
  })
  it("warns, naming the tool, on output that is not the envelope or a run that did not finish", async () => {
    const bad = await envContractCheck().policy(makeContext(makeResult({ stdout: "oops" })))
    expect(bad).toEqual({
      outcome: "warn",
      rationale: "EnvContract: output could not be parsed as JSON.\noops",
    })
    const stopped = await envContractCheck().policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(stopped.outcome).toBe("warn")
    expect(stopped.rationale).toBe(
      "check-env-contract did not run to completion (status: timed_out).",
    )
  })
})

describe("check-env-contract (script)", () => {
  const script = path.resolve(import.meta.dirname, "../scripts/check-env-contract.mjs")
  const envelope = () =>
    JSON.parse(spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" }).stdout)
  it("reports absent, present, and a contract it could not read, never carrying the whole document", () => {
    expect(envelope()).toEqual({ ok: true, state: "absent", contracts: 0, findings: [], stale: [] })
    write(SCHEMA_PATH, schema("2999-01-01"))
    const present = envelope()
    expect(present).toEqual({
      ok: true,
      state: "present",
      contracts: 1,
      findings: [],
      stale: [DOCS_PATH],
    })
    expect("expected" in present).toBe(false)
    write(
      SCHEMA_PATH,
      "export const e = createEnv({ A: { default: 1, validator: () => true } }, { name: 'a' })\nexport const f = createEnv({ A: { default: 1, validator: () => true } }, { name: 'a' })",
    )
    const broken = envelope()
    expect(typeof broken.ok).toBe("boolean")
  })
})

describe("env --rotation-issue, with the real GitHub CLI (a stand-in on the path)", () => {
  it("asks `gh` for the open issue in the package's folder, and reports when it cannot answer", async () => {
    const bin = mkdtempSync(path.join(tmpdir(), "ipc-env-gh-"))
    const log = path.join(bin, "calls.json")
    const fake = path.join(bin, "gh")
    const body = `require("fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n")\nprocess.exit(1)\n`
    if (process.platform === "win32") {
      // Windows runs a program by its extension, so the stand-in is a batch file that runs a script.
      writeFileSync(`${fake}.js`, body)
      writeFileSync(`${fake}.cmd`, `@"${process.execPath}" "${fake}.js" %*\r\n`)
    } else {
      writeFileSync(fake, `#!${process.execPath}\n${body}`)
      chmodSync(fake, 0o755)
    }
    const before = process.env["PATH"]
    process.env["PATH"] = `${bin}${path.delimiter}${before ?? ""}`
    try {
      write(SCHEMA_PATH, schema("2020-01-01"))
      const h = io()
      expect(await run(["--rotation-issue"], dir, h.io)).toBe(0)
      expect(h.out.join("")).toContain(
        "[env] could not ask GitHub about the rotation issue, so none was changed.\n",
      )
      expect(JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0] ?? "")).toEqual([
        "issue",
        "list",
        "--label",
        ISSUE_LABEL,
        "--state",
        "open",
        "--json",
        "number",
        "--jq",
        ".[0].number",
      ])
    } finally {
      process.env["PATH"] = before
      rmSync(bin, { recursive: true, force: true })
    }
  })
})

describe("isCaseless", () => {
  it("is true on Windows and nowhere else", () => {
    expect(isCaseless("win32")).toBe(true)
    for (const platform of ["linux", "darwin", "freebsd", "", "Win32"])
      expect(isCaseless(platform)).toBe(false)
  })
})

describe("withoutMachine", () => {
  const document = (source: string) => `Intro\n\nSource: \`${source}\`\n\nElsewhere: ${source}\n`

  it("takes the package folder out of every path, once for each way it may be written", () => {
    const text = "A /real/pkg/x.ts, B /resolved/pkg/y.ts, C /real/pkg/z.ts"
    expect(withoutMachine(text, ["/real/pkg", "/resolved/pkg"], "/", false)).toBe(
      "A x.ts, B y.ts, C z.ts",
    )
    expect(withoutMachine("keep /real/packages/x", ["/real/pkg"], "/", false)).toBe(
      "keep /real/packages/x",
    )
  })

  it("writes the source of a shipped contract with / on every platform", () => {
    const windows = document("C:\\Users\\me\\pkg\\node_modules\\ipc\\ci\\env.schema.ts")
    expect(withoutMachine(windows, ["C:\\Users\\me\\pkg"], "\\", true)).toBe(
      "Intro\n\nSource: `node_modules/ipc/ci/env.schema.ts`\n\nElsewhere: node_modules\\ipc\\ci\\env.schema.ts\n",
    )
    expect(withoutMachine(document("a/b.ts"), [], "/", false)).toBe(document("a/b.ts"))
  })

  it("matches a Windows path in either case, and only there", () => {
    expect(withoutMachine("c:\\users\\me\\pkg\\a.ts", ["C:\\Users\\Me\\pkg"], "\\", true)).toBe(
      "a.ts",
    )
    expect(withoutMachine("c:/users/me/pkg/a.ts", ["C:/Users/Me/pkg"], "/", false)).toBe(
      "c:/users/me/pkg/a.ts",
    )
  })

  it("treats the characters of a path as themselves, not as a pattern", () => {
    expect(withoutMachine("/a+b(1)/x.ts and /aab1/x.ts", ["/a+b(1)"], "/", false)).toBe(
      "x.ts and /aab1/x.ts",
    )
    expect(withoutMachine("/r[1]/x and /r1/x", ["/r[1]"], "/", false)).toBe("x and /r1/x")
    expect(withoutMachine("a.b/x and aXb/x", ["a.b"], "/", false)).toBe("x and aXb/x")
  })
})

describe("lintFriendly", () => {
  it("puts a quoted blank line between two quoted paragraphs, and only there", () => {
    expect(lintFriendly("> one\n\n> two\n\nprose\n\n> three")).toBe(
      "> one\n>\n> two\n\nprose\n\n> three",
    )
    expect(lintFriendly("> a\n>\n> b")).toBe("> a\n>\n> b")
    expect(lintFriendly(">a\n\n>b")).toBe(">a\n>\n>b")
    expect(lintFriendly("a > b\n\n> c")).toBe("a > b\n\n> c")
  })

  it("turns a bare URL into a link, in parentheses or not, and leaves a link, a code span and a word's own URL alone", () => {
    expect(lintFriendly("see (https://example.com/a) and https://example.org/b.")).toBe(
      "see (<https://example.com/a>) and <https://example.org/b.>",
    )
    expect(lintFriendly("[text](https://example.com/a)")).toBe("[text](https://example.com/a)")
    expect(lintFriendly("<https://example.com/a>")).toBe("<https://example.com/a>")
    expect(lintFriendly("run `curl https://example.com/a` now")).toBe(
      "run `curl https://example.com/a` now",
    )
    expect(lintFriendly("an http://example.com/a link")).toBe("an <http://example.com/a> link")
    expect(lintFriendly("xhttps://example.com/a")).toBe("xhttps://example.com/a")
    expect(lintFriendly("two https://a.test/x https://b.test/y")).toBe(
      "two <https://a.test/x> <https://b.test/y>",
    )
  })

  it("writes a document the standard's Markdown check accepts", async () => {
    write(SCHEMA_PATH, schema("2999-01-01"))
    await run([], dir, io().io)
    const text = read(DOCS_PATH)
    expect(text).not.toMatch(/^>.*\n\n>/m)
    expect(text).not.toMatch(/[^<\]]\(?https?:\/\//)
  })
})
