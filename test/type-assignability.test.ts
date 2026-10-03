import { describe, expect, it } from "vitest"
import { containsWholeWord, isWordChar } from "../scripts/api-contract/type-assignability.js"

describe("isWordChar()", () => {
  it("accepts letters, digits and underscore, and nothing else", () => {
    for (const char of ["a", "z", "A", "Z", "0", "9", "_"])
      expect(isWordChar(char), char).toBe(true)
    for (const char of ["-", " ", "<", "$", "é", "", undefined])
      expect(isWordChar(char), String(char)).toBe(false)
  })

  it("treats the characters just outside each range as non-word", () => {
    for (const char of ["`", "{", "@", "[", "/", ":"]) expect(isWordChar(char), char).toBe(false)
  })
})

describe("containsWholeWord()", () => {
  it("finds a word standing on its own, at either end or between punctuation", () => {
    expect(containsWholeWord("T", "T")).toBe(true)
    expect(containsWholeWord("Array<T>", "T")).toBe(true)
    expect(containsWholeWord("T | null", "T")).toBe(true)
    expect(containsWholeWord("(a: T, b: U)", "U")).toBe(true)
  })

  it("does not find it inside a longer identifier", () => {
    expect(containsWholeWord("Type", "T")).toBe(false)
    expect(containsWholeWord("MyT", "T")).toBe(false)
    expect(containsWholeWord("T_1", "T")).toBe(false)
    expect(containsWholeWord("T2", "T")).toBe(false)
  })

  it("keeps looking past an embedded match to a later whole-word one", () => {
    expect(containsWholeWord("Tx T", "T")).toBe(true)
    expect(containsWholeWord("xT xT", "T")).toBe(false)
  })

  it("never matches the empty word", () => {
    expect(containsWholeWord("anything", "")).toBe(false)
  })
})
