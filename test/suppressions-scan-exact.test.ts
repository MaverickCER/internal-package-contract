import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DOMAINS,
  MIN_BLOCK_REASON_LENGTH,
  MIN_REASON_LENGTH,
  listScannableFiles,
  parseDirective,
  scanMarkdown,
  scanRepository,
  scanSource,
} from "../scripts/suppressions-scan.mjs"

const anchor = (directive: string, rule: string, covered: string): string =>
  createHash("sha256").update(`${directive}|${rule}|${covered}`).digest("hex").slice(0, 12)

const d = (
  domain: string,
  directive: string,
  rules: string[],
  reason: string,
  blanket: boolean,
  closing: boolean,
) => ({ domain, directive, rules, reason, blanket, closing })

describe("the constants", () => {
  it("govern eight tools and a reason of at least 15 words-characters, 30 when it sits above", () => {
    expect(DOMAINS).toEqual([
      "eslint",
      "typescript",
      "stryker",
      "coverage",
      "jscpd",
      "prettier",
      "markdownlint",
      "secretlint",
    ])
    expect(MIN_REASON_LENGTH).toBe(15)
    expect(MIN_BLOCK_REASON_LENGTH).toBe(30)
  })
})

describe("parseDirective -- every tool and form", () => {
  it.each([
    [
      "eslint-disable-next-line no-console",
      [d("eslint", "eslint-disable-next-line", ["no-console"], "", false, false)],
    ],
    [
      "eslint-disable-line a, b",
      [d("eslint", "eslint-disable-line", ["a", "b"], "", false, false)],
    ],
    [
      "eslint-disable a b -- because it is fine",
      [d("eslint", "eslint-disable", ["a", "b"], "because it is fine", false, false)],
    ],
    ["eslint-disable", [d("eslint", "eslint-disable", [], "", true, false)]],
    ["eslint-enable", [d("eslint", "eslint-enable", [], "", false, true)]],
    ["eslint-enable a", [d("eslint", "eslint-enable", ["a"], "", false, true)]],
    ["eslint-disable -- all of it", [d("eslint", "eslint-disable", [], "all of it", true, false)]],
    [
      "eslint-disable   a,\tb  --  spaced   out ",
      [d("eslint", "eslint-disable", ["a", "b"], "spaced out", false, false)],
    ],
    [
      "eslint-disable a: not a separator",
      [d("eslint", "eslint-disable", ["a:", "not", "a", "separator"], "", false, false)],
    ],
    ["eslint-disabled", []],
    ["not eslint-disable", []],
    ["", []],
    [
      "@ts-expect-error",
      [d("typescript", "@ts-expect-error", ["ts-expect-error"], "", false, false)],
    ],
    [
      "@ts-expect-error -- legacy typings",
      [d("typescript", "@ts-expect-error", ["ts-expect-error"], "legacy typings", false, false)],
    ],
    [
      "@ts-expect-error: legacy typings",
      [d("typescript", "@ts-expect-error", ["ts-expect-error"], "legacy typings", false, false)],
    ],
    [
      "@ts-expect-error legacy typings",
      [d("typescript", "@ts-expect-error", ["ts-expect-error"], "legacy typings", false, false)],
    ],
    ["@ts-ignore", [d("typescript", "@ts-ignore", ["ts-ignore"], "", true, false)]],
    [
      "@ts-nocheck -- generated",
      [d("typescript", "@ts-nocheck", ["ts-nocheck"], "generated", true, false)],
    ],
    ["@ts-nocheckx", []],
    ["Stryker disable", [d("stryker", "Stryker disable", [], "", false, false)]],
    [
      "Stryker disable next-line StringLiteral",
      [d("stryker", "Stryker disable next-line", ["StringLiteral"], "", false, false)],
    ],
    [
      "Stryker disable next-line A, B: it is equivalent",
      [d("stryker", "Stryker disable next-line", ["A", "B"], "it is equivalent", false, false)],
    ],
    [
      "Stryker disable A -- reason here",
      [d("stryker", "Stryker disable", ["A"], "reason here", false, false)],
    ],
    [
      "Stryker disable A: why -- not this",
      [d("stryker", "Stryker disable", ["A"], "why -- not this", false, false)],
    ],
    [
      "Stryker disable A -- why: not this",
      [d("stryker", "Stryker disable", ["A"], "why: not this", false, false)],
    ],
    ["Stryker disable all", [d("stryker", "Stryker disable", ["all"], "", false, false)]],
    [
      "Stryker   disable   next-line   A",
      [d("stryker", "Stryker disable next-line", ["A"], "", false, false)],
    ],
    [
      "Stryker disable next-linex A",
      [d("stryker", "Stryker disable", ["next-linex", "A"], "", false, false)],
    ],
    ["Stryker restore A", [d("stryker", "Stryker restore", ["A"], "", false, true)]],
    ["Stryker restore", [d("stryker", "Stryker restore", [], "", false, true)]],
    ["Stryker disabled", []],
    ["v8 ignore next", [d("coverage", "v8 ignore next", ["v8"], "", false, false)]],
    [
      "c8 ignore start -- reason text",
      [d("coverage", "c8 ignore start", ["c8"], "reason text", false, false)],
    ],
    [
      "istanbul ignore stop",
      [d("coverage", "istanbul ignore stop", ["istanbul"], "", false, true)],
    ],
    ["v8 ignore file", [d("coverage", "v8 ignore file", ["v8"], "", false, false)]],
    ["c8   ignore   if", [d("coverage", "c8 ignore if", ["c8"], "", false, false)]],
    [
      "istanbul ignore else",
      [d("coverage", "istanbul ignore else", ["istanbul"], "", false, false)],
    ],
    ["v8 ignore nextx", []],
    ["v8 ignorenext", []],
    ["jscpd:ignore-start", [d("jscpd", "jscpd:ignore-start", ["duplication"], "", false, false)]],
    [
      "jscpd:ignore-end -- done",
      [d("jscpd", "jscpd:ignore-end", ["duplication"], "done", false, true)],
    ],
    ["jscpd:ignore-middle", []],
    ["prettier-ignore", [d("prettier", "prettier-ignore", ["format"], "", false, false)]],
    [
      "prettier-ignore -- keep alignment",
      [d("prettier", "prettier-ignore", ["format"], "keep alignment", false, false)],
    ],
    [
      "prettier-ignore: keep alignment",
      [d("prettier", "prettier-ignore", ["format"], "keep alignment", false, false)],
    ],
    [
      "prettier-ignore keep alignment",
      [d("prettier", "prettier-ignore", ["format"], "keep alignment", false, false)],
    ],
    ["prettier-ignored", []],
    [
      "secretlint-disable-next-line rule-a",
      [d("secretlint", "secretlint-disable-next-line", ["rule-a"], "", false, false)],
    ],
    ["secretlint-disable-line", [d("secretlint", "secretlint-disable-line", [], "", true, false)]],
    [
      "secretlint-disable r -- test key",
      [d("secretlint", "secretlint-disable", ["r"], "test key", false, false)],
    ],
    ["secretlint-enable", [d("secretlint", "secretlint-enable", [], "", false, true)]],
    ["secretlint-enable r", [d("secretlint", "secretlint-enable", ["r"], "", false, true)]],
    ["secretlint-disabled", []],
    ["just a comment", []],
  ])("%j", (body, expected) => {
    expect(parseDirective(body, "line")).toEqual(expected)
  })

  it("ignores leading whitespace on a line comment, and a leading star run on a block comment", () => {
    expect(parseDirective("   eslint-disable a", "line")).toEqual([
      d("eslint", "eslint-disable", ["a"], "", false, false),
    ])
    expect(parseDirective(" \t eslint-disable a", "block")).toEqual([
      d("eslint", "eslint-disable", ["a"], "", false, false),
    ])
    expect(parseDirective("* eslint-disable a", "block")).toEqual([
      d("eslint", "eslint-disable", ["a"], "", false, false),
    ])
    expect(parseDirective("  ** eslint-disable a", "block")).toEqual([
      d("eslint", "eslint-disable", ["a"], "", false, false),
    ])
    expect(parseDirective("*\n eslint-disable a", "block")).toEqual([
      d("eslint", "eslint-disable", ["a"], "", false, false),
    ])
    expect(parseDirective("* eslint-disable a", "line")).toEqual([])
    expect(parseDirective("x eslint-disable a", "block")).toEqual([])
  })

  it("is anchored: a directive word later in the comment, or glued to other text, is not a directive", () => {
    for (const body of [
      "note eslint-disable a",
      "see @ts-ignore here",
      "x Stryker disable A",
      "x v8 ignore next",
      "x jscpd:ignore-start",
      "x prettier-ignore",
      "x secretlint-disable",
    ]) {
      expect(parseDirective(body, "line")).toEqual([])
    }
    expect(parseDirective("x markdownlint-disable", "line")).toEqual([])
  })

  it("takes the earliest separator, and a colon only for Stryker", () => {
    const stryker = (body: string) => parseDirective(body, "line")[0]
    expect(stryker("Stryker disable A: first -- second")).toMatchObject({
      rules: ["A"],
      reason: "first -- second",
    })
    expect(stryker("Stryker disable A -- first: second")).toMatchObject({
      rules: ["A"],
      reason: "first: second",
    })
    expect(stryker("Stryker disable A B: why")).toMatchObject({ rules: ["A", "B"], reason: "why" })
    expect(stryker("Stryker disable -- all of it")).toMatchObject({
      rules: [],
      reason: "all of it",
    })
    expect(stryker("Stryker disable next-line")).toMatchObject({
      directive: "Stryker disable next-line",
      rules: [],
      reason: "",
    })
    expect(stryker("Stryker disable next-line-foo")).toMatchObject({
      directive: "Stryker disable next-line",
      rules: ["-foo"],
    })
    expect(stryker("Stryker disable A next-line B")).toMatchObject({
      directive: "Stryker disable",
      rules: ["A", "next-line", "B"],
    })
    for (const body of [
      "eslint-disable a: b",
      "v8 ignore next: b",
      "jscpd:ignore-start: b",
      "secretlint-disable a: b",
    ]) {
      const [parsed] = parseDirective(body, "line")
      expect(parsed?.reason, body).toBe("")
    }
    expect(parseDirective("jscpd:ignore-start: b", "line")[0]?.reason).toBe("")
    expect(parseDirective("v8 ignore next -- b c", "line")[0]?.reason).toBe("b c")
    expect(parseDirective("secretlint-disable a -- b c", "line")[0]?.reason).toBe("b c")
    expect(parseDirective("secretlint-disable -- b c", "line")[0]).toMatchObject({
      rules: [],
      reason: "b c",
      blanket: true,
    })
  })

  it("strips only the first separator of a TypeScript or Prettier reason, and only at its start", () => {
    expect(parseDirective("@ts-expect-error because -- legacy", "line")[0]?.reason).toBe(
      "because -- legacy",
    )
    expect(parseDirective("@ts-expect-error -- a -- b", "line")[0]?.reason).toBe("a -- b")
    expect(parseDirective("@ts-expect-error:why", "line")[0]?.reason).toBe("why")
    expect(parseDirective("@ts-expect-error --why", "line")[0]?.reason).toBe("why")
    expect(parseDirective("prettier-ignore because: legacy", "line")[0]?.reason).toBe(
      "because: legacy",
    )
    expect(parseDirective("prettier-ignore --  spaced", "line")[0]?.reason).toBe("spaced")
    expect(parseDirective("prettier-ignore :x", "line")[0]?.reason).toBe("x")
  })

  it("leaves stars inside a block comment alone and splits a rule list on commas and any whitespace", () => {
    expect(parseDirective("eslint-disable a *wild* b", "block")[0]?.rules).toEqual([
      "a",
      "*wild*",
      "b",
    ])
    expect(parseDirective("eslint-disable a,b ,c\n d", "line")[0]?.rules).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
    expect(parseDirective("eslint-disable ,, a ,,", "line")[0]?.rules).toEqual(["a"])
  })

  it("collapses a multi-line reason into single spaces", () => {
    expect(
      parseDirective("eslint-disable a -- line one\n   line two\t\tthree", "line")[0]?.reason,
    ).toBe("line one line two three")
    expect(parseDirective("@ts-expect-error --\n  because\n  reasons", "line")[0]?.reason).toBe(
      "because reasons",
    )
    expect(parseDirective("prettier-ignore --\n  keep", "line")[0]?.reason).toBe("keep")
  })
})

