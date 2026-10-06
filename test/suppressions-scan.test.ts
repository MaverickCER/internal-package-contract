import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  listScannableFiles,
  parseDirective,
  scanMarkdown,
  scanRepository,
  scanSource,
} from "../scripts/suppressions-scan.mjs"

const scan = (text: string, file = "src/a.ts") => scanSource(file, text, ts)

describe("parseDirective()", () => {
  it("reads ESLint's rules and its `--` reason, in every form", () => {
    expect(
      parseDirective(
        " eslint-disable-next-line no-console, no-alert -- the CLI prints to the terminal",
        "line",
      ),
    ).toEqual([
      {
        domain: "eslint",
        directive: "eslint-disable-next-line",
        rules: ["no-console", "no-alert"],
        reason: "the CLI prints to the terminal",
        blanket: false,
        closing: false,
      },
    ])
    expect(parseDirective(" eslint-disable ", "block")[0]).toMatchObject({
      blanket: true,
      rules: [],
    })
    expect(parseDirective(" eslint-enable no-console ", "block")[0]).toMatchObject({
      closing: true,
      blanket: false,
    })
    expect(parseDirective(" eslint-disable-line", "line")[0]?.directive).toBe("eslint-disable-line")
  })

  it("treats @ts-ignore and @ts-nocheck as blanket, @ts-expect-error as not", () => {
    expect(
      parseDirective(" @ts-expect-error the fixture is deliberately the wrong shape", "line")[0],
    ).toMatchObject({
      domain: "typescript",
      blanket: false,
      reason: "the fixture is deliberately the wrong shape",
    })
    expect(parseDirective(" @ts-ignore", "line")[0]).toMatchObject({ blanket: true })
    expect(parseDirective(" @ts-nocheck -- legacy", "line")[0]).toMatchObject({
      blanket: true,
      reason: "legacy",
    })
    expect(parseDirective(" @ts-expect-error: because", "line")[0]?.reason).toBe("because")
  })

  it("reads Stryker's mutators and its `:` or `--` reason, and restore as closing", () => {
    expect(
      parseDirective(
        " Stryker disable next-line StringLiteral, ArrayDeclaration: an equivalent mutant",
        "line",
      )[0],
    ).toEqual({
      domain: "stryker",
      directive: "Stryker disable next-line",
      rules: ["StringLiteral", "ArrayDeclaration"],
      reason: "an equivalent mutant",
      blanket: false,
      closing: false,
    })
    expect(parseDirective(" Stryker disable all -- fixed constants", "line")[0]).toMatchObject({
      rules: ["all"],
      reason: "fixed constants",
    })
    expect(parseDirective(" Stryker restore ConditionalExpression", "line")[0]).toMatchObject({
      closing: true,
    })
    expect(parseDirective(" Stryker disable ConditionalExpression", "line")[0]).toMatchObject({
      reason: "",
    })
  })

  it("reads coverage ignores, jscpd, prettier, secretlint and ignores unrelated comments", () => {
    expect(
      parseDirective(" v8 ignore next -- platform branch covered on Windows CI", "block")[0],
    ).toMatchObject({
      domain: "coverage",
      directive: "v8 ignore next",
      reason: "platform branch covered on Windows CI",
    })
    expect(parseDirective(" c8 ignore stop ", "block")[0]).toMatchObject({ closing: true })
    expect(parseDirective(" istanbul ignore if", "line")[0]).toMatchObject({ domain: "coverage" })
    expect(parseDirective(" jscpd:ignore-start -- table-driven", "line")[0]).toMatchObject({
      domain: "jscpd",
      closing: false,
    })
    expect(parseDirective(" jscpd:ignore-end", "line")[0]).toMatchObject({ closing: true })
    expect(parseDirective(" prettier-ignore", "line")[0]).toMatchObject({ domain: "prettier" })
    expect(parseDirective(" secretlint-disable no-dotenv -- example", "line")[0]).toMatchObject({
      domain: "secretlint",
      rules: ["no-dotenv"],
    })
    expect(parseDirective(" secretlint-disable", "line")[0]).toMatchObject({ blanket: true })
    expect(parseDirective(" secretlint-enable", "line")[0]).toMatchObject({ closing: true })
    expect(parseDirective(" just a comment that mentions eslint-disable in prose", "line")).toEqual(
      [],
    )
    expect(parseDirective("* eslint-disable no-console -- why", "block")[0]?.domain).toBe("eslint")
  })
})

