import { describe, expect, it } from "vitest"
import { sha256 } from "../scripts/api-contract/baseline-store.js"

describe("sha256 (baseline hashing)", () => {
  it("hashes the same text identically with LF and CRLF line endings", () => {
    expect(sha256("a\r\nb\r\n")).toBe(sha256("a\nb\n"))
  })

  it("still tells different content apart", () => {
    expect(sha256("a\nb\n")).not.toBe(sha256("a\nc\n"))
  })
})