describe("scanSource", () => {
  const scan = (text: string, file = "src/a.ts") => scanSource(file, text, ts)

  it("reports id, line, reason, flags and the code a next-line directive covers", () => {
    const text = [
      "const a = 1",
      "// eslint-disable-next-line no-console -- the CLI prints to the terminal",
      "// a second comment line",
      "",
      "console.log(a)",
      "",
    ].join("\n")
    const [found, ...rest] = scan(text)
    expect(rest).toEqual([])
    expect(found).toEqual({
      id: `suppression:eslint:no-console:src/a.ts:${anchor("eslint-disable-next-line", "no-console", "console.log(a)")}`,
      domain: "eslint",
      rule: "no-console",
      directive: "eslint-disable-next-line",
      file: "src/a.ts",
      line: 2,
      reason: "the CLI prints to the terminal",
      blockReason: "",
      blanket: false,
      documented: true,
      closing: false,
    })
  })

  it("anchors a same-line directive to its own line and a blanket one to a star", () => {
    const text =
      "const a = 1 // eslint-disable-line -- fine because tests\nlet b // eslint-disable\n"
    const found = scan(text)
    expect(found.map((f) => [f.rule, f.line, f.blanket, f.documented])).toEqual(
      [["*", 1, true, true]].slice(0, 0).concat([
        ["*", 1, true, true],
        ["*", 2, true, false],
      ] as never),
    )
    expect(found[0]?.id).toBe(
      `suppression:eslint:*:src/a.ts:${anchor("eslint-disable-line", "*", "const a = 1 // eslint-disable-line -- fine because tests")}`,
    )
    expect(found[1]?.id).toContain(anchor("eslint-disable", "*", "let b // eslint-disable"))
  })

  it("takes a reason from the comment block above when the directive carries none", () => {
    const long = "This explains precisely why the next mutant is equivalent."
    const text = `// ${long}\n// Stryker disable next-line StringLiteral\nconst a = "x"\n`
    const [found] = scan(text)
    expect(found?.reason).toBe("")
    expect(found?.blockReason).toBe(long)
    expect(found?.documented).toBe(true)
  })

  it("needs 30 characters above and 15 on the directive, but no reason for a closing one", () => {
    const above = (n: number) => `// ${"x".repeat(n)}\n// Stryker disable A\nconst a = 1\n`
    expect(scan(above(30))[0]?.documented).toBe(true)
    expect(scan(above(29))[0]?.documented).toBe(false)
    const inline = (n: number) => `// Stryker disable A: ${"y".repeat(n)}\nconst a = 1\n`
    expect(scan(inline(15))[0]?.documented).toBe(true)
    expect(scan(inline(14))[0]?.documented).toBe(false)
    const closing = scan(`// ${"x".repeat(40)}\n// Stryker restore A\nconst a = 1\n`)[0]
    expect(closing?.closing).toBe(true)
    expect(closing?.blockReason).toBe("x".repeat(40))
    expect(closing?.documented).toBe(false)
  })

  it("collects the block above across line, block and star lines, stopping at code, a blank line or another directive", () => {
    const text = [
      "const earlier = 1",
      "// not part of it, code above",
      "",
      "// first words of the reason",
      "/* second words of the reason",
      " * third words of the reason",
      " */",
      "// Stryker disable A",
      "const a = 1",
    ].join("\n")
    const found = scan(text)
    expect(found[0]?.blockReason).toBe(
      "first words of the reason second words of the reason third words of the reason",
    )
    const stopped = scan(
      "// eslint-disable-next-line x -- ok fine and long enough\n// words above this one are here\n// Stryker disable A\nconst a = 1\n",
    )
    expect(stopped.find((f) => f.domain === "stryker")?.blockReason).toBe(
      "words above this one are here",
    )
    const separated = scan(
      "// words that are separated by a blank line\n\n// Stryker disable A\nconst a = 1\n",
    )
    expect(separated[0]?.blockReason).toBe("")
    const afterCode = scan("const z = 1\n// Stryker disable A\nconst a = 1\n")
    expect(afterCode[0]?.blockReason).toBe("")
  })

  it("joins every later line of a block comment into the reason, with single spaces", () => {
    const text =
      "/*\n * eslint-disable no-console\n * line one of it\n * line two of it\n */\nconsole.log(1)\n"
    expect(scan(text)[0]?.reason).toBe("line one of it line two of it")
    const lead = "/**\n\neslint-disable no-console\nwhy it is fine\n */\nconsole.log(1)\n"
    expect(scan(lead)[0]?.reason).toBe("why it is fine")
  })

  it("strips a whole run of slashes from a line comment and keeps slashes inside rule names", () => {
    const rules = (text: string) => scan(text)[0]?.rule
    expect(rules("/// eslint-disable-next-line a -- triple slash here\nx\n")).toBe("a")
    expect(rules("//// eslint-disable-next-line a -- quad slash here\nx\n")).toBe("a")
    expect(
      rules("// eslint-disable-next-line react/no-danger -- slash in the rule name\nx\n"),
    ).toBe("react/no-danger")
    expect(rules("//eslint-disable-next-line a -- no space here\nx\n")).toBe("a")
    expect(rules("/** eslint-disable a -- double star here */\nx\n")).toBe("a")
    expect(rules("/*** eslint-disable a -- triple star here ***/\nx\n")).toBe("a")
    expect(scan("/* eslint-disable a -- why **/\nx\n")[0]?.reason).toBe("why")
    expect(scan("// eslint-disable a\n")[0]?.reason).toBe("")
  })

  it("treats a directive indented after the comment marker as a directive when collecting the block above", () => {
    const text =
      "// words above everything else here\n//    eslint-disable-next-line a -- long enough reason\n// Stryker disable B\nx\n"
    expect(scan(text).find((f) => f.domain === "stryker")?.blockReason).toBe("")
  })

  it("keeps an inline reason when the block comment also has later lines, and turns inner stars into spaces", () => {
    expect(
      scan("/* eslint-disable a -- the inline reason\n * a later line */\nx\n")[0]?.reason,
    ).toBe("the inline reason * a later line")
    expect(scan("/*\neslint-disable a\nfoo*bar\n*/\nx\n")[0]?.reason).toBe("foo bar")
  })

  it("joins several rules with commas in the rule part of the id", () => {
    const [found] = scan("// eslint-disable-next-line a, b -- two rules at once\nx\n")
    expect(found?.rule).toBe("a,b")
    expect(found?.id).toContain(":a,b:src/a.ts:")
  })

  it("reads a block comment ending in several stars, and one that is never closed", () => {
    expect(scan("/* eslint-disable a -- why ***/\nx\n")[0]?.reason).toBe("why")
    expect(scan("/* eslint-disable a -- unterminated reason text")[0]?.reason).toBe(
      "unterminated reason text",
    )
  })

  it("does not read a trailing comment on a code line as a comment block above", () => {
    const text = "const z = 1 // some words that are here\n// Stryker disable A\nconst a = 1\n"
    expect(scan(text).find((f) => f.domain === "stryker")?.blockReason).toBe("")
  })

  it("keeps the comment block above separate from an inline reason", () => {
    const [found] = scan(
      "// words that sit above the directive\n// eslint-disable-next-line a -- inline reason here\nx\n",
    )
    expect(found?.reason).toBe("inline reason here")
    expect(found?.blockReason).toBe("")
  })

  it("joins later lines of a block comment with single spaces, even when they have no indent", () => {
    expect(scan("/*\neslint-disable x\nfoo\nbar\n*/\nx\n")[0]?.reason).toBe("foo bar")
  })

  it("anchors on the first code line, treating blank-looking lines as blank and a // inside code as code", () => {
    const [blank] = scan("// Stryker disable next-line A\n   \n\t\nconst target = 1\n")
    expect(blank?.id).toContain(anchor("Stryker disable next-line", "A", "const target = 1"))
    const [inCode] = scan('// Stryker disable next-line A\nconst u = "http://x"\n')
    expect(inCode?.id).toContain(anchor("Stryker disable next-line", "A", 'const u = "http://x"'))
  })

  it("reads each comment marker style above a directive, without its marker", () => {
    const reason = (...above: string[]) =>
      scan(`${above.join("\n")}\n// Stryker disable A\nconst a = 1\n`)[0]?.blockReason
    expect(reason("/// triple slash words")).toBe("triple slash words")
    expect(reason("/** double star words */")).toBe("double star words")
    expect(reason("/* block words */")).toBe("block words")
    expect(reason("** stars words")).toBe("stars words")
    expect(reason("*/")).toBe("")
    expect(reason("//no space words")).toBe("no space words")
    expect(reason("//   indented  words")).toBe("indented words")
    expect(reason("<!-- html words -->")).toBe("html words")
    expect(reason("// one", "// two")).toBe("one two")
    expect(reason("  // padded words  ")).toBe("padded words")
  })

  it("reads the reason from the later lines of a block comment, and strips its stars", () => {
    const text =
      "/* eslint-disable no-console\n * the build script prints progress\n */\nconsole.log(1)\n"
    const [found] = scan(text)
    expect(found?.reason).toBe("the build script prints progress")
    expect(found?.documented).toBe(true)
  })

  it("covers the first real code line below a next-line directive, skipping comments and blanks", () => {
    const text =
      "// Stryker disable next-line A\n\n// note\n/* note */\n * stray\n   const target = 2   \n"
    const [found] = scan(text)
    expect(found?.id).toContain(anchor("Stryker disable next-line", "A", "const target = 2"))
  })

  it("anchors a next-line directive with nothing below it to an empty line", () => {
    const [found] = scan("// eslint-disable-next-line a\n")
    expect(found?.id).toContain(anchor("eslint-disable-next-line", "a", ""))
  })

  it("is not fooled by a string or a template that mentions a directive", () => {
    expect(scan('const s = "// eslint-disable"\nconst t = `/* eslint-disable */`\n')).toEqual([])
  })

  it("finds trailing comments, comments before the first token and inside JSX in a .tsx file", () => {
    const text = [
      "// eslint-disable no-alert -- first token comment here",
      "export const x = <div>{/* eslint-disable-next-line no-alert -- jsx comment here too */}<b/></div>",
      "const y = 1 /* prettier-ignore -- trailing block comment */",
      "",
    ].join("\n")
    expect(scan(text, "src/c.tsx").map((f) => f.directive)).toEqual([
      "eslint-disable",
      "eslint-disable-next-line",
      "prettier-ignore",
    ])
    expect(
      scan("// eslint-disable x -- in a js file here\nexport const a = 1\n", "src/a.js"),
    ).toHaveLength(1)
    expect(
      scan("export const a = <p/> // eslint-disable x -- jsx in a jsx file\n", "src/a.jsx"),
    ).toHaveLength(1)
  })

  it("lists the comments in source order and counts each once", () => {
    const text =
      "const a = 1 // eslint-disable-line x -- first one is here\n// eslint-disable-next-line y -- second one is here\nconst b = 2\n"
    expect(scan(text).map((f) => f.rule)).toEqual(["x", "y"])
  })

  it("tells a tab from CRLF line endings by position, not by splitting on them", () => {
    const text = "// eslint-disable-next-line a -- crlf endings are fine\r\nconst b = 2\r\n"
    expect(scan(text)[0]?.line).toBe(1)
  })
})

