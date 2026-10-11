import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  buildVars,
  initFlags,
  listTemplateFiles,
  parseInitArgs,
  shaFromLockfile,
} from "../scripts/init-lib.mjs"
import { repinWorkflowText, repinWorkflows, run } from "../scripts/repin-workflows.mjs"

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})
const scratch = () => {
  const root = mkdtempSync(path.join(tmpdir(), "ipc-repin-init-"))
  roots.push(root)
  return root
}
const SHA = "a".repeat(40)
const OLD = "b".repeat(40)
const uses = (dep: string, ref: string, file = "release.yml") =>
  `uses: Acme/${dep}/.github/workflows/${file}@${ref}`

describe("repinWorkflowText()", () => {
  it("rewrites the pin and its trailing comment, counting each line that changed", () => {
    const text = `a:\n  ${uses("tool", OLD)} # v1.0.0\nb:\n  ${uses("tool", "main", "ci.yaml")}\nc:\n  ${uses("tool", `${SHA}`)} # v2.0.0\n`
    const result = repinWorkflowText(text, "tool", SHA, "v2.0.0")
    expect(result.changed).toBe(2)
    expect(result.text).toBe(
      `a:\n  ${uses("tool", SHA)} # v2.0.0\nb:\n  ${uses("tool", SHA, "ci.yaml")} # v2.0.0\nc:\n  ${uses("tool", SHA)} # v2.0.0\n`,
    )
  })

  it("only touches the named dependency, taking its name literally", () => {
    const text = `${uses("other", OLD)}\n${uses("tool-x", OLD)}\n${uses("toolx", OLD)}\n`
    expect(repinWorkflowText(text, "tool", SHA, "v1")).toEqual({ text, changed: 0 })
    const dotted = `${uses("a.b", OLD)}\n${uses("axb", OLD)}\n${uses("a+b", OLD)}\n`
    const result = repinWorkflowText(dotted, "a.b", SHA, "v1")
    expect(result.changed).toBe(1)
    expect(result.text).toBe(`${uses("a.b", SHA)} # v1\n${uses("axb", OLD)}\n${uses("a+b", OLD)}\n`)
    const plus = repinWorkflowText(dotted, "a+b", SHA, "v1")
    expect(plus.changed).toBe(1)
    expect(
      repinWorkflowText(`${uses("a(b)", OLD)}\n${uses("ab", OLD)}\n`, "a(b)", SHA, "v1").changed,
    ).toBe(1)
  })

  it("refuses anything but a full 40-hex SHA", () => {
    for (const bad of ["abc", "A".repeat(40), "a".repeat(39), "a".repeat(41), "g".repeat(40), ""]) {
      expect(() => repinWorkflowText("x", "tool", bad, "v1"), bad).toThrow(
        `Not a full commit SHA: ${JSON.stringify(bad)}`,
      )
    }
  })

  it("does not count a line that is already pinned exactly as asked", () => {
    const text = `${uses("tool", SHA)} # v1\n`
    expect(repinWorkflowText(text, "tool", SHA, "v1")).toEqual({ text, changed: 0 })
  })
})

