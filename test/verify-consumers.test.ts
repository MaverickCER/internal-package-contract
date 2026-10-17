import { spawnSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  NOT_RUN,
  STANDARD,
  compare,
  nestedDependencies,
  satisfies,
  outcomesOf,
  run,
  runContract,
  verifyConsumer,
  workspaceOf,
} from "../scripts/verify-consumers/run.mjs"

let root: string
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ipc-verify-consumers-test-"))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const put = (file: string, text: string): void => {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  writeFileSync(path.join(root, file), text)
}

/** A stand-in for the contract: its report says `bad` when the version it came from is marked so. */
const FAKE_CONTRACT = `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
const mark = readFileSync(new URL("../MARK", import.meta.url), "utf8").trim()
mkdirSync("reports/contract", { recursive: true })
writeFileSync("reports/contract/argv.json", JSON.stringify(process.argv.slice(2)))
if (mark !== "silent") {
  writeFileSync("reports/contract/report.json", JSON.stringify({ checks: [
    { id: "Lint", outcome: mark === "bad" ? "fail" : "pass", rationale: "lint says " + mark + "\\nmore words here" },
    { id: "Docs", outcome: mark === "warn" ? "warn" : "pass" },
  ] }))
}
process.exit(mark === "bad" ? 1 : 0)
`

/** A copy of the standard, or of a consumer's installed one, that prints what its mark says. */
const standardAt = (
  dir: string,
  mark: string,
  dependencies: Record<string, string> = {},
): string => {
  put(
    `${dir}/package.json`,
    JSON.stringify({ name: STANDARD, files: ["bin", "MARK"], dependencies }),
  )
  put(`${dir}/bin/contract.mjs`, FAKE_CONTRACT)
  put(`${dir}/MARK`, mark)
  mkdirSync(path.join(root, dir, "node_modules"), { recursive: true })
  return path.join(root, dir)
}

const consumerAt = (dir: string, installed = "good"): string => {
  put(`${dir}/package.json`, "{}")
  put(`${dir}/src/a.ts`, "export {}")
  put(`${dir}/node_modules/other/package.json`, "{}")
  put(`${dir}/node_modules/${STANDARD}/package.json`, "{}")
  put(`${dir}/node_modules/${STANDARD}/bin/contract.mjs`, FAKE_CONTRACT)
  put(`${dir}/node_modules/${STANDARD}/MARK`, installed)
  return path.join(root, dir)
}

const withIo = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } }
}

describe("NOT_RUN", () => {
  it("leaves out what needs a network or a service, or a long run CI makes anyway", () => {
    expect([...NOT_RUN].sort()).toEqual([
      "BranchProtection",
      "CodeRabbit",
      "CodeScanning",
      "Coverage",
      "Crap",
      "DocsLinks",
      "Mutation",
      "SecurityDeps",
      "SecurityDevDeps",
      "SecuritySocket",
    ])
  })
})

