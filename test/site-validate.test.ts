import { describe, expect, it } from "vitest"
import { validateSite, wordCount } from "../scripts/site/validate.mjs"
import { validSite, type Loose } from "./support-site.js"

const pkg = { name: "demo-pkg", version: "0.4.2" }
const errorsFor = (mutate: (site: Loose) => void, p = pkg) => {
  const site = structuredClone(validSite()) as Loose
  mutate(site)
  return validateSite(site, p)
}

describe("wordCount", () => {
  it("counts whitespace-separated words, ignoring Markdown punctuation", () => {
    expect(wordCount("one two  three")).toBe(3)
    expect(wordCount("  ")).toBe(0)
    expect(wordCount("Use `npm run x` now")).toBe(5)
  })
})

describe("validateSite", () => {
  it("accepts a complete site", () => {
    expect(validateSite(validSite(), pkg)).toEqual([])
  })

  it("reports every missing required section by name", () => {
    for (const key of [
      "hero",
      "install",
      "cta",
      "problem",
      "model",
      "guarantees",
      "comparison",
      "demo",
      "adoption",
      "resources",
      "brief",
      "fit",
      "footer",
    ]) {
      expect(
        errorsFor((s) => delete s[key]),
        key,
      ).toContain(`${key} is required.`)
    }
  })

  it("requires the one-sentence organizational outcome, and keeps it to one sentence", () => {
    expect(errorsFor((s) => delete s["hero"].outcome)).toContain("hero.outcome is required.")
    expect(errorsFor((s) => (s["hero"].outcome = "One thing. Another thing."))).toContain(
      "hero.outcome must be a single sentence.",
    )
    expect(errorsFor((s) => (s["hero"].outcome = "No terminal punctuation"))).toContain(
      "hero.outcome must be a single sentence.",
    )
  })

  it("keeps the hero short enough to read in one glance", () => {
    const long = Array.from({ length: 75 }, () => "word").join(" ")
    expect(errorsFor((s) => (s["hero"].lede = long))).toContain(
      "hero.lede and hero.support together are 83 words; keep them to 80 or fewer.",
    )
  })

  it("limits the quick start to three commands, the first installing this package", () => {
    expect(errorsFor((s) => (s["install"].commands = ["a", "b", "c", "d"]))).toContain(
      "install.commands has 4 commands; a quick start is at most 3.",
    )
    expect(errorsFor((s) => (s["install"].commands = []))).toContain(
      "install.commands needs at least one command.",
    )
    expect(errorsFor((s) => (s["install"].commands = ["npm install other-thing"]))).toContain(
      'install.commands[0] must install "demo-pkg".',
    )
  })

  it("needs a primary and a secondary call to action with https or relative URLs", () => {
    expect(errorsFor((s) => delete s["cta"].primary)).toContain("cta.primary is required.")
    expect(errorsFor((s) => delete s["cta"].secondary)).toContain("cta.secondary is required.")
    expect(errorsFor((s) => (s["cta"].primary.url = "http://insecure.example"))).toContain(
      "cta.primary.url must be an https URL or a relative path.",
    )
    expect(errorsFor((s) => (s["cta"].secondary.url = "javascript:alert(1)"))).toContain(
      "cta.secondary.url must be an https URL or a relative path.",
    )
  })

  it("does not let a resource card repeat the primary call to action", () => {
    expect(errorsFor((s) => (s["resources"].items[0].url = s["cta"].primary.url))).toContain(
      "resources.items[0].url repeats the primary call to action; the README is linked from the hero and the close only.",
    )
  })

  it("requires every guarantee to state its scope, and a link to it", () => {
    expect(errorsFor((s) => (s["guarantees"].items[0].scope = "short"))).toContain(
      "guarantees.items[0].scope must say what the guarantee covers and what it does not (at least 20 characters).",
    )
    expect(errorsFor((s) => delete s["guarantees"].items[0].url)).toContain(
      "guarantees.items[0].url is required.",
    )
    expect(errorsFor((s) => (s["guarantees"].items = []))).toContain(
      "guarantees.items needs at least one guarantee.",
    )
  })

  it("requires a visible maturity statement while the package is below 1.0.0, and not after", () => {
    expect(errorsFor((s) => delete s["maturity"])).toContain(
      "maturity is required while the package is below 1.0.0 (version 0.4.2).",
    )
    expect(errorsFor((s) => delete s["maturity"], { name: "demo-pkg", version: "1.0.0" })).toEqual(
      [],
    )
    expect(
      errorsFor((s) => delete s["maturity"], { name: "demo-pkg", version: "not-a-version" }),
    ).toContain("maturity is required while the package is below 1.0.0 (version not-a-version).")
  })

  it("keeps the manager's brief short and in short sentences", () => {
    expect(errorsFor((s) => delete s["brief"].whatItCosts)).toContain(
      "brief.whatItCosts is required.",
    )
    const longSentence = Array.from({ length: 31 }, () => "word").join(" ") + "."
    expect(errorsFor((s) => (s["brief"].problem = longSentence))).toContain(
      "brief.problem has a sentence of 31 words; keep each to 30 or fewer so a non-specialist can read it.",
    )
    expect(errorsFor((s) => (s["brief"].whyItMatters = []))).toContain(
      "brief.whyItMatters needs at least one item.",
    )
    expect(errorsFor((s) => (s["brief"].whatCouldGoWrong = [longSentence]))).toContain(
      "brief.whatCouldGoWrong[0] has a sentence of 31 words; keep each to 30 or fewer so a non-specialist can read it.",
    )
  })

  it("rejects placeholder text anywhere", () => {
    for (const word of ["TODO", "TBD", "lorem ipsum", "FIXME"]) {
      expect(
        errorsFor((s) => (s["problem"].lede = `Some ${word} text.`)),
        word,
      ).toContain(`problem.lede contains placeholder text ("${word}").`)
    }
  })

  it("needs a comparison table whose rows all have one cell per column", () => {
    expect(errorsFor((s) => delete s["comparison"].columns)).toContain(
      "comparison.columns needs at least 2 columns.",
    )
    expect(errorsFor((s) => (s["comparison"].columns = ["Only"]))).toContain(
      "comparison.columns needs at least 2 columns.",
    )
    expect(errorsFor((s) => (s["comparison"].rows = [["a", "b", "c"]]))).toContain(
      "comparison.rows[0] has 3 cells; expected 2, one per column.",
    )
  })

  it("allows an honest 'not for you' note, but only whole", () => {
    expect(errorsFor((s) => delete s["adoption"].notFor)).toEqual([])
    expect(errorsFor((s) => delete s["adoption"].notFor.text)).toContain(
      "adoption.notFor.text is required.",
    )
    expect(errorsFor((s) => delete s["adoption"].notFor.title)).toContain(
      "adoption.notFor.title is required.",
    )
  })

  it("requires the demo to show real output from a named command", () => {
    expect(errorsFor((s) => delete s["demo"].command)).toContain("demo.command is required.")
    expect(errorsFor((s) => delete s["demo"].output)).toContain("demo.output is required.")
    expect(errorsFor((s) => delete s["demo"].source)).toContain("demo.source is required.")
  })

  it("rejects links that are neither https nor relative, wherever they appear", () => {
    expect(errorsFor((s) => (s["footer"].links[0].url = "ftp://x"))).toContain(
      "footer.links[0].url must be an https URL or a relative path.",
    )
    expect(errorsFor((s) => (s["resources"].items[1].url = "http://x"))).toContain(
      "resources.items[1].url must be an https URL or a relative path.",
    )
  })
})
