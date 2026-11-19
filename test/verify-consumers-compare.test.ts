import { spawnSync } from "node:child_process"
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  ALLOWED_DIFFERENCES,
  compareVerdicts,
  renderComparison,
} from "../scripts/verify-consumers/compare.mjs"
import {
  STANDARD,
  run,
  undeclaredDependencies,
  workspaceOf,
} from "../scripts/verify-consumers/run.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-verify-compare-test-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const put = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}
const verdicts = (
  entries: Record<string, [string, string?]>,
): Map<string, { outcome: string; rationale: string }> =>
  new Map(
    Object.entries(entries).map(([id, [outcome, rationale]]) => [
      id,
      { outcome, rationale: rationale ?? "" },
    ]),
  )

describe("compareVerdicts", () => {
  it("calls an equal verdict with equal words the same, and only reworded when the words moved", () => {
    const rows = compareVerdicts(
      verdicts({ Lint: ["pass", "0 problems."], Duplication: ["pass", "Duplication: 0.4%."] }),
      verdicts({ Lint: ["pass", "0 problems."], Duplication: ["pass", "jscpd found 0.4%."] }),
    )
    expect(rows).toEqual([
      { id: "Lint", before: "pass", after: "pass", status: "same" },
      { id: "Duplication", before: "pass", after: "pass", status: "reworded" },
    ])
  })

  it("calls SecurityDeps going from fail to warn a change: IPC keeps its own, stricter check", () => {
    const [row] = compareVerdicts(
      verdicts({ SecurityDeps: ["fail", "an info advisory has no record."] }),
      verdicts({ SecurityDeps: ["warn", "an info advisory."] }),
    )
    expect(row).toEqual({
      id: "SecurityDeps",
      before: "fail",
      after: "warn",
      status: "changed",
      rationale: "an info advisory.",
    })
    expect(ALLOWED_DIFFERENCES.some(({ ids }) => ids !== "*" && ids.includes("SecurityDeps"))).toBe(
      false,
    )
  })

  it("states each decision in its reason, with no reference a reader cannot look up", () => {
    for (const { reason } of ALLOWED_DIFFERENCES) expect(reason).not.toMatch(/decision \d/)
  })

  it("allows a library check to pass as not applicable on a private package, and nothing else to start passing", () => {
    const notApplicable =
      'Packaging is not applicable: package.json sets "private": true, so the package is never published.'
    expect(
      compareVerdicts(
        verdicts({ Packaging: ["fail"] }),
        verdicts({ Packaging: ["pass", notApplicable] }),
      )[0]?.status,
    ).toBe("allowed")
    expect(
      compareVerdicts(
        verdicts({ Packaging: ["fail"] }),
        verdicts({ Packaging: ["pass", "fine."] }),
      )[0]?.status,
    ).toBe("changed")
    expect(
      compareVerdicts(verdicts({ Lint: ["fail"] }), verdicts({ Lint: ["pass", notApplicable] }))[0]
        ?.status,
    ).toBe("changed")
  })

  it("calls every other verdict change a change, in either direction", () => {
    const rows = compareVerdicts(
      verdicts({ Lint: ["pass"], Format: ["fail"], SecurityDeps: ["pass"] }),
      verdicts({ Lint: ["fail"], Format: ["pass"], SecurityDeps: ["warn"] }),
    )
    expect(rows.map((row) => row.status)).toEqual(["changed", "changed", "changed"])
  })

  it("allows a new check that passes, and calls a new failure or a vanished check a change", () => {
    const rows = compareVerdicts(
      verdicts({ Gone: ["pass"] }),
      verdicts({ Fresh: ["pass"], Broken: ["fail"] }),
    )
    expect(rows).toEqual([
      expect.objectContaining({ id: "Fresh", before: "absent", after: "pass", status: "allowed" }),
      expect.objectContaining({ id: "Broken", before: "absent", after: "fail", status: "changed" }),
      expect.objectContaining({ id: "Gone", before: "pass", after: "absent", status: "changed" }),
    ])
    // A changed row carries the rationale that is still there: the new one, or the vanished check's last.
    const named = compareVerdicts(
      verdicts({ Gone: ["pass", "was fine."] }),
      verdicts({ Broken: ["fail", "now broken."] }),
    )
    expect(named.map(({ rationale }) => rationale)).toEqual(["now broken.", "was fine."])
  })

  it("lists every allowed difference with the decision behind it", () => {
    expect(ALLOWED_DIFFERENCES.length).toBeGreaterThan(0)
    for (const difference of ALLOWED_DIFFERENCES) expect(difference.reason).not.toBe("")
  })
})

