import { describe, expect, it } from "vitest"
import { dependencyRegion } from "../scripts/generate/dependencies.mjs"

/**
 * The "dependencies" region states what installing the package adds, from `package.json` itself, so a
 * document can no longer say "zero dependencies" or "bundles a compiler" when `package.json` says otherwise.
 * What only a person can say (why each one is there) lives once, in `docs/surface.json`.
 */
describe("dependencyRegion", () => {
  it("says the package installs nothing else when it declares no dependencies of any kind", () => {
    expect(dependencyRegion({ name: "p" }, {})).toEqual({
      problems: [],
      markdown: "Installing `p` installs no other packages.",
    })
  })

  it("lists each runtime dependency with its range and the reason it is there", () => {
    const region = dependencyRegion(
      { name: "@o/p", dependencies: { "@typescript/typescript6": "^6.0.2" } },
      { dependencies: { "@typescript/typescript6": "The compiler the build entry parses with." } },
    )
    expect(region.problems).toEqual([])
    expect(region.markdown).toBe(
      [
        "Installing `@o/p` installs 1 package directly, and whatever it depends on.",
        "",
        "| Package | Kind | Range | Why |",
        "| --- | --- | --- | --- |",
        "| `@typescript/typescript6` | dependency | `^6.0.2` | The compiler the build entry parses with. |",
      ].join("\n"),
    )
  })

  it("counts required peers as installed, as npm 7 and later install them, and leaves optional ones to you", () => {
    const region = dependencyRegion(
      {
        name: "p",
        peerDependencies: { typescript: ">=5", eslint: "^9" },
        peerDependenciesMeta: { typescript: { optional: true } },
      },
      { dependencies: { typescript: "Parses the project.", eslint: "Runs the plugin." } },
    )
    expect(region.problems).toEqual([])
    expect(region.markdown).toBe(
      [
        "Installing `p` installs 1 package directly (with npm 7 or later, which installs required peers), and whatever it depends on. It names 1 optional peer, which you install yourself when you use the part that needs it.",
        "",
        "| Package | Kind | Range | Why |",
        "| --- | --- | --- | --- |",
        "| `eslint` | peer | `^9` | Runs the plugin. |",
        "| `typescript` | optional peer | `>=5` | Parses the project. |",
      ].join("\n"),
    )
  })

  it("names the peers too when the package has both kinds", () => {
    const region = dependencyRegion(
      { name: "p", dependencies: { a: "1" }, peerDependencies: { b: "2" } },
      { dependencies: { a: "A.", b: "B." } },
    )
    expect(region.markdown.split("\n")[0]).toBe(
      "Installing `p` installs 2 packages directly (with npm 7 or later, which installs required peers), and whatever they depend on.",
    )
  })

  it("counts more than one dependency in the plural, sorted by name", () => {
    const region = dependencyRegion(
      { name: "p", dependencies: { b: "1", a: "2" } },
      { dependencies: { a: "A.", b: "B." } },
    )
    expect(region.markdown.split("\n")[0]).toBe(
      "Installing `p` installs 2 packages directly, and whatever they depend on.",
    )
    expect(region.markdown.split("\n").slice(4)).toEqual([
      "| `a` | dependency | `2` | A. |",
      "| `b` | dependency | `1` | B. |",
    ])
  })

  it("asks for the reason behind a dependency that has none, instead of rendering an empty cell", () => {
    expect(
      dependencyRegion({ name: "p", dependencies: { a: "1" }, peerDependencies: { b: "2" } }, {})
        .problems,
    ).toEqual([
      'docs/surface.json has no "dependencies" reason for "a", which package.json lists in dependencies.',
      'docs/surface.json has no "dependencies" reason for "b", which package.json lists in peerDependencies.',
    ])
    expect(
      dependencyRegion({ name: "p", dependencies: { a: "1" } }, { dependencies: { a: "  " } })
        .problems,
    ).toEqual([
      'docs/surface.json has no "dependencies" reason for "a", which package.json lists in dependencies.',
    ])
  })

  it("rejects a reason for a package that package.json does not declare, so a removed one cannot linger", () => {
    expect(
      dependencyRegion({ name: "p" }, { dependencies: { gone: "Was here." } }).problems,
    ).toEqual(['docs/surface.json gives a reason for "gone", which package.json does not declare.'])
  })

  it("rejects a dependencies field that is not an object of strings", () => {
    expect(dependencyRegion({ name: "p" }, { dependencies: ["a"] }).problems).toEqual([
      'docs/surface.json "dependencies" must be an object from package name to the reason it is there.',
    ])
    expect(
      dependencyRegion({ name: "p", dependencies: { a: "1" } }, { dependencies: { a: 5 } })
        .problems,
    ).toEqual([
      'docs/surface.json has no "dependencies" reason for "a", which package.json lists in dependencies.',
    ])
  })

  it("escapes a pipe in a reason so the table keeps its columns", () => {
    const region = dependencyRegion(
      { name: "p", dependencies: { a: "1 || 2" } },
      { dependencies: { a: "x | y" } },
    )
    expect(region.markdown).toContain("| `a` | dependency | `1 \\|\\| 2` | x \\| y |")
  })

  it("treats a dependency map that is null, or a range that is not a string, as declaring nothing", () => {
    expect(
      dependencyRegion(
        { name: "p", dependencies: null, peerDependencies: { a: 1 }, peerDependenciesMeta: null },
        null,
      ),
    ).toEqual({
      problems: [],
      markdown: "Installing `p` installs no other packages.",
    })
    expect(
      dependencyRegion({ name: "p", dependencies: { a: 1, b: "2" } }, { dependencies: { b: "B." } })
        .markdown,
    ).toContain("| `b` | dependency | `2` | B. |")
  })

  it("calls a peer optional only when its meta says optional: true", () => {
    const region = dependencyRegion(
      {
        name: "p",
        peerDependencies: { a: "1", b: "2" },
        peerDependenciesMeta: { a: { optional: false }, b: "yes" },
      },
      { dependencies: { a: "A.", b: "B." } },
    )
    expect(region.markdown).toContain("| `a` | peer | `1` | A. |")
    expect(region.markdown).toContain("| `b` | peer | `2` | B. |")
  })

  it("still reports every missing reason when the dependencies field itself is malformed", () => {
    expect(
      dependencyRegion({ name: "p", dependencies: { a: "1" } }, { dependencies: "A." }).problems,
    ).toEqual([
      'docs/surface.json "dependencies" must be an object from package name to the reason it is there.',
      'docs/surface.json has no "dependencies" reason for "a", which package.json lists in dependencies.',
    ])
  })

  it("lists optional dependencies, which npm installs by default, and asks for their reasons too", () => {
    const region = dependencyRegion(
      { name: "p", optionalDependencies: { fsevents: "^2.3.0" } },
      { dependencies: { fsevents: "Faster file watching on macOS." } },
    )
    expect(region).toEqual({
      problems: [],
      markdown: [
        "Installing `p` installs 1 package directly, and whatever it depends on.",
        "",
        "| Package | Kind | Range | Why |",
        "| --- | --- | --- | --- |",
        "| `fsevents` | optional dependency | `^2.3.0` | Faster file watching on macOS. |",
      ].join("\n"),
    })
    expect(dependencyRegion({ name: "p", optionalDependencies: { a: "1" } }, {}).problems).toEqual([
      'docs/surface.json has no "dependencies" reason for "a", which package.json lists in optionalDependencies.',
    ])
  })

  it("rejects a reason that spans lines, since a table cell holds one line", () => {
    expect(
      dependencyRegion(
        { name: "p", dependencies: { a: "1" } },
        { dependencies: { a: "One.\nTwo." } },
      ).problems,
    ).toEqual([
      'docs/surface.json "dependencies" reason for "a" spans more than one line; a table cell holds one line.',
    ])
  })

  it("counts several optional peers in the plural", () => {
    const region = dependencyRegion(
      {
        name: "p",
        peerDependencies: { a: "1", b: "2" },
        peerDependenciesMeta: { a: { optional: true }, b: { optional: true } },
      },
      { dependencies: { a: "A.", b: "B." } },
    )
    expect(region.markdown.split("\n")[0]).toBe(
      "Installing `p` installs no other packages. It names 2 optional peers, which you install yourself when you use the part that needs them.",
    )
  })

  it("lists a package declared as both a dependency and an optional dependency once, as npm installs it", () => {
    const region = dependencyRegion(
      { name: "p", dependencies: { a: "^1.0.0" }, optionalDependencies: { a: "^2.0.0" } },
      { dependencies: { a: "A." } },
    )
    expect(region.markdown).toBe(
      [
        "Installing `p` installs 1 package directly, and whatever it depends on.",
        "",
        "| Package | Kind | Range | Why |",
        "| --- | --- | --- | --- |",
        "| `a` | optional dependency | `^2.0.0` | A. |",
      ].join("\n"),
    )
  })

  it("counts a package once when it is both a dependency and a required peer", () => {
    const region = dependencyRegion(
      { name: "p", dependencies: { a: "^1.0.0" }, peerDependencies: { a: "^1.0.0", b: "^2.0.0" } },
      { dependencies: { a: "A.", b: "B." } },
    )
    expect(region.markdown.split("\n")[0]).toBe(
      "Installing `p` installs 2 packages directly (with npm 7 or later, which installs required peers), and whatever they depend on.",
    )
  })
})