describe("repinWorkflows() and run()", () => {
  const repo = (files: Record<string, string>) => {
    const root = scratch()
    mkdirSync(path.join(root, ".github/workflows"), { recursive: true })
    for (const [name, text] of Object.entries(files))
      writeFileSync(path.join(root, ".github/workflows", name), text)
    return root
  }
  const read = (root: string, name: string) =>
    readFileSync(path.join(root, ".github/workflows", name), "utf8")

  it("rewrites .yml and .yaml workflows that pin the dependency, and nothing else", () => {
    const pinned = `${uses("tool", OLD)}\n`
    const root = repo({
      "a.yml": pinned,
      "b.yaml": pinned,
      "c.yml": "name: nothing\n",
      "d.yml.bak": pinned,
      "e.yaml.old": pinned,
      "f.txt": pinned,
      "g.myml": pinned,
    })
    expect(repinWorkflows(root, "tool", SHA, "v1").sort()).toEqual([
      path.join(".github", "workflows", "a.yml"),
      path.join(".github", "workflows", "b.yaml"),
    ])
    expect(read(root, "a.yml")).toBe(`${uses("tool", SHA)} # v1\n`)
    expect(read(root, "b.yaml")).toBe(`${uses("tool", SHA)} # v1\n`)
    expect(read(root, "c.yml")).toBe("name: nothing\n")
    for (const untouched of ["d.yml.bak", "e.yaml.old", "f.txt", "g.myml"])
      expect(read(root, untouched), untouched).toBe(pinned)
  })

  it("has nothing to do without a workflows folder", () => {
    expect(repinWorkflows(scratch(), "tool", SHA, "v1")).toEqual([])
  })

  it("reports what it re-pinned, with a short SHA", () => {
    const root = repo({ "a.yml": `${uses("tool", OLD)}\n` })
    const out: string[] = []
    const err: string[] = []
    expect(
      run(["tool", SHA, "v1.2.3"], root, { out: (t) => out.push(t), err: (t) => err.push(t) }),
    ).toBe(0)
    expect(out).toEqual([
      `Re-pinned ${path.join(".github", "workflows", "a.yml")} to aaaaaaa (v1.2.3).\n`,
    ])
    expect(err).toEqual([])
    const again: string[] = []
    expect(
      run(["tool", SHA, "v1.2.3"], root, { out: (t) => again.push(t), err: () => undefined }),
    ).toBe(0)
    expect(again).toEqual(["No workflow pins this dependency; nothing re-pinned.\n"])
  })

  it("lists every workflow it re-pinned, comma separated", () => {
    const root = repo({ "a.yml": `${uses("tool", OLD)}\n`, "b.yaml": `${uses("tool", OLD)}\n` })
    const out: string[] = []
    run(["tool", SHA, "v1"], root, { out: (t) => out.push(t), err: () => undefined })
    expect(out).toEqual([
      `Re-pinned ${path.join(".github", "workflows", "a.yml")}, ${path.join(".github", "workflows", "b.yaml")} to aaaaaaa (v1).\n`,
    ])
  })

  it("prints the usage and fails unless given all three arguments", () => {
    for (const argv of [
      [],
      ["tool"],
      ["tool", SHA],
      ["", SHA, "v1"],
      ["tool", "", "v1"],
      ["tool", SHA, ""],
    ]) {
      const out: string[] = []
      const err: string[] = []
      expect(
        run(argv, scratch(), { out: (t) => out.push(t), err: (t) => err.push(t) }),
        argv.join(","),
      ).toBe(1)
      expect(err).toEqual(["Usage: repin-workflows.mjs <dependency> <commit-sha> <release-tag>\n"])
      expect(out).toEqual([])
    }
  })
})

describe("initFlags()", () => {
  it("drops the subcommand name when init is reached through the dispatcher", () => {
    expect(initFlags(["node", "contract.mjs", "init", "--name", "demo", "--force"])).toEqual([
      "--name",
      "demo",
      "--force",
    ])
    expect(initFlags(["node", "contract.mjs", "init"])).toEqual([])
  })

  it("keeps every argument when init.mjs is run directly, even one whose value is the word init", () => {
    expect(initFlags(["node", "init.mjs", "--name", "demo"])).toEqual(["--name", "demo"])
    expect(initFlags(["node", "init.mjs", "--name", "init"])).toEqual(["--name", "init"])
    expect(initFlags(["node", "init.mjs"])).toEqual([])
  })
})