describe("compare", () => {
  const map = (entries: Record<string, string>) =>
    new Map(
      Object.entries(entries).map(([id, outcome]) => [
        id,
        { outcome, rationale: `${id} ${outcome}` },
      ]),
    )

  it("reports a check that got worse, and one that got better, and nothing for one that did not change", () => {
    const result = compare(
      map({ A: "pass", B: "warn", C: "fail", D: "pass" }),
      map({ A: "fail", B: "fail", C: "pass", D: "pass" }),
    )
    expect(result.regressions).toEqual([
      { id: "A", from: "pass", to: "fail", rationale: "A fail" },
      { id: "B", from: "warn", to: "fail", rationale: "B fail" },
    ])
    expect(result.improvements).toEqual(["C"])
  })

  it("counts a warning as worse than a pass, and a skipped check as no worse than one that passed", () => {
    expect(compare(map({ A: "pass" }), map({ A: "warn" })).regressions).toHaveLength(1)
    expect(compare(map({ A: "pass" }), map({ A: "not-evaluated" })).regressions).toHaveLength(1)
    expect(compare(map({ A: "pass" }), map({ A: "skipped" })).regressions).toEqual([])
    expect(compare(map({ A: "skipped" }), map({ A: "pass" })).regressions).toEqual([])
    expect(compare(map({ A: "warn" }), map({ A: "warn" })).regressions).toEqual([])
  })

  it("treats a check the installed standard did not have as passing before, so a new failure is a regression", () => {
    expect(compare(map({}), map({ New: "fail" })).regressions).toHaveLength(1)
    expect(compare(map({}), map({ New: "pass" })).regressions).toEqual([])
    expect(compare(map({}), map({ New: "warn" })).regressions).toHaveLength(1)
  })

  it("treats an outcome it does not know as a failure", () => {
    expect(compare(map({ A: "pass" }), map({ A: "exploded" })).regressions).toHaveLength(1)
    expect(compare(map({ A: "exploded" }), map({ A: "exploded" })).regressions).toEqual([])
    expect(compare(map({ A: "exploded" }), map({ A: "pass" })).improvements).toEqual(["A"])
  })

  it("ignores a check only the installed standard had", () => {
    expect(compare(map({ Gone: "fail" }), map({})).regressions).toEqual([])
  })
})

describe("outcomesOf", () => {
  it("reads each check's outcome and rationale, and an empty rationale when there is none", () => {
    put(
      "report.json",
      JSON.stringify({
        checks: [
          { id: "A", outcome: "pass", rationale: "fine" },
          { id: "B", outcome: "warn" },
        ],
      }),
    )
    expect([...outcomesOf(path.join(root, "report.json"))]).toEqual([
      ["A", { outcome: "pass", rationale: "fine" }],
      ["B", { outcome: "warn", rationale: "" }],
    ])
  })
})

describe("satisfies", () => {
  it.each([
    ["1.2.3", "^1.2.3", true],
    ["1.2.4", "^1.2.3", true],
    ["1.3.0", "^1.2.3", true],
    ["1.2.2", "^1.2.3", false],
    ["1.1.9", "^1.2.3", false],
    ["2.0.0", "^1.2.3", false],
    ["0.9.9", "^1.2.3", false],
    ["0.3.5", "^0.3.4", true],
    ["0.3.3", "^0.3.4", false],
    ["0.4.0", "^0.3.4", false],
    ["1.3.4", "^0.3.4", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["0.1.3", "^0.0.3", false],
    ["1.2.5", "~1.2.3", true],
    ["1.2.2", "~1.2.3", false],
    ["1.3.0", "~1.2.3", false],
    ["2.2.3", "~1.2.3", false],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.3.3", "1.2.3", false],
    ["2.2.3", "1.2.3", false],
    ["1.2.3", "~1.2.3", true],
    ["0.3.4", "^0.3.4", true],
    ["10.20.30", "^10.20.30", true],
    ["10.20.31", "^10.20.30", true],
    ["1.2.30", "~1.2.3", true],
    ["1.20.3", "^1.2.3", true],
    ["21.2.3", "^1.2.3", false],
    ["v1.2.3", "^1.2.3", false],
    ["1.2.3x", "^1.2.3", false],
    ["x1.2.3", "^1.2.3", false],
    ["1.2.3-next.1", "^1.2.3", false],
    ["1.2.3", ">=1.0.0", false],
    ["1.2.3", ">=1.2.3", false],
    ["1.2.3", "x^1.2.3", false],
    ["1.2.3", "^1.2.3-beta", false],
    ["1.2.3", "^1.2.3 || ^2.0.0", false],
    ["1.2.3", "github:owner/repo", false],
  ])("%s against %s is %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected)
  })
})

