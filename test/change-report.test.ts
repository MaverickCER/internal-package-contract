import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  areaOf,
  changedFiles,
  changesets,
  collect,
  contractChecks,
  defaultBase,
  dependencyChanges,
  exceptionChanges,
  newDecisions,
} from "../scripts/report/collect.mjs"
import { CI_ONLY, EVIDENCE, render } from "../scripts/report/render.mjs"
import { run } from "../scripts/report/run.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-change-report-"))
  git("init", "-q", "-b", "main")
  git("config", "user.email", "t@example.test")
  git("config", "user.name", "t")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const git = (...args: string[]): string => {
  const run = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  return run.stdout
}
const put = (file: string, text: string): void => {
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

describe("areaOf", () => {
  it.each([
    ["src/a.ts", "Source"],
    ["checks/a.ts", "Source"],
    ["runtime/a.ts", "Source"],
    ["bin/a.mjs", "Source"],
    ["xsrc/a.ts", "Configuration"],
    ["lib/src/a.ts", "Configuration"],
    ["src", "Configuration"],
    ["test/a.test.ts", "Tests"],
    ["test/helper.ts", "Tests"],
    ["xtest/helper.ts", "Configuration"],
    ["lib/a.test.ts", "Tests"],
    ["lib/a.spec.mts", "Tests"],
    ["lib/a.test.tsx", "Tests"],
    ["lib/a.test.js", "Tests"],
    ["lib/a.test.cjs", "Tests"],
    ["lib/a.test.d.ts", "Configuration"],
    ["lib/a.testing.ts", "Configuration"],
    ["lib/atest.ts", "Configuration"],
    ["lib/a.test.ts.bak", "Configuration"],
    ["lib/a.test", "Configuration"],
    ["benchmarks/performance/suite.mjs", "Benchmarks"],
    ["xbenchmarks/a.mjs", "Configuration"],
    ["specs/decisions/0001-x.html", "Decisions and documents"],
    ["docs/a.html", "Decisions and documents"],
    ["xdocs/a.html", "Configuration"],
    ["README.md", "Decisions and documents"],
    ["notes/a.md", "Decisions and documents"],
    ["a.mdx", "Configuration"],
    ["a-md", "Configuration"],
    ["amd", "Configuration"],
    [".repo-contract/exceptions/a.json", "Exceptions and baselines"],
    ["x.repo-contract/a.json", "Configuration"],
    [".github/workflows/ci.yml", "Workflows"],
    ["x.github/ci.yml", "Configuration"],
    ["scripts/a.mjs", "Scripts and tooling"],
    ["ci/size-budgets.mjs", "Scripts and tooling"],
    ["xscripts/a.mjs", "Configuration"],
    ["xci/a.mjs", "Configuration"],
    ["package.json", "Configuration"],
    ["tsconfig.json", "Configuration"],
  ])("puts %s under %s", (file, area) => {
    expect(areaOf(file)).toBe(area)
  })

  it("puts a changeset under documents, since it is Markdown", () => {
    expect(areaOf(".changeset/a.md")).toBe("Decisions and documents")
  })
})

describe("defaultBase", () => {
  it("is main when there is no origin/main, and nothing when there is neither", () => {
    expect(defaultBase(dir)).toBeUndefined()
    put("a.txt", "a")
    commit()
    expect(defaultBase(dir)).toBe("main")
  })
})

describe("changedFiles", () => {
  it("lists what differs from the base, committed or not, with how many lines", () => {
    put("keep.txt", "1\n2\n3\n")
    put("edit.txt", "a\nb\n")
    put("gone.txt", "x\n")
    commit()
    put("edit.txt", "a\nB\nc\n")
    rmSync(path.join(dir, "gone.txt"))
    put("new.txt", "n1\nn2\n")
    expect(changedFiles(dir, "main")).toEqual([
      { path: "edit.txt", status: "M", added: 2, removed: 1 },
      { path: "gone.txt", status: "D", added: 0, removed: 1 },
      { path: "new.txt", status: "A", added: 2, removed: 0 },
    ])
  })

  it("counts the lines of an untracked file, with or without a final newline, and none for an empty one", () => {
    put("a.txt", "a")
    commit()
    put("with-newline.txt", "1\n2\n3\n")
    put("without-newline.txt", "1\n2\n3")
    put("one.txt", "x")
    put("empty.txt", "")
    const counts = Object.fromEntries(
      changedFiles(dir, "main").map((file) => [file.path, file.added]),
    )
    expect(counts).toEqual({
      "empty.txt": 0,
      "one.txt": 1,
      "with-newline.txt": 3,
      "without-newline.txt": 3,
    })
  })

  it("lists tracked and untracked files together in path order, each file once", () => {
    put("b.txt", "1\n")
    put("d.txt", "1\n")
    commit()
    put("b.txt", "1\n2\n")
    put("a.txt", "new\n")
    put("c.txt", "new\n")
    expect(changedFiles(dir, "main").map((file) => `${file.status} ${file.path}`)).toEqual([
      "A a.txt",
      "M b.txt",
      "A c.txt",
    ])
  })

  it("has nothing for a base that does not exist, and nothing when nothing differs", () => {
    put("a.txt", "a")
    commit()
    expect(changedFiles(dir, "main")).toEqual([])
    expect(changedFiles(dir, "no-such-ref")).toEqual([])
  })

  it("counts the lines of a file that changes by more than nine, in either direction", () => {
    put("big.txt", `${"a\n".repeat(30)}`)
    commit()
    put("big.txt", `${"b\n".repeat(22)}`)
    expect(changedFiles(dir, "main")).toEqual([
      { path: "big.txt", status: "M", added: 22, removed: 30 },
    ])
  })

  it("counts a binary file as changed with no lines", () => {
    put("a.txt", "a")
    commit()
    writeFileSync(path.join(dir, "image.bin"), Buffer.from([0, 1, 2, 0, 255]))
    git("add", "image.bin")
    const [file] = changedFiles(dir, "main").filter((f) => f.path === "image.bin")
    expect(file).toMatchObject({ status: "A", added: 0, removed: 0 })
  })
})

describe("changesets", () => {
  it("reads each package, bump and summary of the pending changesets, in file order, and not the readme", () => {
    put(".changeset/README.md", "# not one\n")
    put(".changeset/b.md", '---\n"pkg-b": patch\n---\n\nfix: second\n')
    put(".changeset/a.md", '---\n"pkg-a": minor\n"pkg-c": major\n---\nfeat: first\n\nwith detail\n')
    put(".changeset/notes.txt", "ignored")
    put(".changeset/broken.md", "no frontmatter at all")
    expect(changesets(dir)).toEqual([
      { package: "pkg-a", bump: "minor", summary: "feat: first\n\nwith detail", file: "a.md" },
      { package: "pkg-c", bump: "major", summary: "feat: first\n\nwith detail", file: "a.md" },
      { package: "pkg-b", bump: "patch", summary: "fix: second", file: "b.md" },
    ])
  })

  it("is empty without a changeset folder", () => {
    expect(changesets(dir)).toEqual([])
  })
})

describe("exceptionChanges", () => {
  const registry = (...records: [string, string][]): string =>
    JSON.stringify({ exceptions: records.map(([id, justification]) => ({ id, justification })) })

  it("names each exception a change records or retires, with its reason, per registry", () => {
    put(
      ".repo-contract/exceptions/mutation.json",
      registry(["keep", "stays"], ["retire", "no longer needed"]),
    )
    put(".repo-contract/exceptions/removed.json", registry(["old", "whole registry goes"]))
    commit()
    put(
      ".repo-contract/exceptions/mutation.json",
      registry(["keep", "stays"], ["add", "new reason"]),
    )
    rmSync(path.join(dir, ".repo-contract/exceptions/removed.json"))
    put(".repo-contract/exceptions/fresh.json", registry(["first", "brand new"]))
    expect(exceptionChanges(dir, "main")).toEqual([
      { registry: "fresh", id: "first", justification: "brand new", change: "added" },
      { registry: "mutation", id: "add", justification: "new reason", change: "added" },
      { registry: "mutation", id: "retire", justification: "no longer needed", change: "removed" },
      { registry: "removed", id: "old", justification: "whole registry goes", change: "removed" },
    ])
  })

  it("reads a record with no justification as an empty one, and a registry it cannot parse as having none", () => {
    put(".repo-contract/exceptions/a.json", JSON.stringify({ exceptions: [{ id: "x" }] }))
    put(".repo-contract/exceptions/b.json", "not json")
    expect(exceptionChanges(dir, "main")).toEqual([
      { registry: "a", id: "x", justification: "", change: "added" },
    ])
  })

  it("has nothing to say when there are no registries, or none that are JSON", () => {
    put("a.txt", "a")
    commit()
    put(".repo-contract/exceptions/notes.md", "x")
    expect(exceptionChanges(dir, "main")).toEqual([])
  })
})

describe("newDecisions", () => {
  it("lists the decision records a change adds, by their title, or by file name when they have none", () => {
    put("specs/decisions/0001-old.md", "# 0001: old\n")
    commit()
    put("specs/decisions/0002-new.md", "# 0002: a new decision\n\nbody")
    put("specs/decisions/0003-untitled.md", "just text")
    put("specs/decisions/notes.txt", "# not markdown")
    expect(newDecisions(dir, "main").sort((a, b) => a.file.localeCompare(b.file))).toEqual([
      { file: "specs/decisions/0002-new.md", title: "0002: a new decision" },
      { file: "specs/decisions/0003-untitled.md", title: "0003-untitled" },
    ])
  })
})

describe("dependencyChanges", () => {
  it("says what was added, removed or moved to another range, per field", () => {
    put(
      "package.json",
      JSON.stringify({
        dependencies: { keep: "^1.0.0", move: "^1.0.0", drop: "^2.0.0" },
        devDependencies: { dev: "^1.0.0" },
      }),
    )
    commit()
    put(
      "package.json",
      JSON.stringify({
        dependencies: { keep: "^1.0.0", move: "^2.0.0", added: "^3.0.0" },
        devDependencies: { dev: "^1.0.0" },
        peerDependencies: { peer: ">=1" },
      }),
    )
    expect(dependencyChanges(dir, "main")).toEqual([
      { name: "added", field: "dependencies", from: undefined, to: "^3.0.0" },
      { name: "drop", field: "dependencies", from: "^2.0.0", to: undefined },
      { name: "move", field: "dependencies", from: "^1.0.0", to: "^2.0.0" },
      { name: "peer", field: "peerDependencies", from: undefined, to: ">=1" },
    ])
  })

  it("is empty with no manifest, or one that cannot be read", () => {
    put("a.txt", "a")
    commit()
    expect(dependencyChanges(dir, "main")).toEqual([])
    put("package.json", "not json")
    expect(dependencyChanges(dir, "main")).toEqual([])
  })
})

describe("contractChecks", () => {
  it("reads what each check found, an empty reason when it gave none, and nothing when there was no run", () => {
    expect(contractChecks(dir)).toBeUndefined()
    put(
      "reports/contract/report.json",
      JSON.stringify({
        checks: [
          { id: "A", outcome: "pass", rationale: "fine" },
          { id: "B", outcome: "warn" },
        ],
      }),
    )
    expect(contractChecks(dir)).toEqual([
      { id: "A", outcome: "pass", rationale: "fine" },
      { id: "B", outcome: "warn", rationale: "" },
    ])
    put("reports/contract/report.json", "not json")
    expect(contractChecks(dir)).toBeUndefined()
  })
})

describe("what the pending changesets are", () => {
  it("leaves out the readme and anything that is not Markdown, even when it looks like a changeset", () => {
    const body = '---\n"pkg": minor\n---\nfeat: x\n'
    put(".changeset/README.md", body)
    put(".changeset/notes.txt", body)
    put(".changeset/md", body)
    put(".changeset/real.md", body)
    expect(changesets(dir).map((set) => set.file)).toEqual(["real.md"])
  })

  it("reads only a header that opens the file, and only lines that name a package and a bump", () => {
    put(".changeset/late.md", 'text first\n---\n"pkg": minor\n---\nsummary\n')
    put(".changeset/unclosed.md", '---\n"pkg": minor\nsummary\n')
    put(".changeset/noline.md", '---\n"pkg": minor\n---')
    put(
      ".changeset/mixed.md",
      '---\n  "indented": patch  \n"two words": minor\nunquoted: minor\n"junk": minor extra\nx "prefixed": minor\n"": minor\n"ok": major\n---\n\n  the summary  \n\nmore\n\n',
    )
    expect(changesets(dir)).toEqual([
      { package: "indented", bump: "patch", summary: "the summary  \n\nmore", file: "mixed.md" },
      { package: "two words", bump: "minor", summary: "the summary  \n\nmore", file: "mixed.md" },
      { package: "ok", bump: "major", summary: "the summary  \n\nmore", file: "mixed.md" },
    ])
  })

  it("lists them in file order whatever order they were made in", () => {
    for (const name of ["c", "a", "b"])
      put(`.changeset/${name}.md`, `---\n"${name}": patch\n---\n${name}\n`)
    expect(changesets(dir).map((set) => set.package)).toEqual(["a", "b", "c"])
  })
})

describe("defaultBase, and the ref it prefers", () => {
  it("prefers origin/main to main, and takes main when there is no origin/main", () => {
    put("a.txt", "a")
    commit()
    expect(defaultBase(dir)).toBe("main")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    expect(defaultBase(dir)).toBe("origin/main")
  })
})

describe("exception changes in more detail", () => {
  const registry = (...ids: string[]): string =>
    JSON.stringify({ exceptions: ids.map((id) => ({ id, justification: `why ${id}` })) })

  it("lists registries in name order, including one that exists only on the base, and ignores what is not a registry", () => {
    put(".repo-contract/exceptions/a-gone.json", registry("old"))
    commit()
    rmSync(path.join(dir, ".repo-contract/exceptions/a-gone.json"))
    put(".repo-contract/exceptions/m-new.json", registry("new"))
    put(".repo-contract/exceptions/notes.md", "# not a registry")
    put(".repo-contract/exceptions/broken.json", "{ nope")
    put(".repo-contract/exceptions/shape.json", JSON.stringify({ other: [] }))
    expect(exceptionChanges(dir, "main").map((e) => `${e.registry}:${e.change}:${e.id}`)).toEqual([
      "a-gone:removed:old",
      "m-new:added:new",
    ])
  })

  it("names a registry by its file name without the extension, and reads a registry that was already broken as empty", () => {
    put(".repo-contract/exceptions/x.json.json", registry("a"))
    expect(exceptionChanges(dir, "main")[0]?.registry).toBe("x.json")
  })

  it("has nothing to say about a base that does not exist", () => {
    put(".repo-contract/exceptions/a.json", registry("a"))
    expect(exceptionChanges(dir, "no-such-ref").map((e) => e.change)).toEqual(["added"])
  })
})

describe("decision records in more detail", () => {
  it("lists the ones a change adds whether or not they are tracked yet, once each, and only Markdown under the decisions folder", () => {
    put("specs/decisions/0001-old.md", "# 0001: old\n")
    commit()
    put("specs/decisions/0009-staged.md", "# 0009: staged\n")
    git("add", "specs/decisions/0009-staged.md")
    put("specs/decisions/0003-untracked.md", "intro\n## not the title\n# 0003: the title\nbody\n")
    put("specs/decisions/0004-none.md", "## only a subheading\n")
    put("specs/decisions/notes.txt", "# not Markdown")
    put("other/0005-elsewhere.md", "# not a decision")
    expect(newDecisions(dir, "main")).toEqual([
      { file: "specs/decisions/0003-untracked.md", title: "0003: the title" },
      { file: "specs/decisions/0004-none.md", title: "0004-none" },
      { file: "specs/decisions/0009-staged.md", title: "0009: staged" },
    ])
  })

  it("does not list a record that was already on the base, and is empty for a base that does not exist", () => {
    put("specs/decisions/0001-old.md", "# 0001: old\n")
    commit()
    expect(newDecisions(dir, "main")).toEqual([])
    expect(newDecisions(dir, "no-such-ref")).toEqual([])
  })
})

describe("dependency changes in more detail", () => {
  it("treats the same name in two fields as two dependencies, and leaves out what did not change", () => {
    put(
      "package.json",
      JSON.stringify({
        dependencies: { shared: "^1.0.0", same: "^1.0.0" },
        devDependencies: { shared: "^1.0.0" },
      }),
    )
    commit()
    put(
      "package.json",
      JSON.stringify({
        dependencies: { shared: "^1.0.0", same: "^1.0.0" },
        devDependencies: { shared: "^2.0.0" },
      }),
    )
    expect(dependencyChanges(dir, "main")).toEqual([
      { name: "shared", field: "devDependencies", from: "^1.0.0", to: "^2.0.0" },
    ])
  })

  it("reports every dependency as removed when the manifest is gone, and added when it is new", () => {
    put(
      "package.json",
      JSON.stringify({ dependencies: { a: "1.0.0" }, optionalDependencies: { b: "2.0.0" } }),
    )
    commit()
    rmSync(path.join(dir, "package.json"))
    expect(dependencyChanges(dir, "main")).toEqual([
      { name: "a", field: "dependencies", from: "1.0.0", to: undefined },
      { name: "b", field: "optionalDependencies", from: "2.0.0", to: undefined },
    ])
  })

  it("lists them in field and name order", () => {
    put(
      "package.json",
      JSON.stringify({ devDependencies: { z: "1", a: "1" }, dependencies: { m: "1" } }),
    )
    expect(dependencyChanges(dir, "no-such-ref").map((d) => `${d.field}:${d.name}`)).toEqual([
      "dependencies:m",
      "devDependencies:a",
      "devDependencies:z",
    ])
  })
})

describe("collect, with other files changing too", () => {
  it("counts a changeset this change edits, and not one it leaves alone or removes", () => {
    put("package.json", JSON.stringify({ name: "demo" }))
    put(".changeset/edited.md", '---\n"demo": patch\n---\nold\n')
    put(".changeset/untouched.md", '---\n"demo": patch\n---\nsame\n')
    put(".changeset/removed.md", '---\n"demo": patch\n---\ngone\n')
    commit()
    put(".changeset/edited.md", '---\n"demo": minor\n---\nnew\n')
    rmSync(path.join(dir, ".changeset/removed.md"))
    put("src/a.ts", "export {}\n")
    expect(collect(dir, "main").changesets.map((set) => `${set.file}:${set.bump}`)).toEqual([
      "edited.md:minor",
    ])
  })

  it("leaves out a changeset of the same name in another folder, and one only named alike", () => {
    put("package.json", JSON.stringify({ name: "demo" }))
    commit()
    put("other/a.md", '---\n"demo": patch\n---\nx\n')
    put(".changeset/a.md", '---\n"demo": patch\n---\ny\n')
    expect(collect(dir, "main").changesets.map((set) => set.file)).toEqual(["a.md"])
    rmSync(path.join(dir, ".changeset/a.md"))
    expect(collect(dir, "main").changesets).toEqual([])
  })
})

describe("collect", () => {
  it("gathers the package, the base and head, and only the changesets this change adds", () => {
    put("package.json", JSON.stringify({ name: "demo", version: "1.2.3" }))
    put(".changeset/old.md", '---\n"demo": patch\n---\nalready waiting on the base\n')
    commit()
    put(".changeset/new.md", '---\n"demo": minor\n---\nthis change\n')
    const facts = collect(dir, "main")
    expect(facts.package).toBe("demo")
    expect(facts.version).toBe("1.2.3")
    expect(facts.base).toBe("main")
    expect(facts.head).toMatch(/^[0-9a-f]{7,}$/)
    expect(facts.changesets).toEqual([
      { package: "demo", bump: "minor", summary: "this change", file: "new.md" },
    ])
  })

  it("falls back to the folder's name when there is no manifest, and counts a deleted changeset as none", () => {
    put(".changeset/gone.md", '---\n"x": patch\n---\nremoved\n')
    commit()
    rmSync(path.join(dir, ".changeset/gone.md"))
    const facts = collect(dir, "main")
    expect(facts.package).toBe(path.basename(dir))
    expect(facts.changesets).toEqual([])
  })
})

const facts = (over: Partial<ReturnType<typeof collect>> = {}): ReturnType<typeof collect> => ({
  package: "demo",
  version: "1.0.0",
  base: "origin/main",
  head: "abc1234",
  files: [
    { path: "src/a.ts", status: "M", added: 10, removed: 2 },
    { path: "src/b.ts", status: "A", added: 5, removed: 0 },
    { path: "test/a.test.ts", status: "A", added: 30, removed: 0 },
  ],
  changesets: [
    { package: "demo", bump: "minor", summary: "feat: do it\n\nlong text", file: "a.md" },
  ],
  exceptions: [],
  decisions: [],
  dependencies: [],
  checks: [{ id: "Tests", outcome: "pass", rationale: "Vitest completed 12 test(s).\nmore" }],
  ...over,
})

describe("render", () => {
  it("opens with the package, the base and head and the version, then what changed by area", () => {
    const text = render(facts())
    expect(
      text.startsWith(
        "# demo: what this change does\n\nMeasured against `origin/main` at `abc1234`, version 1.0.0.\n",
      ),
    ).toBe(true)
    expect(text).toContain(
      "| Area | Files | Added | Removed |\n|---|---|---|---|\n| Source | 2 | +15 | -2 |\n| Tests | 1 | +30 | -0 |\n",
    )
  })

  it("says what the release is, by changeset, and what it is when there is none", () => {
    expect(render(facts())).toContain(
      "## What it means for a release\n\n- `demo` **minor**: feat: do it\n",
    )
    expect(render(facts({ changesets: [] }))).toContain(
      "No changeset: nothing is released from this change as it stands.",
    )
  })

  it("leaves out a section with nothing in it", () => {
    const text = render(facts())
    for (const heading of ["## Decisions recorded", "## Exceptions", "## Dependencies"])
      expect(text).not.toContain(heading)
  })

  it("lists decisions, exceptions with the first sentence of their reason, and dependencies", () => {
    const text = render(
      facts({
        decisions: [{ file: "specs/decisions/0050-x.md", title: "0050: x" }],
        exceptions: [
          {
            registry: "mutation",
            id: "m:1",
            justification: "Equivalent mutant. And more reasons follow.",
            change: "added",
          },
          { registry: "mutation", id: "m:2", justification: "", change: "removed" },
        ],
        dependencies: [
          { name: "a", field: "dependencies", from: undefined, to: "^1.0.0" },
          { name: "b", field: "devDependencies", from: "^1.0.0", to: undefined },
          { name: "c", field: "dependencies", from: "^1.0.0", to: "^2.0.0" },
        ],
      }),
    )
    expect(text).toContain("## Decisions recorded\n\n- [0050: x](specs/decisions/0050-x.md)\n")
    expect(text).toContain("- **added** in `mutation`: `m:1` — Equivalent mutant.\n")
    expect(text).toContain("- **removed** in `mutation`: `m:2`\n")
    expect(text).toContain("- `a` (dependencies): added `^1.0.0`\n")
    expect(text).toContain("- `b` (devDependencies): removed (was `^1.0.0`)\n")
    expect(text).toContain("- `c` (dependencies): `^1.0.0` to `^2.0.0`\n")
  })

  it("shows the checks a reviewer wants in a fixed order, with the first line of what each said", () => {
    const text = render(
      facts({
        checks: [
          { id: "Mutation", outcome: "pass", rationale: "score 100%" },
          { id: "Tests", outcome: "pass", rationale: "12 tests\nsecond line" },
          { id: "Other", outcome: "pass", rationale: "not shown" },
        ],
      }),
    )
    expect(text).toContain(
      "| Check | Outcome | What it says |\n|---|---|---|\n| Tests | pass | 12 tests |\n| Mutation | pass | score 100% |\n",
    )
    expect(text).not.toContain("not shown")
    expect(text).toContain("3 checks: 3 pass.")
  })

  it("names every check that is not clean, and the ones skipped", () => {
    const text = render(
      facts({
        checks: [
          { id: "Tests", outcome: "pass", rationale: "ok" },
          { id: "Lint", outcome: "fail", rationale: "3 errors | in 2 files\ndetail" },
          { id: "Docs", outcome: "warn", rationale: "stale" },
          { id: "Slow", outcome: "skipped", rationale: "left out" },
        ],
      }),
    )
    expect(text).toContain("4 checks: 1 pass, 1 fail, 1 warn, 1 skipped.")
    expect(text).toContain(
      "Not clean:\n\n- `Lint` (fail): 3 errors | in 2 files\n- `Docs` (warn): stale\n",
    )
    expect(text).toContain("Skipped in this run: `Slow`.")
  })

  it("shortens a long line, and escapes a table separator inside a cell", () => {
    const long = "x".repeat(300)
    const text = render(
      facts({
        checks: [
          { id: "Tests", outcome: "pass", rationale: `${long}` },
          { id: "Coverage", outcome: "pass", rationale: "a | b" },
        ],
      }),
    )
    expect(text).toContain(`| Tests | pass | ${"x".repeat(219)}… |`)
    expect(text).toContain("| Coverage | pass | a \\| b |")
  })

  it("says the contract has not been run when there is no report, and names what no local run can see", () => {
    const text = render(facts({ checks: undefined }))
    expect(text).toContain("The contract has not been run here: run it, then this report again.")
    expect(text).toContain("## Not seen by this report\n\n")
    for (const item of CI_ONLY) expect(text).toContain(`- ${item}\n`)
    expect(EVIDENCE).toContain("Mutation")
  })

  it("says so when nothing differs, and leaves out the head and version when it has none", () => {
    const text = render(facts({ files: [], head: "", version: undefined }))
    expect(text).toContain("Measured against `origin/main`.\n")
    expect(text).toContain("Nothing differs from the base.")
    expect(text).not.toContain("## What changed")
  })
})

describe("render, exactly", () => {
  const rich = (): ReturnType<typeof collect> =>
    facts({
      files: [
        { path: "src/a.ts", status: "M", added: 10, removed: 2 },
        { path: "test/a.test.ts", status: "A", added: 30, removed: 0 },
        { path: "benchmarks/x/suite.mjs", status: "A", added: 4, removed: 0 },
        { path: "specs/decisions/0001-x.md", status: "A", added: 6, removed: 0 },
        { path: ".repo-contract/exceptions/mutation.json", status: "M", added: 1, removed: 1 },
        { path: ".github/workflows/ci.yml", status: "M", added: 2, removed: 1 },
        { path: "scripts/a.mjs", status: "M", added: 3, removed: 3 },
        { path: "package.json", status: "M", added: 1, removed: 1 },
      ],
      changesets: [
        { package: "demo", bump: "minor", summary: "feat: first\n\nmore", file: "a.md" },
        { package: "demo", bump: "patch", summary: "fix: second", file: "b.md" },
      ],
      decisions: [{ file: "specs/decisions/0001-x.md", title: "0001: x" }],
      exceptions: [
        { registry: "mutation", id: "m:1", justification: "Equivalent. More.", change: "added" },
        { registry: "mutation", id: "m:2", justification: "", change: "removed" },
      ],
      dependencies: [
        { name: "a", field: "dependencies", from: undefined, to: "^1.0.0" },
        { name: "b", field: "devDependencies", from: "^1.0.0", to: undefined },
        { name: "c", field: "dependencies", from: "^1.0.0", to: "^2.0.0" },
      ],
      checks: [
        { id: "Tests", outcome: "pass", rationale: "12 tests passed." },
        { id: "Mutation", outcome: "pass", rationale: "score 100%" },
        { id: "Lint", outcome: "fail", rationale: "3 errors\ndetail" },
        { id: "Docs", outcome: "warn", rationale: "stale" },
        { id: "Slow", outcome: "skipped", rationale: "left out" },
      ],
    })

  it("is exactly this when every section has something in it", () => {
    expect(render(rich())).toMatchSnapshot()
  })

  it("is exactly this when there is nothing to report and the contract has not been run", () => {
    expect(
      render(facts({ files: [], changesets: [], checks: undefined, version: undefined, head: "" })),
    ).toMatchSnapshot()
  })

  it("is exactly this when the checks are all clean and none is one a reviewer asks for", () => {
    expect(
      render(facts({ checks: [{ id: "Other", outcome: "pass", rationale: "fine" }] })),
    ).toMatchSnapshot()
  })

  it("shows a table of checks, and says what is not clean or skipped, only when there is something to say", () => {
    const clean = render(facts({ checks: [{ id: "Other", outcome: "pass", rationale: "fine" }] }))
    expect(clean).not.toContain("| Check |")
    expect(clean).not.toContain("Not clean:")
    expect(clean).not.toContain("Skipped in this run")
    const evidenceOnly = render(
      facts({ checks: [{ id: "Tests", outcome: "pass", rationale: "ok" }] }),
    )
    expect(evidenceOnly).toContain("| Check |")
    expect(evidenceOnly).not.toContain("Not clean:")
    expect(evidenceOnly).not.toContain("Skipped in this run")
    const warnOnly = render(
      facts({ checks: [{ id: "Docs", outcome: "warn", rationale: "stale" }] }),
    )
    expect(warnOnly).toContain("Not clean:")
    expect(warnOnly).not.toContain("| Check |")
    expect(warnOnly).not.toContain("Skipped in this run")
    const skippedOnly = render(
      facts({ checks: [{ id: "Slow", outcome: "skipped", rationale: "x" }] }),
    )
    expect(skippedOnly).toContain("Skipped in this run: `Slow`.")
    expect(skippedOnly).not.toContain("Not clean:")
    const twoSkipped = render(
      facts({
        checks: [
          { id: "A", outcome: "skipped", rationale: "" },
          { id: "B", outcome: "skipped", rationale: "" },
        ],
      }),
    )
    expect(twoSkipped).toContain("Skipped in this run: `A`, `B`.")
  })

  it("leaves a line of exactly 220 characters whole and shortens one of 221, after trimming and keeping the first line", () => {
    const exact = "x".repeat(220)
    const over = "x".repeat(221)
    const text = render(
      facts({
        checks: [
          { id: "Tests", outcome: "pass", rationale: `  ${exact}  \nsecond` },
          { id: "Mutation", outcome: "pass", rationale: over },
        ],
      }),
    )
    expect(text).toContain(`| Tests | pass | ${exact} |`)
    expect(text).toContain(`| Mutation | pass | ${"x".repeat(219)}… |`)
  })

  it("keeps the first sentence of an exception's reason, however it is wrapped and punctuated", () => {
    const line = (justification: string): string =>
      render(facts({ exceptions: [{ registry: "r", id: "i", justification, change: "added" }] }))
        .split("\n")
        .filter((row) => row.startsWith("- **added**"))
        .join("")
    expect(line("One sentence only")).toBe("- **added** in `r`: `i` — One sentence only")
    expect(line("First part\nwrapped  across   lines. Second.")).toBe(
      "- **added** in `r`: `i` — First part wrapped across lines.",
    )
    expect(line("Is it? Yes.")).toBe("- **added** in `r`: `i` — Is it?")
    expect(line("Stop! Then more.")).toBe("- **added** in `r`: `i` — Stop!")
    expect(line("Ends here.")).toBe("- **added** in `r`: `i` — Ends here.")
    expect(line("Version 1.2 is not a sentence end. But this is.")).toBe(
      "- **added** in `r`: `i` — Version 1.2 is not a sentence end.",
    )
    expect(line("  padded  ")).toBe("- **added** in `r`: `i` — padded")
  })

  it("counts the checks in the singular and the plural", () => {
    expect(render(facts({ checks: [{ id: "A", outcome: "pass", rationale: "" }] }))).toContain(
      "\n1 check: 1 pass.\n",
    )
    expect(
      render(
        facts({
          checks: [
            { id: "A", outcome: "pass", rationale: "" },
            { id: "B", outcome: "pass", rationale: "" },
          ],
        }),
      ),
    ).toContain("\n2 checks: 2 pass.\n")
  })

  it("names an area only when something changed in it, in a fixed order", () => {
    const text = render(
      facts({
        files: [
          { path: "package.json", status: "M", added: 1, removed: 0 },
          { path: "src/a.ts", status: "M", added: 1, removed: 0 },
        ],
      }),
    )
    expect(text).toContain("| Source | 1 | +1 | -0 |\n| Configuration | 1 | +1 | -0 |\n")
    expect(text).not.toContain("| Tests | 1 |")
  })
})

describe("run", () => {
  it("prints the report, measured against main when no base is given", () => {
    put("package.json", JSON.stringify({ name: "demo", version: "0.1.0" }))
    commit()
    put("src/a.ts", "export {}\n")
    const { out, err, io } = withIo()
    expect(run([], dir, io)).toBe(0)
    expect(out.join("")).toContain("# demo: what this change does")
    expect(out.join("")).toContain("Measured against `main`")
    expect(err).toEqual([])
  })

  it("writes it to a file, relative to the package, when asked", () => {
    put("package.json", JSON.stringify({ name: "demo" }))
    commit()
    const { out, io } = withIo()
    expect(run(["--out", "report.md", "--base", "main"], dir, io)).toBe(0)
    expect(out.join("")).toBe("[report] wrote report.md\n")
    expect(readFileSync(path.join(dir, "report.md")).toString()).toContain(
      "# demo: what this change does",
    )
  })

  it("refuses what it does not understand, a missing value, and a repository with nothing to measure against", () => {
    const unknown = withIo()
    expect(run(["--nope"], dir, unknown.io)).toBe(1)
    expect(unknown.err.join("")).toContain("report: unknown argument --nope.")
    const missing = withIo()
    expect(run(["--base"], dir, missing.io)).toBe(1)
    expect(missing.err.join("")).toContain("report: --base needs a value.")
    const noOut = withIo()
    expect(run(["--out"], dir, noOut.io)).toBe(1)
    expect(noOut.err.join("")).toContain("report: --out needs a value.")
    const none = withIo()
    expect(run([], dir, none.io)).toBe(1)
    expect(none.err.join("")).toContain("no base to measure against")
  })
})