describe("parseInitArgs()", () => {
  it("reads value flags with a space or an equals sign, and --force", () => {
    expect(parseInitArgs([])).toEqual({ force: false, errors: [] })
    expect(
      parseInitArgs(["--name", "demo", "--owner=Acme", "--description", "A thing", "--force"]),
    ).toEqual({
      force: true,
      errors: [],
      name: "demo",
      owner: "Acme",
      description: "A thing",
    })
    expect(parseInitArgs(["--name=a=b"]).name).toBe("a=b")
  })

  it("takes the next argument as the value, and goes on to the one after", () => {
    expect(parseInitArgs(["--name", "demo", "--owner", "Acme"])).toEqual({
      force: false,
      errors: [],
      name: "demo",
      owner: "Acme",
    })
    expect(parseInitArgs(["--name=demo", "--owner", "Acme"])).toEqual({
      force: false,
      errors: [],
      name: "demo",
      owner: "Acme",
    })
    expect(parseInitArgs(["--name", "--force"]).errors).toEqual(["--name needs a value."])
    expect(parseInitArgs(["--name", "--force"]).force).toBe(true)
  })

  it("reports a flag with no value, or an empty one", () => {
    expect(parseInitArgs(["--name"]).errors).toEqual(["--name needs a value."])
    expect(parseInitArgs(["--name="]).errors).toEqual(["--name needs a value."])
    expect(parseInitArgs(["--name", "--owner", "x"]).errors).toEqual(["--name needs a value."])
    expect(parseInitArgs(["--name", "--owner", "x"]).owner).toBe("x")
  })

  it("reports anything it does not recognise, quoting it", () => {
    for (const bad of [
      "positional",
      "-n",
      "--unknown",
      "--unknown=1",
      "--NAME",
      "--na-me",
      "--name1",
      "x--name",
      "--",
      "--=x",
      "--force=1",
    ]) {
      expect(parseInitArgs([bad]).errors, bad).toEqual([`Unknown argument ${JSON.stringify(bad)}.`])
    }
    expect(parseInitArgs(["--name1=x"]).errors).toHaveLength(1)
    expect(parseInitArgs(["a", "b"]).errors).toEqual([
      'Unknown argument "a".',
      'Unknown argument "b".',
    ])
  })
})

describe("buildVars()", () => {
  it("keeps the part of a scoped name after the slash as the repository", () => {
    expect(buildVars({ name: "@acme/widgets", owner: "acme" })).toMatchObject({
      repo: "widgets",
      name: "@acme/widgets",
    })
    expect(buildVars({ name: "widgets", owner: "acme" }).repo).toBe("widgets")
    expect(buildVars({ name: "a/b/c", owner: "acme" }).repo).toBe("b/c")
  })

  it("defaults the description, year and pins", () => {
    expect(buildVars({ name: "w", owner: "o", year: 2030 })).toEqual({
      name: "w",
      repo: "w",
      owner: "o",
      description: "TODO: describe w.",
      year: "2030",
      ipcRef: "main",
      ipcSha: "",
    })
    expect(
      buildVars({ name: "w", owner: "o", description: "Mine", ipcRef: "v1", ipcSha: "x" }),
    ).toMatchObject({ description: "Mine", ipcRef: "v1", ipcSha: "x" })
    expect(buildVars({ name: "w", owner: "o", description: "" }).description).toBe("")
    expect(buildVars({ name: "w", owner: "o" }).year).toBe(String(new Date().getFullYear()))
  })
})

describe("shaFromLockfile()", () => {
  const lock = (resolved: unknown) =>
    JSON.stringify({ packages: { "node_modules/internal-package-contract": { resolved } } })

  it("reads the commit from the git dependency's resolved URL", () => {
    expect(
      shaFromLockfile(lock(`git+ssh://git@github.com/Acme/internal-package-contract.git#${SHA}`)),
    ).toBe(SHA)
  })

  it("is undefined when there is no usable pin", () => {
    for (const text of [
      undefined,
      "{ nope",
      "null",
      "[]",
      "{}",
      JSON.stringify({ packages: {} }),
      JSON.stringify({ packages: { "node_modules/internal-package-contract": {} } }),
      lock(undefined),
      lock(5),
      lock(null),
      lock(""),
      lock("git+ssh://x#abc"),
      lock(`git+ssh://x#${"A".repeat(40)}`),
      lock(`git+ssh://x#${"a".repeat(39)}`),
      lock(`git+ssh://x/${SHA}`),
    ]) {
      expect(shaFromLockfile(text), String(text)).toBeUndefined()
    }
  })
})

describe("listTemplateFiles()", () => {
  it("lists every file below the folder with posix paths, sorted as strings", () => {
    const root = scratch()
    for (const rel of ["a/z.txt", "a-b.txt", "b/c/d.txt", "root.txt", "A.txt"]) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
      writeFileSync(path.join(root, rel), "x")
    }
    expect(listTemplateFiles(root)).toEqual([
      "A.txt",
      "a-b.txt",
      "a/z.txt",
      "b/c/d.txt",
      "root.txt",
    ])
  })
})