describe("scanMarkdown", () => {
  it("reads markdownlint directives from HTML comments with their line numbers", () => {
    const text = [
      "# Title",
      "",
      "<!-- markdownlint-disable MD013 -- a very wide table here -->",
      "text",
      "<!-- markdownlint-enable MD013 -->",
      "<!-- markdownlint-disable-next-line MD033 -->",
      "<p>x</p>",
      "<!--",
      "  markdownlint-disable-file",
      "-->",
      "<!-- markdownlint-capture -->",
      "<!-- markdownlint-restore -->",
      "<!-- markdownlint-configure-file {} -->",
      "<!-- an ordinary comment -->",
      "",
    ].join("\n")
    const found = scanMarkdown("README.md", text)
    expect(
      found.map((f) => [f.directive, f.rule, f.line, f.reason, f.blanket, f.closing, f.documented]),
    ).toEqual([
      ["markdownlint-disable", "MD013", 3, "a very wide table here", false, false, true],
      ["markdownlint-enable", "MD013", 5, "", false, true, false],
      ["markdownlint-disable-next-line", "MD033", 6, "", false, false, false],
      ["markdownlint-disable-file", "*", 8, "", true, false, false],
    ])
    expect(found[2]?.id).toBe(
      `suppression:markdownlint:MD033:README.md:${anchor("markdownlint-disable-next-line", "MD033", "<p>x</p>")}`,
    )
  })

  it("does not mistake the directive itself, on a later line of a multi-line comment, for its reason", () => {
    const [found] = scanSource(
      "a.ts",
      "/*\n * eslint-disable no-console\n */\nconsole.log(1)\n",
      ts,
    )
    expect(found?.reason).toBe("")
    expect(found?.documented).toBe(false)
    const [continued] = scanSource(
      "a.ts",
      "/*\n * eslint-disable no-console\n * the progress output is the point\n */\nconsole.log(1)\n",
      ts,
    )
    expect(continued?.reason).toBe("the progress output is the point")
  })

  it("never takes a reason from the lines above in Markdown", () => {
    const [found] = scanMarkdown(
      "a.md",
      "this is a long line of prose above the comment\n<!-- markdownlint-disable MD013 -->\n",
    )
    expect(found?.blockReason).toBe("")
  })

  it("does not read a markdownlint word later in a comment as a directive, and keeps a colon in its reason", () => {
    expect(scanMarkdown("a.md", "<!-- see markdownlint-disable MD013 -->")).toEqual([])
    expect(scanMarkdown("a.md", "<!-- markdownlint-disable MD013: wide table -->")[0]?.reason).toBe(
      "",
    )
    expect(
      scanMarkdown("a.md", "<!-- markdownlint-disable MD013 -- wide: table -->")[0]?.reason,
    ).toBe("wide: table")
    expect(
      scanMarkdown("a.md", "<!--\nmarkdownlint-disable MD013\nwide table here\nmore\n-->")[0]
        ?.reason,
    ).toBe("wide table here more")
  })

  it("recognises the enable-file closing form and the plain disable-line form", () => {
    expect(
      scanMarkdown("a.md", "<!-- markdownlint-enable-file -->").map((f) => [f.closing, f.blanket]),
    ).toEqual([[true, false]])
    expect(
      scanMarkdown("a.md", "<!-- markdownlint-disable-line MD001 -->").map((f) => f.directive),
    ).toEqual(["markdownlint-disable-line"])
    expect(scanMarkdown("a.md", "<!-- markdownlint-disabled -->")).toEqual([])
  })
})

