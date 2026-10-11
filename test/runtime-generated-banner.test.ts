import { describe, expect, it } from "vitest"
import { createGeneratedBanner } from "../runtime/generated-banner.js"

// Built inside each test: mutation testing can only attribute a mutant to a test when the code runs during it.
const make = () =>
  createGeneratedBanner(() => ({
    product: "demo-pkg",
    guideUrl: "https://example.test/demo-pkg/GUIDE.md",
    cliCommand: "npx demo-pkg",
    reportRegenerateHint: "Re-run the script that calls the generators.",
  }))

describe("generatedBanner", () => {
  it("renders the exact ts-comment form by default and when asked", () => {
    const { generatedBanner } = make()
    const expected = "// GENERATED FILE -- do not edit by hand. Run `npx demo-pkg` to regenerate."
    expect(generatedBanner()).toBe(expected)
    expect(generatedBanner("ts")).toBe(expected)
  })
  it("renders the exact markdown-comment form", () => {
    const { generatedBanner } = make()
    expect(generatedBanner("markdown")).toBe(
      "<!-- GENERATED FILE -- do not edit by hand. Run `npx demo-pkg` to regenerate. -->",
    )
  })
  it("lets a caller name the command that really regenerates the file", () => {
    const { generatedBanner } = make()
    expect(generatedBanner("markdown", "Run the thing.")).toBe(
      "<!-- GENERATED FILE -- do not edit by hand. Run the thing. -->",
    )
    expect(generatedBanner("ts", "Run the thing.")).toBe(
      "// GENERATED FILE -- do not edit by hand. Run the thing.",
    )
  })
  it("names the package's own command, not another's", () => {
    const other = createGeneratedBanner(() => ({
      product: "other",
      guideUrl: "u",
      cliCommand: "npx other",
      reportRegenerateHint: "h",
    }))
    expect(other.generatedBanner()).toBe(
      "// GENERATED FILE -- do not edit by hand. Run `npx other` to regenerate.",
    )
  })
})

describe("isGeneratedFile", () => {
  it("recognizes both banner formats on the first line, with any regeneration hint", () => {
    const { generatedBanner, isGeneratedFile } = make()
    expect(isGeneratedFile(`${generatedBanner("ts")}\nrest of file`)).toBe(true)
    expect(isGeneratedFile(`${generatedBanner("markdown")}\nrest of file`)).toBe(true)
    expect(isGeneratedFile(`${generatedBanner("markdown", "Run the thing.")}\n# T`)).toBe(true)
    expect(isGeneratedFile(`${generatedBanner("ts", "Run the thing.")}\nexport {}`)).toBe(true)
  })
  it("still recognizes the banner pushed off line one by a shebang, pragma or license header", () => {
    const { generatedBanner, isGeneratedFile } = make()
    const content = `#!/usr/bin/env node\n"use strict"\n// Copyright\n${generatedBanner("ts")}\nreal content`
    expect(isGeneratedFile(content)).toBe(true)
  })
  it("ignores blank lines when counting how far down to look", () => {
    const { generatedBanner, isGeneratedFile } = make()
    expect(isGeneratedFile(`\n\n\n${generatedBanner("ts")}`)).toBe(true)
  })
  it("does not count a whitespace-only line as one of the first 20 non-empty lines", () => {
    const { generatedBanner, isGeneratedFile } = make()
    const padding = Array.from({ length: 20 }, () => "   ").join("\n")
    expect(isGeneratedFile(`${padding}\n${generatedBanner("ts")}`)).toBe(true)
  })
  it("recognizes a banner on the twentieth non-empty line and not the twenty-first", () => {
    const { generatedBanner, isGeneratedFile } = make()
    const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${String(i)}`)
    expect(isGeneratedFile([...lines(19), generatedBanner("ts")].join("\n"))).toBe(true)
    expect(isGeneratedFile([...lines(20), generatedBanner("ts")].join("\n"))).toBe(false)
  })
  it("returns false for hand-written and empty content", () => {
    const { isGeneratedFile } = make()
    expect(isGeneratedFile("export const x = 1\n")).toBe(false)
    expect(isGeneratedFile("# hand written")).toBe(false)
    expect(isGeneratedFile("")).toBe(false)
  })
})

describe("evidenceDisclaimer", () => {
  it("returns the exact disclaimer text, the same for every package", () => {
    const { evidenceDisclaimer } = make()
    const text =
      "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard."
    expect(evidenceDisclaimer()).toBe(text)
  })
})

describe("evidenceProjectionNote", () => {
  const concept =
    "Projected from demo-pkg's Evidence Model (https://example.test/demo-pkg/GUIDE.md), the same source every other generated artifact draws from."
  it("returns just the concept sentence when no path is given", () => {
    const { evidenceProjectionNote } = make()
    expect(evidenceProjectionNote()).toBe(concept)
  })
  it("appends the concrete path when one is given", () => {
    const { evidenceProjectionNote } = make()
    expect(evidenceProjectionNote("docs/demo.evidence.json")).toBe(
      `${concept} This run also wrote it to \`docs/demo.evidence.json\`.`,
    )
  })
})

describe("reportRegenerateHint", () => {
  it("is the package's own sentence", () => {
    expect(make().reportRegenerateHint()).toBe("Re-run the script that calls the generators.")
  })
})
