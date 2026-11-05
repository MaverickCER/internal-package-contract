import { describe, expect, it } from "vitest"
import { dependencyRegion } from "../scripts/generate/dependencies.mjs"

/**
 * The "dependencies" region states what installing the package adds, from `package.json` itself, so a
 * document can no longer say "zero dependencies" or "bundles a compiler" when `package.json` says otherwise.
 * What only a person can say -- why each one is there -- lives once, in `docs/surface.json`.
 */
describe("dependencyRegion", () => {
  it("says the package installs nothing else when it declares no dependencies of any kind", () => {
    expect(dependencyRegion({ name: "p" }, {})).toEqual({
      problems: [],
      markdown:
        "Installing `p` installs no other packages: `package.json` declares no dependencies.",
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
        "Installing `@o/p` installs 1 direct dependency, and whatever it depends on.",
        "",
        "| Package | Kind | Range | Why |",
        "| --- | --- | --- | --- |",
        "| `@typescript/typescript6` | dependency | `^6.0.2` | The compiler the build entry parses with. |",
      ].join("\n"),
    )
  })

  it("lists peers separately and marks the optional ones, which installing never adds", () => {
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
        "Installing `p` installs no other packages: `package.json` declares no dependencies. It names 2 peer dependencies, which you install yourself when you use the part that needs them.",
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
      "Installing `p` installs 1 direct dependency, and whatever it depends on. It names 1 peer dependency, which you install yourself when you use the part that needs it.",
    )
  })

  it("counts more than one dependency in the plural, sorted by name", () => {
    const region = dependencyRegion(
      { name: "p", dependencies: { b: "1", a: "2" } },
      { dependencies: { a: "A.", b: "B." } },
    )
    expect(region.markdown.split("\n")[0]).toBe(
      "Installing `p` installs 2 direct dependencies, and whatever they depend on.",
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
      markdown:
        "Installing `p` installs no other packages: `package.json` declares no dependencies.",
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
})