describe("listScannableFiles and scanRepository", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-suppressions-exact-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const put = (rel: string, content = "export const a = 1\n") => {
    const file = path.join(dir, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" })

  it("in a git repository: tracked and untracked, not ignored, only source and Markdown, minus generated trees", () => {
    git("init", "-q")
    put(".gitignore", "ignored.ts\n")
    for (const rel of [
      "src/a.ts",
      "src/b.tsx",
      "src/c.mts",
      "src/d.cts",
      "src/e.js",
      "src/f.jsx",
      "src/g.mjs",
      "src/h.cjs",
      "README.md",
      "docs/x.markdown",
      "src/notes.txt",
      "ignored.ts",
      "node_modules/p/i.ts",
      "dist/o.ts",
      "build/o.ts",
      "coverage/o.ts",
      "reports/o.ts",
      ".stryker-tmp/o.ts",
      "docs/api/o.ts",
      "docs/api-report/o.md",
      "template/o.ts",
      "src/fixtures/o.ts",
      "pkg/node_modules/p/i.ts",
      "pkg/dist/o.ts",
      "src/distinct.ts",
      "src/nodes/n.ts",
      "src/space name.ts",
    ])
      put(rel)
    git("add", "-A")
    put("untracked.ts")
    rmSync(path.join(dir, "src/h.cjs"))
    expect(listScannableFiles(dir)).toEqual([
      "README.md",
      "docs/x.markdown",
      "src/a.ts",
      "src/b.tsx",
      "src/c.mts",
      "src/d.cts",
      "src/distinct.ts",
      "src/e.js",
      "src/f.jsx",
      "src/g.mjs",
      "src/nodes/n.ts",
      "src/space name.ts",
      "untracked.ts",
    ])
  })

  it("outside git, walks the directory without descending into node_modules or .git", () => {
    put("a.ts")
    put("sub/deep/b.ts")
    put("node_modules/p/i.ts")
    put(".git/hooks/h.ts")
    put("sub/node_modules/p/i.ts")
    put("note.txt")
    expect(listScannableFiles(dir)).toEqual(["a.ts", "sub/deep/b.ts"])
  })

  it("scans every file, counting them, with Markdown and source told apart", () => {
    put("a.ts", "// eslint-disable-next-line x -- a good enough reason\nconst a = 1\n")
    put("b.md", "<!-- markdownlint-disable MD013 -- a long enough reason -->\n")
    put("c.txt", "// eslint-disable\n")
    const result = scanRepository(dir, ts)
    expect(result.files).toBe(2)
    expect(result.suppressions.map((s) => [s.file, s.domain])).toEqual([
      ["a.ts", "eslint"],
      ["b.md", "markdownlint"],
    ])
  })

  it("loads TypeScript from the repository being scanned when none is supplied", () => {
    put("package.json", "{}")
    put("a.ts", "// eslint-disable-next-line x -- a good enough reason\nconst a = 1\n")
    mkdirSync(path.join(dir, "node_modules"))
    symlinkSync(
      path.dirname(path.dirname(require.resolve("typescript/package.json"))) + "/typescript",
      path.join(dir, "node_modules", "typescript"),
      "dir",
    )
    expect(scanRepository(dir).suppressions).toHaveLength(1)
  })
})
