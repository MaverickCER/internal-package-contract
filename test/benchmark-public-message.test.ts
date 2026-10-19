import { describe, expect, it } from "vitest"
import { publicMessage } from "../scripts/benchmark/public-message.mjs"

describe("publicMessage", () => {
  it("keeps only the first line, so a stack trace is never published", () => {
    expect(publicMessage("bad\n    at run (/home/runner/work/pkg/suite.mjs:1:1)")).toBe("bad")
  })

  it("cuts an absolute path to its file name wherever it is delimited, POSIX or Windows", () => {
    expect(
      publicMessage(
        "open '/a/b/c.json' \"/d/e/f\" `/g/h/i` (/j/k/l) /m/n/o\tC:\\p\\q.txt D:/r/s.txt",
      ),
    ).toBe("open '…/c.json' \"…/f\" `…/i` (…/l) …/o\t…/q.txt …/s.txt")
  })

  it("cuts a path that follows `=`, or a `:` after a word, keeping URLs and drive letters whole", () => {
    expect(publicMessage("path=/tmp/build/result.json key:/a/b/c.json ab:/x/y/z")).toBe(
      "path=…/result.json key:…/c.json ab:…/z",
    )
    // A one-letter word before `:` is a drive letter, so `a:/k/l` is the path itself, cut whole.
    expect(publicMessage("see https://example.com/a/b and D:/r/s.txt, a:/k/l")).toBe(
      "see https://example.com/a/b and …/s.txt, …/l",
    )
  })

  it("keeps what is not an absolute path with a folder: a relative path, a root-level name and a URL", () => {
    expect(publicMessage("src/a/b.ts /x C:\\y https://example.com/a/b")).toBe(
      "src/a/b.ts /x C:\\y https://example.com/a/b",
    )
  })
})