describe("scanSource()", () => {
  it("finds suppressions in comments only, never in strings, templates or prose", () => {
    const found = scan(
      [
        'const a = "// eslint-disable-next-line no-console -- not a comment"',
        "const b = `/* eslint-disable */`",
        "/** Docs: write `// eslint-disable-next-line rule -- why` above the line. */",
        "// eslint-disable-next-line no-console -- the CLI prints to the terminal",
        "console.log(a, b)",
      ].join("\n"),
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      domain: "eslint",
      rule: "no-console",
      line: 4,
      documented: true,
      blanket: false,
    })
  })

  it("accepts a reason on the directive, or in the comment block directly above it", () => {
    const found = scan(
      [
        "// Stryker disable next-line StringLiteral: an equivalent mutant, readFile yields a Buffer",
        'read("utf8")',
        "",
        "// This memoization is covered by a dedicated test that fails when the guard is removed by hand,",
        "// yet Stryker reports the mutant as surviving; it is a measurement defect, not a coverage gap.",
        "// Stryker disable ConditionalExpression",
        "if (!cached) fill()",
        "// Stryker restore ConditionalExpression",
        "",
        "// short",
        "// Stryker disable StringLiteral",
        'name("x")',
      ].join("\n"),
    )
    expect(found.map((s) => [s.directive, s.documented, s.closing])).toEqual([
      ["Stryker disable next-line", true, false],
      ["Stryker disable", true, false],
      ["Stryker restore", false, true],
      ["Stryker disable", false, false],
    ])
    expect(found[1]?.blockReason).toContain("measurement defect")
  })

  it("flags a blanket eslint-disable and an undocumented one", () => {
    const found = scan(
      "/* eslint-disable */\n// eslint-disable-next-line no-console\nconsole.log(1)\n",
    )
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({ blanket: true, rule: "*", documented: false })
    expect(found[1]).toMatchObject({ blanket: false, documented: false })
  })

  it("reads a block comment whose reason runs onto the following lines", () => {
    const found = scan(
      [
        "/* eslint-disable @typescript-eslint/no-explicit-any",
        " * suites are plain user-shaped data, typed loosely on purpose */",
        "export {}",
      ].join("\n"),
    )
    expect(found[0]).toMatchObject({
      documented: true,
      reason: "suites are plain user-shaped data, typed loosely on purpose",
    })
  })

  it("anchors the id to the directive and the code it covers, not to the line number", () => {
    const body =
      "// eslint-disable-next-line no-console -- the CLI prints to the terminal\nconsole.log(1)\n"
    const at = scan(body)[0]
    const moved = scan(`\n\n\n// unrelated\n${body}`)[0]
    expect(moved?.line).not.toBe(at?.line)
    expect(moved?.id).toBe(at?.id)
    expect(at?.id).toMatch(/^suppression:eslint:no-console:src\/a\.ts:[0-9a-f]{12}$/)
    const changed = scan(body.replace("console.log(1)", "console.warn(1)"))[0]
    expect(changed?.id).not.toBe(at?.id)
  })

  it("scans comments after the last statement and in TSX", () => {
    expect(scan("export {}\n// @ts-expect-error nothing is wrong here, on purpose\n")).toHaveLength(
      1,
    )
    const tsx = scanSource(
      "src/a.tsx",
      "const x = <div>{/* eslint-disable-next-line no-alert -- fixture */ 1}</div>",
      ts,
    )
    expect(tsx).toHaveLength(1)
  })
})

describe("scanMarkdown()", () => {
  it("finds markdownlint directives in HTML comments", () => {
    const found = scanMarkdown(
      "docs/a.md",
      [
        "# T",
        "<!-- markdownlint-disable MD033 -- the badge row is inline HTML -->",
        "<!-- markdownlint-enable MD033 -->",
        "<!-- markdownlint-disable -->",
        "<!-- an ordinary comment -->",
        "<!-- markdownlint-capture -->",
      ].join("\n"),
    )
    expect(found.map((s) => [s.directive, s.rule, s.documented, s.blanket, s.closing])).toEqual([
      ["markdownlint-disable", "MD033", true, false, false],
      ["markdownlint-enable", "MD033", false, false, true],
      ["markdownlint-disable", "*", false, true, false],
    ])
    expect(found[0]?.line).toBe(2)
  })
})

describe("scanRepository() / listScannableFiles()", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-suppressions-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const write = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    writeFileSync(path.join(dir, rel), body)
  }

  it("scans the repository's own source and docs, and skips generated, vendored and scaffolded trees", () => {
    write(
      "src/a.ts",
      "// @ts-expect-error the guard is exercised with the wrong shape on purpose\nf(1)\n",
    )
    write(
      "scripts/b.mjs",
      "// eslint-disable-next-line no-console -- the script prints its result\nconsole.log(1)\n",
    )
    write("README.md", "<!-- markdownlint-disable MD013 -- a table too wide to wrap -->\n")
    write("node_modules/x/index.js", "// eslint-disable\n")
    write("dist/a.js", "// eslint-disable\n")
    write("template/package/src/a.ts", "// eslint-disable\n")
    write("test/fixtures/f.ts", "// eslint-disable\n")
    write("notes.txt", "eslint-disable\n")
    expect(listScannableFiles(dir)).toEqual(["README.md", "scripts/b.mjs", "src/a.ts"])
    const { files, suppressions } = scanRepository(dir, ts)
    expect(files).toBe(3)
    expect(suppressions.map((s) => s.domain).sort()).toEqual([
      "eslint",
      "markdownlint",
      "typescript",
    ])
    expect(suppressions.every((s) => s.documented)).toBe(true)
  })

  it("resolves TypeScript from the repository it scans when none is supplied", () => {
    write("package.json", "{}")
    write("src/a.ts", "export {}\n")
    expect(() => scanRepository(dir)).toThrow()
  })
})