describe("renderComparison", () => {
  it("prints one Markdown row per check, with the reason for an allowed difference", () => {
    const text = renderComparison([
      { id: "Lint", before: "pass", after: "pass", status: "same" },
      { id: "SecurityDeps", before: "fail", after: "warn", status: "allowed", reason: "why." },
    ])
    expect(text).toBe(
      [
        "| Check | Installed standard | This standard | Verdict |",
        "| --- | --- | --- | --- |",
        "| Lint | pass | pass | same |",
        "| SecurityDeps | fail | warn | allowed: why. |",
        "",
      ].join("\n"),
    )
  })
})

describe("workspaceOf with the standard's dependencies hoisted", () => {
  it("puts the standard's copy of each package the checkout does not declare at the top, bins included", () => {
    put("consumer/package.json", JSON.stringify({ devDependencies: { own: "^1.0.0" } }))
    put("consumer/node_modules/own/package.json", JSON.stringify({ version: "1.0.0" }))
    // Older than the standard wants, so an install would also nest it; hoisted, it is not nested again.
    put("consumer/node_modules/tool/package.json", JSON.stringify({ version: "0.9.0" }))
    put("consumer/node_modules/tool/bin.js", "old")
    put("consumer/node_modules/@s/kept/package.json", "{}")
    put("consumer/node_modules/@s/scoped/package.json", JSON.stringify({ version: "1.0.0" }))
    put(`consumer/node_modules/${STANDARD}/package.json`, "{}")
    mkdirSync(path.join(root, "consumer/node_modules/.bin"))
    symlinkSync("../tool/bin.js", path.join(root, "consumer/node_modules/.bin/tool"))
    put(
      "standard/package.json",
      JSON.stringify({
        name: STANDARD,
        files: ["bin"],
        dependencies: { own: "^1.0.0", tool: "^1.0.0", "@s/scoped": "^1.0.0" },
      }),
    )
    put("standard/bin/contract.mjs", "")
    for (const name of ["own", "tool", "@s/scoped"]) {
      put(`standard/node_modules/${name}/package.json`, JSON.stringify({ version: "1.0.0" }))
    }
    put("standard/node_modules/tool/bin.js", "new")
    const consumer = path.join(root, "consumer")
    const standard = path.join(root, "standard")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const work = workspaceOf({ consumer, standard, hoist: true })
    try {
      const modules = path.join(work, "node_modules")
      const target = (name: string): string => realpathSync(path.join(modules, name))
      expect(target("tool")).toBe(realpathSync(path.join(standard, "node_modules/tool")))
      expect(target("@s/scoped")).toBe(realpathSync(path.join(standard, "node_modules/@s/scoped")))
      // What the checkout declares stays its own, and so do its other packages.
      expect(target("own")).toBe(realpathSync(path.join(consumer, "node_modules/own")))
      expect(target("@s/kept")).toBe(realpathSync(path.join(consumer, "node_modules/@s/kept")))
      expect(lstatSync(path.join(modules, "@s")).isSymbolicLink()).toBe(false)
      // A bin resolves inside the copy, so it reaches the hoisted package.
      expect(lstatSync(path.join(modules, ".bin")).isSymbolicLink()).toBe(false)
      expect(readlinkSync(path.join(modules, ".bin/tool"))).toBe("../tool/bin.js")
      expect(readFileSync(path.join(modules, ".bin/tool"), "utf8")).toBe("new")
      // Nothing hoisted is nested again under the standard.
      expect(readdirSync(path.join(modules, STANDARD))).toEqual(["bin", "package.json"])
      // The checkout itself is untouched.
      expect(readFileSync(path.join(consumer, "node_modules/.bin/tool"), "utf8")).toBe("old")
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
  it("hoists two packages of one scope, with no .bin in the checkout, and keeps a linked package's target", () => {
    put("consumer/package.json", "{}")
    put(`consumer/node_modules/${STANDARD}/package.json`, "{}")
    put("shared/linked/package.json", "{}")
    mkdirSync(path.join(root, "consumer/node_modules/@s"))
    // A relative link that leaves the checkout, as npm link makes: the copy must reach the same folder.
    symlinkSync("../../../shared/linked", path.join(root, "consumer/node_modules/@s/linked"))
    put(
      "standard/package.json",
      JSON.stringify({
        name: STANDARD,
        files: ["bin"],
        dependencies: { "@s/a": "^1.0.0", "@s/b": "^1.0.0" },
      }),
    )
    put("standard/bin/contract.mjs", "")
    for (const name of ["@s/a", "@s/b"]) {
      put(`standard/node_modules/${name}/package.json`, JSON.stringify({ version: "1.0.0" }))
    }
    const consumer = path.join(root, "consumer")
    const standard = path.join(root, "standard")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const work = workspaceOf({ consumer, standard, hoist: true })
    try {
      const modules = path.join(work, "node_modules")
      for (const name of ["@s/a", "@s/b"]) {
        expect(realpathSync(path.join(modules, name))).toBe(
          realpathSync(path.join(standard, "node_modules", name)),
        )
      }
      expect(realpathSync(path.join(modules, "@s/linked"))).toBe(
        realpathSync(path.join(root, "shared/linked")),
      )
      expect(readdirSync(path.join(modules, ".bin"))).toEqual([])
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("hoists nothing without a standard to install, even when asked to", () => {
    put("consumer/package.json", "{}")
    put("consumer/node_modules/tool/package.json", "{}")
    const consumer = path.join(root, "consumer")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const work = workspaceOf({ consumer, standard: undefined, hoist: true })
    try {
      expect(readdirSync(path.join(work, "node_modules"))).toEqual(["tool"])
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("counts a package the checkout declares in any of the four dependency fields as its own", () => {
    put(
      "consumer/package.json",
      JSON.stringify({
        dependencies: { a: "1" },
        devDependencies: { b: "1" },
        optionalDependencies: { c: "1" },
        peerDependencies: { d: "1" },
      }),
    )
    const names = ["a", "b", "c", "d", "e"]
    put(
      "standard/package.json",
      JSON.stringify({ dependencies: Object.fromEntries(names.map((name) => [name, "1"])) }),
    )
    for (const name of [...names, "f"]) put(`standard/node_modules/${name}/package.json`, "{}")
    expect(
      undeclaredDependencies(path.join(root, "standard"), path.join(root, "consumer")),
    ).toEqual(["e"])
  })

  it("keeps a bin link the checkout has even when it dangles, instead of failing on it", () => {
    put("consumer/package.json", "{}")
    put(`consumer/node_modules/${STANDARD}/package.json`, "{}")
    mkdirSync(path.join(root, "consumer/node_modules/.bin"))
    // A dangling link: existsSync follows it and says no, though the name is taken.
    symlinkSync("../gone/bin.js", path.join(root, "consumer/node_modules/.bin/ghost"))
    put(
      "standard/package.json",
      JSON.stringify({ name: STANDARD, files: ["bin"], dependencies: { tool: "^1.0.0" } }),
    )
    put("standard/bin/contract.mjs", "")
    put("standard/node_modules/tool/package.json", JSON.stringify({ version: "1.0.0" }))
    mkdirSync(path.join(root, "standard/node_modules/.bin"))
    symlinkSync("../tool/bin.js", path.join(root, "standard/node_modules/.bin/ghost"))
    symlinkSync("../tool/bin.js", path.join(root, "standard/node_modules/.bin/tool"))
    const consumer = path.join(root, "consumer")
    const standard = path.join(root, "standard")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const work = workspaceOf({ consumer, standard, hoist: true })
    try {
      const bins = path.join(work, "node_modules", ".bin")
      expect(readlinkSync(path.join(bins, "ghost"))).toBe("../gone/bin.js")
      expect(readlinkSync(path.join(bins, "tool"))).toBe("../tool/bin.js")
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})

/** A stand-in contract: the report's Docs verdict comes from MARK, and argv is kept to read back. */
const FAKE_CONTRACT = `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
const mark = readFileSync(new URL("../MARK", import.meta.url), "utf8").trim()
mkdirSync("reports/contract", { recursive: true })
writeFileSync("reports/contract/argv.json", JSON.stringify(process.argv.slice(2)))
writeFileSync("reports/contract/report.json", JSON.stringify({ checks: [
  { id: "Lint", outcome: "pass", rationale: "0 problems" },
  { id: "Docs", outcome: mark === "warn" ? "warn" : "pass", rationale: "docs " + mark },
] }))
`

const fixture = (installed: string, mark: string): { consumer: string; standard: string } => {
  put("consumer/package.json", "{}")
  put(`consumer/node_modules/${STANDARD}/package.json`, "{}")
  put(`consumer/node_modules/${STANDARD}/bin/contract.mjs`, FAKE_CONTRACT)
  put(`consumer/node_modules/${STANDARD}/MARK`, installed)
  put("standard/package.json", JSON.stringify({ name: STANDARD, files: ["bin", "MARK"] }))
  put("standard/bin/contract.mjs", FAKE_CONTRACT)
  put("standard/MARK", mark)
  mkdirSync(path.join(root, "standard/node_modules"), { recursive: true })
  return { consumer: path.join(root, "consumer"), standard: path.join(root, "standard") }
}
const withIo = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

describe("verify-consumers' throwaway copies", () => {
  /** Points tmpdir() at a folder of the test's own, so a leaked copy is visible and nothing else is. */
  const ownTmp = (): { leaked: () => string[]; restore: () => void } => {
    const saved = process.env["TMPDIR"]
    const tmp = path.join(root, "tmp")
    mkdirSync(tmp)
    process.env["TMPDIR"] = tmp
    return {
      leaked: () => readdirSync(tmp).filter((name) => name.startsWith("ipc-verify-consumers-")),
      restore: () => {
        if (saved === undefined) delete process.env["TMPDIR"]
        else process.env["TMPDIR"] = saved
      },
    }
  }

  it("copies a regular file in either .bin as a link to it, and leaves no copy behind", () => {
    const { consumer, standard } = fixture("good", "good")
    put("consumer/node_modules/tool/package.json", JSON.stringify({ version: "1.0.0" }))
    // Windows shims and tools that copy leave plain files in .bin, not links.
    put("consumer/node_modules/.bin/plain", "consumer shim")
    put(
      "standard/package.json",
      JSON.stringify({ name: STANDARD, files: ["bin", "MARK"], dependencies: { tool: "^1.0.0" } }),
    )
    put("standard/node_modules/tool/package.json", JSON.stringify({ version: "1.0.0" }))
    put("standard/node_modules/.bin/shim", "standard shim")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const tmp = ownTmp()
    try {
      const work = workspaceOf({ consumer, standard, hoist: true })
      const bins = path.join(work, "node_modules", ".bin")
      expect(readlinkSync(path.join(bins, "plain"))).toBe(
        realpathSync(path.join(consumer, "node_modules/.bin/plain")),
      )
      expect(readFileSync(path.join(bins, "shim"), "utf8")).toBe("standard shim")
      rmSync(work, { recursive: true })
      const { out, err, io } = withIo()
      expect(run([consumer, "--compare"], standard, io)).toBe(0)
      expect(err).toEqual([])
      expect(out.join("")).toContain("No verdict changed beyond the allowed differences.\n")
      expect(tmp.leaked()).toEqual([])
    } finally {
      tmp.restore()
    }
  })

  it("removes every copy it made when building the second one throws", () => {
    const { consumer, standard } = fixture("good", "good")
    put("standard/package.json", JSON.stringify({ name: STANDARD, files: ["bin", "missing"] }))
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const tmp = ownTmp()
    try {
      const { io } = withIo()
      expect(() => run([consumer], standard, io)).toThrow(/ENOENT/)
      expect(tmp.leaked()).toEqual([])
    } finally {
      tmp.restore()
    }
  })
})

describe("run --compare", () => {
  it("prints the verdict table and exits 0 when nothing changed but words", () => {
    const { consumer, standard } = fixture("good", "fine")
    const { out, err, io } = withIo()
    expect(run([consumer, "--compare"], standard, io)).toBe(0)
    expect(out.join("")).toContain("| Lint | pass | pass | same |")
    expect(out.join("")).toContain("| Docs | pass | pass | reworded |")
    expect(out.join("")).toContain("  no verdict changed.\n")
    expect(out.join("")).toContain("No verdict changed beyond the allowed differences.\n")
    expect(err).toEqual([])
  })

  it("exits 1 and names each changed verdict, better or worse", () => {
    const { consumer, standard } = fixture("good", "warn")
    const { out, err, io } = withIo()
    expect(run([consumer, "--compare"], standard, io)).toBe(1)
    expect(out.join("")).toContain("| Docs | pass | warn | changed |")
    expect(out.join("")).toContain(
      "A verdict changed beyond the allowed differences, or a consumer could not be checked.\n",
    )
    expect(err.join("")).toBe("  Docs: pass -> warn. docs warn\n")
  })

  it("runs only the checks --checks names, in both copies", () => {
    const { consumer, standard } = fixture("good", "good")
    const { out, io } = withIo()
    run([consumer, "--compare", "--checks", "Lint,Docs", "--keep"], standard, io)
    const kept = /copies kept: (.+), (.+)\n/.exec(out.join(""))
    const copies = [kept?.[1] ?? "", kept?.[2] ?? ""]
    try {
      for (const copy of copies) {
        expect(
          JSON.parse(readFileSync(path.join(copy, "reports/contract/argv.json"), "utf8")),
        ).toEqual(["--checks", "Lint,Docs"])
      }
    } finally {
      for (const copy of copies) rmSync(copy, { recursive: true, force: true })
    }
  })

  it("refuses --checks with nothing after it", () => {
    const { consumer, standard } = fixture("good", "good")
    const { err, io } = withIo()
    expect(run([consumer, "--compare", "--checks"], standard, io)).toBe(1)
    expect(err.join("")).toContain("--checks needs a list of check ids")
  })

  it("refuses a --skip that leaves out every check --checks names, instead of comparing nothing", () => {
    const { consumer, standard } = fixture("good", "good")
    for (const argv of [
      ["--checks", "Lint", "--skip", "Lint"],
      ["--skip", "Docs,Lint", "--checks", "Lint,Docs"],
    ]) {
      const { out, err, io } = withIo()
      expect(run([consumer, "--compare", ...argv], standard, io), argv.join(" ")).toBe(1)
      expect(err.join("")).toBe(
        `verify-consumers: --skip leaves out every check --checks names, so nothing would be compared.\nUsage: internal-package-contract verify-consumers <checkout>... [--compare] [--checks a,b] [--skip a,b] [--keep]\n`,
      )
      expect(out).toEqual([])
    }
  })

  it("still runs what --checks names beyond what --skip leaves out", () => {
    const { consumer, standard } = fixture("good", "good")
    const { out, err, io } = withIo()
    // The list after --skip is not a checkout: only the one consumer is checked, and it passes.
    expect(
      run(
        [consumer, "--compare", "--checks", "Lint,Docs", "--skip", "Docs", "--keep"],
        standard,
        io,
      ),
    ).toBe(0)
    expect(err).toEqual([])
    const kept = /copies kept: (.+), (.+)\n/.exec(out.join(""))
    const copies = [kept?.[1] ?? "", kept?.[2] ?? ""]
    try {
      expect(
        JSON.parse(readFileSync(path.join(copies[0] ?? "", "reports/contract/argv.json"), "utf8")),
      ).toEqual(["--checks", "Lint"])
    } finally {
      for (const copy of copies) rmSync(copy, { recursive: true, force: true })
    }
  })
})