describe("nestedDependencies", () => {
  const installed = (dir: string, name: string, version: string): void =>
    put(`${dir}/node_modules/${name}/package.json`, JSON.stringify({ version }))

  it("names what is missing or at a version that does not satisfy, and nothing that does", () => {
    const standard = standardAt("standard", "good", {
      fine: "^1.0.0",
      old: "^2.0.0",
      absent: "^1.0.0",
      "@scope/pkg": "3.0.0",
    })
    const consumer = consumerAt("consumer")
    installed("consumer", "fine", "1.4.0")
    installed("consumer", "old", "1.9.0")
    installed("consumer", "@scope/pkg", "3.0.0")
    expect(nestedDependencies(standard, consumer)).toEqual([
      { name: "old", wanted: "^2.0.0", installed: "1.9.0" },
      { name: "absent", wanted: "^1.0.0", installed: undefined },
    ])
  })

  it("has nothing to nest for a standard that depends on nothing", () => {
    expect(nestedDependencies(standardAt("standard", "good"), consumerAt("consumer"))).toEqual([])
    put("bare/package.json", "{}")
    put("bare/node_modules/x/package.json", "{}")
    expect(nestedDependencies(path.join(root, "bare"), consumerAt("consumer"))).toEqual([])
  })
})

describe("workspaceOf", () => {
  it("copies the checkout and shares its packages, leaving the standard it has installed in place", () => {
    const consumer = consumerAt("consumer")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    const work = workspaceOf({ consumer, standard: undefined })
    try {
      expect(readFileSync(path.join(work, "src/a.ts")).toString()).toBe("export {}")
      expect(lstatSync(path.join(work, "node_modules/other")).isSymbolicLink()).toBe(true)
      expect(readFileSync(path.join(work, "node_modules", STANDARD, "MARK")).toString()).toBe(
        "good",
      )
      expect(existsSync(path.join(work, "node_modules", ".bin"))).toBe(false)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("makes its copy where a leftover can be told from anything else", () => {
    const work = workspaceOf({ consumer: consumerAt("consumer"), standard: undefined })
    try {
      expect(path.basename(work).startsWith("ipc-verify-consumers-")).toBe(true)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("replaces the installed standard with a copy of what the given one publishes, and nothing else of it", () => {
    const consumer = consumerAt("consumer")
    const standard = standardAt("standard", "bad")
    put("standard/UNPUBLISHED", "x")
    const work = workspaceOf({ consumer, standard })
    try {
      const installed = path.join(work, "node_modules", STANDARD)
      expect(lstatSync(installed).isSymbolicLink()).toBe(false)
      expect(readFileSync(path.join(installed, "MARK")).toString()).toBe("bad")
      expect(existsSync(path.join(installed, "package.json"))).toBe(true)
      expect(existsSync(path.join(installed, "UNPUBLISHED"))).toBe(false)
      // Nothing is nested when every package the standard needs is already installed at a version that satisfies it.
      expect(existsSync(path.join(installed, "node_modules"))).toBe(false)
      expect(readdirSync(path.join(work, "node_modules")).sort()).toEqual([STANDARD, "other"])
      // The checkout's own installed standard is untouched.
      expect(readFileSync(path.join(consumer, "node_modules", STANDARD, "MARK")).toString()).toBe(
        "good",
      )
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("gives the copy its own version of a package it needs that the checkout lacks or has at another version, and shares the rest", () => {
    const consumer = consumerAt("consumer")
    put("consumer/node_modules/shared/package.json", JSON.stringify({ version: "1.5.0" }))
    put("consumer/node_modules/stale/package.json", JSON.stringify({ version: "1.0.0" }))
    const standard = standardAt("standard", "good", {
      shared: "^1.0.0",
      stale: "^2.0.0",
      missing: "^1.0.0",
      "@s/scoped": "^1.0.0",
    })
    for (const name of ["stale", "missing", "@s/scoped"])
      put(`standard/node_modules/${name}/marker.txt`, name)
    const work = workspaceOf({ consumer, standard })
    try {
      const nested = path.join(work, "node_modules", STANDARD, "node_modules")
      expect(readdirSync(nested).sort()).toEqual(["@s", "missing", "stale"])
      expect(readFileSync(path.join(nested, "stale", "marker.txt")).toString()).toBe("stale")
      expect(readFileSync(path.join(nested, "@s", "scoped", "marker.txt")).toString()).toBe(
        "@s/scoped",
      )
      expect(lstatSync(path.join(nested, "missing")).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("leaves out a file git lists that has been deleted from the working tree", () => {
    const consumer = consumerAt("consumer")
    put("consumer/gone.txt", "x")
    spawnSync("git", ["init", "-q"], { cwd: consumer })
    spawnSync("git", ["add", "-A"], { cwd: consumer })
    rmSync(path.join(consumer, "gone.txt"))
    const work = workspaceOf({ consumer, standard: undefined })
    try {
      expect(existsSync(path.join(work, "gone.txt"))).toBe(false)
      expect(existsSync(path.join(work, "src/a.ts"))).toBe(true)
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })
})

describe("runContract", () => {
  it("runs the contract the copy has installed, from the copy, without the checks it is told to leave out", () => {
    const consumer = consumerAt("consumer", "good")
    const work = workspaceOf({ consumer, standard: undefined })
    try {
      const result = runContract(work, ["Mutation", "Coverage"])
      expect(result.status).toBe(0)
      expect(result.report).toBe(path.join(work, "reports", "contract", "report.json"))
      expect(
        JSON.parse(readFileSync(path.join(work, "reports/contract/argv.json")).toString()),
      ).toEqual(["--skip", "Mutation,Coverage"])
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

  it("reports how it exited, and that it wrote no report when it did not", () => {
    const failing = workspaceOf({ consumer: consumerAt("c1", "bad"), standard: undefined })
    const silent = workspaceOf({ consumer: consumerAt("c2", "silent"), standard: undefined })
    try {
      expect(runContract(failing, []).status).toBe(1)
      expect(runContract(silent, [])).toEqual({ report: undefined, status: 0 })
    } finally {
      rmSync(failing, { recursive: true, force: true })
      rmSync(silent, { recursive: true, force: true })
    }
  })
})

describe("verifyConsumer", () => {
  it("says what got worse with this standard, and nothing for what was already wrong", () => {
    const consumer = consumerAt("consumer", "warn")
    const standard = standardAt("standard", "bad")
    const { out, io } = withIo()
    const result = verifyConsumer({ consumer, standard, skip: [], keep: false, io })
    expect(result.problem).toBeUndefined()
    expect(result.regressions).toEqual([
      { id: "Lint", from: "pass", to: "fail", rationale: "lint says bad\nmore words here" },
    ])
    // Docs warned with the installed standard and passes with this one: better, not worse.
    expect(out.join("")).toContain("installed standard")
    expect(out.join("")).toContain("this one")
  })

  it("says which packages an install would add its own copy of", () => {
    const consumer = consumerAt("consumer", "good")
    put("consumer/node_modules/old/package.json", JSON.stringify({ version: "1.0.0" }))
    const standard = standardAt("standard", "good", { old: "^2.0.0", absent: "^1.0.0" })
    for (const name of ["old", "absent"]) put(`standard/node_modules/${name}/package.json`, "{}")
    const { out, io } = withIo()
    verifyConsumer({ consumer, standard, skip: [], keep: false, io })
    expect(out.join("")).toContain(
      "  note: this standard wants old ^2.0.0; the checkout has 1.0.0, so an install would add its own.\n",
    )
    expect(out.join("")).toContain(
      "  note: this standard wants absent ^1.0.0; the checkout has no copy, so an install would add its own.\n",
    )
  })

  it("finds nothing when this standard does what the installed one did", () => {
    const result = verifyConsumer({
      consumer: consumerAt("consumer", "good"),
      standard: standardAt("standard", "good"),
      skip: [],
      keep: false,
      io: withIo().io,
    })
    expect(result).toEqual({ regressions: [], improvements: [] })
  })

  it("is a problem, not a pass, when the consumer has not been installed", () => {
    put("bare/package.json", "{}")
    const result = verifyConsumer({
      consumer: path.join(root, "bare"),
      standard: standardAt("standard", "good"),
      skip: [],
      keep: false,
      io: withIo().io,
    })
    expect(result.problem).toBe("it has no node_modules; run `npm install` there first")
    expect(result.regressions).toEqual([])
  })

  it("is a problem, naming which one, when a contract writes no report", () => {
    const installedSilent = verifyConsumer({
      consumer: consumerAt("c1", "silent"),
      standard: standardAt("s1", "good"),
      skip: [],
      keep: false,
      io: withIo().io,
    })
    expect(installedSilent.problem).toBe("the contract did not write a report (installed standard)")
    expect(installedSilent.regressions).toEqual([])
    const thisSilent = verifyConsumer({
      consumer: consumerAt("c2", "good"),
      standard: standardAt("s2", "silent"),
      skip: [],
      keep: false,
      io: withIo().io,
    })
    expect(thisSilent.problem).toBe("the contract did not write a report (this standard)")
    expect(thisSilent.regressions).toEqual([])
  })

  it("removes its copies, or keeps and names them when asked", () => {
    const before = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("ipc-verify-consumers-"),
    ).length
    verifyConsumer({
      consumer: consumerAt("c1", "good"),
      standard: standardAt("s1", "good"),
      skip: [],
      keep: false,
      io: withIo().io,
    })
    expect(
      readdirSync(tmpdir()).filter((name) => name.startsWith("ipc-verify-consumers-")).length,
    ).toBe(before)
    const { out, io } = withIo()
    verifyConsumer({
      consumer: consumerAt("c2", "good"),
      standard: standardAt("s2", "good"),
      skip: [],
      keep: true,
      io,
    })
    const kept = /copies kept: (.+), (.+)\n/.exec(out.join(""))
    expect(kept).not.toBeNull()
    expect(existsSync(kept?.[1] ?? "")).toBe(true)
    expect(existsSync(kept?.[2] ?? "")).toBe(true)
    for (const copy of [kept?.[1], kept?.[2]]) rmSync(copy ?? "", { recursive: true, force: true })
  })
})

/** What each throwaway copy of a run was told to skip, read from the copies a `--keep` run left. */
const skippedIn = (output: string): string[][] => {
  const kept = /copies kept: (.+), (.+)\n/.exec(output)
  const copies = [kept?.[1], kept?.[2]].map((copy) => copy ?? "")
  try {
    return copies.map((copy) => {
      const args = JSON.parse(
        readFileSync(path.join(copy, "reports", "contract", "argv.json")).toString(),
      ) as string[]
      return (args[1] ?? "").split(",").sort()
    })
  } finally {
    for (const copy of copies) rmSync(copy, { recursive: true, force: true })
  }
}

describe("run", () => {
  it("says how it is used when given nothing, or an option it does not know", () => {
    const none = withIo()
    expect(run([], root, none.io)).toBe(1)
    expect(none.err.join("")).toContain("Usage: internal-package-contract verify-consumers")
    const unknown = withIo()
    expect(run(["--nope"], root, unknown.io)).toBe(1)
    expect(unknown.err.join("")).toContain("unknown option --nope")
  })

  it("exits 0 and says so when no consumer got worse", () => {
    consumerAt("consumer", "good")
    const standard = standardAt("standard", "good")
    const { out, err, io } = withIo()
    expect(run(["../consumer"], standard, io)).toBe(0)
    expect(out.join("")).toContain("consumer\n")
    expect(out.join("")).toContain("  no check got worse.\n")
    expect(out.join("")).toContain("No consumer got worse.\n")
    expect(err).toEqual([])
  })

  it("exits 1 naming each check that got worse, first line of its reason only", () => {
    consumerAt("consumer", "good")
    const standard = standardAt("standard", "bad")
    const { out, err, io } = withIo()
    expect(run(["../consumer"], standard, io)).toBe(1)
    expect(err.join("")).toBe("  Lint: pass -> fail. lint says bad\n")
    expect(out.join("")).toContain("A consumer got worse or could not be checked.\n")
  })

  it("checks every consumer it is given, and one that cannot be checked fails the run", () => {
    consumerAt("one", "good")
    put("two/package.json", "{}")
    const standard = standardAt("standard", "good")
    const { out, err, io } = withIo()
    expect(run(["../one", "../two"], standard, io)).toBe(1)
    expect(out.join("")).toContain("one\n")
    expect(out.join("")).toContain("two\n")
    expect(err.join("")).toBe(
      "  could not be checked: it has no node_modules; run `npm install` there first.\n",
    )
  })

  it("skips only what it always does when told nothing, and keeps no copies", () => {
    const consumer = consumerAt("consumer", "good")
    const { out, io } = withIo()
    run([consumer], standardAt("standard", "good"), io)
    expect(out.join("")).not.toContain("copies kept")
    const { out: kept, io: keptIo } = withIo()
    run([consumer, "--keep"], standardAt("standard2", "good"), keptIo)
    for (const skipped of skippedIn(kept.join(""))) expect(skipped).toEqual([...NOT_RUN].sort())
  })

  it("reads the checks to skip from the argument after --skip, wherever it is, and never as a checkout", () => {
    const consumer = consumerAt("consumer", "good")
    const { out, err, io } = withIo()
    expect(run(["--skip", "Lint", consumer, "--keep"], standardAt("standard", "good"), io)).toBe(0)
    expect(err).toEqual([])
    expect(out.join("")).not.toContain("Lint\n")
    for (const skipped of skippedIn(out.join("")))
      expect(skipped).toEqual([...NOT_RUN, "Lint"].sort())
  })

  it("ignores an empty --skip rather than skipping a check called nothing", () => {
    const consumer = consumerAt("consumer", "good")
    const { out, io } = withIo()
    run([consumer, "--skip", "", "--keep"], standardAt("standard", "good"), io)
    for (const skipped of skippedIn(out.join(""))) expect(skipped).toEqual([...NOT_RUN].sort())
  })

  it("takes a --skip with nothing after it as skipping nothing more", () => {
    const consumer = consumerAt("consumer", "good")
    const { out, err, io } = withIo()
    expect(run([consumer, "--keep", "--skip"], standardAt("standard", "good"), io)).toBe(0)
    expect(err).toEqual([])
    for (const skipped of skippedIn(out.join(""))) expect(skipped).toEqual([...NOT_RUN].sort())
  })

  it("leaves out the checks it is told to as well as the ones it always does", () => {
    const consumer = consumerAt("consumer", "good")
    const standard = standardAt("standard", "good")
    const { out, io } = withIo()
    run([consumer, "--skip", "Lint,Docs", "--keep"], standard, io)
    const kept = /copies kept: (.+), (.+)\n/.exec(out.join(""))
    const copies = [kept?.[1], kept?.[2]].map((copy) => copy ?? "")
    expect(copies).toHaveLength(2)
    try {
      for (const copy of copies) {
        const args = JSON.parse(
          readFileSync(path.join(copy, "reports", "contract", "argv.json")).toString(),
        ) as string[]
        expect(args[0]).toBe("--skip")
        expect(args[1]?.split(",").sort()).toEqual([...NOT_RUN, "Lint", "Docs"].sort())
      }
    } finally {
      for (const copy of copies) rmSync(copy, { recursive: true, force: true })
    }
  })
})
