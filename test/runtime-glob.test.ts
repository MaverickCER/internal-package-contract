import { describe, expect, it } from "vitest"
import { globToRegExp } from "../runtime/glob.js"

// discover.ts's schema-discovery walk only ever exercises this module
// through `**`-heavy patterns in its own test fixtures -- a bare single `*`
// segment wildcard and `?` are never exercised anywhere else, so this file
// drives globToRegExp() directly.
describe("globToRegExp", () => {
  it("matches a `**` segment as any number of path segments, including zero", () => {
    const re = globToRegExp("**/env.schema.ts")
    expect(re.test("env.schema.ts")).toBe(true)
    expect(re.test("features/payments/env.schema.ts")).toBe(true)
  })

  it("treats a `**` not bounded by slashes on both sides as a plain any-characters wildcard", () => {
    // e.g. "foo**bar" or a trailing "**" with no following "/" -- not the
    // "any number of path segments" idiom, since that requires "**/" or a
    // leading/start-anchored "**/".
    const re = globToRegExp("foo**bar")
    expect(re.test("fooXYZbar")).toBe(true)
    expect(re.test("foo/nested/bar")).toBe(true)

    const trailing = globToRegExp("features/**")
    expect(trailing.test("features/anything")).toBe(true)
  })

  it("matches a bare `*` as any characters within one path segment only", () => {
    const re = globToRegExp("features/*/env.schema.ts")
    expect(re.test("features/payments/env.schema.ts")).toBe(true)
    expect(re.test("features/payments/nested/env.schema.ts")).toBe(false)
  })

  it("matches `?` as exactly one character within a path segment", () => {
    const re = globToRegExp("env.schema.t?")
    expect(re.test("env.schema.ts")).toBe(true)
    expect(re.test("env.schema.tsx")).toBe(false)
    expect(re.test("env.schema.t")).toBe(false)
  })

  it("escapes regex-special characters so they match literally", () => {
    const re = globToRegExp("env.schema.ts")
    expect(re.test("envXschemaXts")).toBe(false)
    expect(re.test("env.schema.ts")).toBe(true)
  })

  // Exact `.source` assertions isolating each clause of the `**` detection
  // (`char === "*" && pattern[i + 1] === "*"`) and the `(?:.*/)?` vs plain
  // `.*` branch's own guard (`precededBySlashOrStart && followedBySlash`) --
  // a bare `.test()` on a hand-picked string can't distinguish every
  // sub-clause, since several inputs happen to produce the same match result
  // through a differently-shaped (but still-matching) regex. Same fixture
  // set as this file's deliberately-duplicated `eslint-plugin/glob.ts` copy.
  it.each<[string, string]>([
    // Leading "**/ " -- i === 0 (the OR's first operand) AND followed by slash.
    ["**/x", "^(?:.*\\/)?x$"],
    // Mid-path "**/ " -- NOT i === 0, but preceded by "/" (the OR's second
    // operand) AND followed by slash.
    ["a/**/b", "^a\\/(?:.*\\/)?b$"],
    // Preceded by "/" but NOT followed by slash (trailing "**") -- isolates
    // `followedBySlash` on its own: without it, this would wrongly also
    // produce the `(?:.*/)?` form.
    ["a/**", "^a\\/.*$"],
    // Followed by slash but NOT preceded by "/" or start -- isolates
    // `precededBySlashOrStart`, and proves the guard is `&&`, not `||`
    // (with `||` this would wrongly also produce the `(?:.*/)?` form).
    ["x**/y", "^x.*\\/y$"],
    // Neither preceded nor followed by a slash -- the baseline "no special
    // form at all" case, and the one that most sharply exposes the `i + 1`
    // "is the NEXT char also a `*`" detection itself being corrupted (a
    // corrupted detection drops the trailing character entirely instead of
    // emitting `.*` in the middle).
    ["a**b", "^a.*b$"],
  ])("globToRegExp(%j) produces exactly %s", (pattern, expectedSource) => {
    expect(globToRegExp(pattern).source).toBe(expectedSource)
  })

  // Match table ported from data-cap's suite, which exercised the same behavior case by case.
  it.each<[string, string, boolean]>([
    // literal segments
    ["src/user.ts", "src/user.ts", true],
    ["src/user.ts", "src/other.ts", false],
    // single `*` -- one segment, no slash
    ["src/*.ts", "src/user.ts", true],
    ["src/*.ts", "src/nested/user.ts", false],
    ["*.ts", "user.ts", true],
    ["*.ts", "a.tsx", false],
    // `?` -- exactly one non-slash char
    ["src/user.?s", "src/user.ts", true],
    ["src/user.?s", "src/user.js", true],
    ["src/user.?s", "src/user.mjs", false],
    ["a?b", "a/b", false],
    // leading `**/` -- zero or more segments
    ["**/node_modules/**", "node_modules/x", true],
    ["**/node_modules/**", "a/b/node_modules/x", true],
    ["**/*.spec.ts", "a.spec.ts", true],
    ["**/*.spec.ts", "deep/nested/a.spec.ts", true],
    // mid `/**/`
    ["src/**/user.ts", "src/user.ts", true],
    ["src/**/user.ts", "src/a/b/user.ts", true],
    // `**` NOT preceded by `/` or start, or NOT followed by `/` -> plain `.*`
    ["src/a**b", "src/aXYZb", true],
    ["src/a**", "src/anything/here", true],
    // `**` followed by `/` but NOT preceded by `/`/start -> still plain `.*`,
    // NOT the zero-or-more-segments form (`precededBySlashOrStart` is false)
    ["a**/b", "aX/b", true],
    // the `/` after `**` stays mandatory here (plain `.*` form), unlike the
    // leading-`**/` form where the whole segment is optional
    ["a**/b", "ab", false],
    // regex metacharacters in the pattern are escaped, matched literally
    ["src/(x).ts", "src/(x).ts", true],
    ["src/(x).ts", "src/x.ts", false],
    ["a+b.c", "a+b.c", true],
    ["a+b.c", "aaab.c", false],
    // anchored at both ends
    ["user.ts", "src/user.ts", false],
    ["src/user", "src/user.ts", false],
  ])("globToRegExp(%j) vs %j -> %s", (pattern, input, matches) => {
    expect(globToRegExp(pattern).test(input)).toBe(matches)
  })

  it("produces the exact source for a representative pattern", () => {
    // note: `RegExp.prototype.source` escapes `/` as `\/`
    expect(globToRegExp("**/*.ts").source).toBe("^(?:.*\\/)?[^/]*\\.ts$")
    expect(globToRegExp("a**b").source).toBe("^a.*b$")
    expect(globToRegExp("?").source).toBe("^[^/]$")
  })
})
