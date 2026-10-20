import path from "node:path"
import { describe, expect, it } from "vitest"
import { absolutePathFrom, displayPath } from "../runtime/display-path.js"

describe("displayPath", () => {
  it("renders a nested path under root as root-relative, POSIX-separated", () => {
    expect(displayPath("/a/b", "/a/b/features/payments/env.schema.ts")).toBe(
      "features/payments/env.schema.ts",
    )
    expect(displayPath("/project", "/project/src/user.ts")).toBe("src/user.ts")
  })

  it("renders a file directly under root as a bare name", () => {
    expect(displayPath("/project/src", "/project/src/user.ts")).toBe("user.ts")
  })

  it("returns root itself as an empty string, not the absolute path", () => {
    expect(displayPath("/a/b", "/a/b")).toBe("")
  })

  it("returns an already-relative path as given, never resolving it against the process cwd", () => {
    // With the cwd below `root`, resolving "src/user.ts" against the cwd would yield "<cwd-name>/src/user.ts".
    const root = path.dirname(process.cwd())
    expect(displayPath(root, "src/user.ts")).toBe("src/user.ts")
    expect(displayPath("/project", "src/user.ts")).toBe("src/user.ts")
    expect(displayPath("/project", "./src/user.ts")).toBe("./src/user.ts")
  })

  it("normalizes the separators of an already-relative path", () => {
    expect(displayPath("/project", ["src", "user.ts"].join(path.sep))).toBe("src/user.ts")
  })

  it("falls back to the absolute path, unchanged, for a path outside root", () => {
    expect(displayPath("/project", "/elsewhere/user.ts")).toBe("/elsewhere/user.ts")
    expect(displayPath("/a", "/b/user.ts")).toBe("/b/user.ts")
  })

  it("never manufactures a '../' escape, even when the escape does not end in '..'", () => {
    // path.relative("/a/b/c", "/a/x") is "../../x": it starts with ".." but ends with "x".
    expect(displayPath("/a/b/c", "/a/x")).toBe("/a/x")
    const result = displayPath("/project/nested", "/project/user.ts")
    expect(result).toBe("/project/user.ts")
    expect(result.startsWith("..")).toBe(false)
  })

  it("keeps a file inside root whose folder name starts with two dots inside root", () => {
    expect(displayPath("/project", "/project/..cache/x.ts")).toBe("..cache/x.ts")
    expect(displayPath("/project", "/project/..x")).toBe("..x")
  })

  it("treats root's own parent as outside root", () => {
    expect(displayPath("/a/b", "/a")).toBe("/a")
  })

  it("keeps a sibling whose name merely starts with the root's name outside root", () => {
    expect(displayPath("/work/app", "/work/app-two/a.ts")).toBe("/work/app-two/a.ts")
  })
})

describe("absolutePathFrom", () => {
  it("resolves a published path against root", () => {
    expect(absolutePathFrom("/project", "src/user.ts")).toBe(
      path.resolve("/project", "src/user.ts"),
    )
  })

  it("leaves an absolute path untouched, since displayPath leaves an out-of-root one unchanged", () => {
    expect(absolutePathFrom("/project", "/elsewhere/user.ts")).toBe(
      path.resolve("/elsewhere/user.ts"),
    )
  })

  it("is the inverse of displayPath for a file under root", () => {
    const file = path.resolve("/project", "a/b.ts")
    expect(absolutePathFrom("/project", displayPath("/project", file))).toBe(file)
  })
})
