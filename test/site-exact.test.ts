import { describe, expect, it } from "vitest"
import { inline, renderBrief, renderIndex, slugOf } from "../scripts/site/render.mjs"
import { validateSite, wordCount } from "../scripts/site/validate.mjs"
import { validSite } from "./support-site.js"

// Fixtures are deliberately loose: each test reaches into the content and breaks one field.
type Loose = any // eslint-disable-line @typescript-eslint/no-explicit-any -- each test breaks one field of a valid site, so the fixture type must be loose

const pkg = { name: "demo-pkg", version: "0.4.2", license: "MIT" }
const site = (mutate: (value: Loose) => void = () => {}) => {
  const value = structuredClone(validSite()) as Loose
  mutate(value)
  return value
}
const errorsFor = (mutate: (value: Loose) => void, p: { name: string; version: string } = pkg) =>
  validateSite(site(mutate), p)

const words = (count: number, last = "") =>
  `${Array.from({ length: count - 1 }, () => "word").join(" ")} ${last || "word"}.`

describe("wordCount", () => {
  it("counts runs of non-space characters", () => {
    expect(wordCount("")).toBe(0)
    expect(wordCount("a")).toBe(1)
    expect(wordCount("a   b\tc\nd")).toBe(4)
  })
})

describe("validateSite -- text fields", () => {
  it("names each missing top-level field", () => {
    for (const key of ["siteUrl", "repoUrl", "title", "description"]) {
      expect(errorsFor((s) => delete s[key])).toEqual([`${key} is required.`])
    }
  })
  it("treats blank and non-string text as missing", () => {
    expect(errorsFor((s) => (s.title = "   "))).toEqual(["title is required."])
    expect(errorsFor((s) => (s.title = 5))).toEqual(["title is required."])
    expect(errorsFor((s) => (s.hero.heading = "  \n "))).toEqual(["hero.heading is required."])
  })
  it("requires the site and repository URLs to be https URLs without spaces", () => {
    for (const key of ["siteUrl", "repoUrl"]) {
      const message = `${key} must be an https URL.`
      expect(errorsFor((s) => (s[key] = "http://example.com"))).toContain(message)
      expect(errorsFor((s) => (s[key] = "xhttps://example.com"))).toContain(message)
      expect(errorsFor((s) => (s[key] = "https://example.com extra"))).toContain(message)
      expect(errorsFor((s) => (s[key] = "https://example.com/a"))).toEqual([])
    }
  })
  it("reports a missing section once and skips its fields", () => {
    expect(errorsFor((s) => delete s.hero)).toEqual(["hero is required."])
  })
})

describe("validateSite -- required lists", () => {
  it("says what is missing from each empty list, by its kind", () => {
    expect(errorsFor((s) => (s.comparison.rows = []))).toEqual([
      "comparison.rows needs at least one row.",
    ])
    expect(errorsFor((s) => (s.adoption.steps = []))).toEqual([
      "adoption.steps needs at least one step.",
    ])
    expect(errorsFor((s) => (s.problem.items = []))).toEqual([
      "problem.items needs at least one item.",
    ])
    expect(errorsFor((s) => delete s.model.flow)).toEqual(["model.flow needs at least one item."])
    expect(errorsFor((s) => (s.brief.whyItMatters = []))).toEqual([
      "brief.whyItMatters needs at least one item.",
    ])
    expect(errorsFor((s) => (s.brief.whatCouldGoWrong = []))).toEqual([
      "brief.whatCouldGoWrong needs at least one item.",
    ])
    expect(errorsFor((s) => (s.resources.items = []))).toEqual([
      "resources.items needs at least one item.",
    ])
  })
})

describe("validateSite -- hero", () => {
  it("requires the outcome to be exactly one sentence, ignoring padding", () => {
    const message = "hero.outcome must be a single sentence."
    expect(errorsFor((s) => (s.hero.outcome = "Cut cost.\n"))).toEqual([])
    expect(errorsFor((s) => (s.hero.outcome = "Cut cost"))).toEqual([message])
    expect(errorsFor((s) => (s.hero.outcome = "Cut cost. Then more."))).toEqual([message])
    expect(errorsFor((s) => (s.hero.outcome = "Cut cost.  Then more."))).toEqual([message])
    expect(errorsFor((s) => (s.hero.outcome = "Cut cost! Then more?"))).toEqual([message])
    expect(errorsFor((s) => (s.hero.outcome = "Cuts cost by 1.5x on average."))).toEqual([])
    expect(errorsFor((s) => (s.hero.outcome = "Is it cheaper?"))).toEqual([])
    expect(errorsFor((s) => (s.hero.outcome = "Wow!"))).toEqual([])
    expect(errorsFor((s) => (s.hero.outcome = "Version 1.5x ships soon"))).toEqual([message])
  })
  it("allows eighty words in the lede and support together and no more", () => {
    const set = (total: number) => (s: Loose) => {
      s.hero.lede = words(total - 1)
      s.hero.support = "One."
    }
    expect(errorsFor(set(80))).toEqual([])
    expect(errorsFor(set(81))).toEqual([
      "hero.lede and hero.support together are 81 words; keep them to 80 or fewer.",
    ])
  })
})

describe("validateSite -- install and calls to action", () => {
  it("allows three commands and no more, and the first must install the package", () => {
    expect(errorsFor((s) => (s.install.commands = ["npm i demo-pkg", "b", "c"]))).toEqual([])
    expect(errorsFor((s) => (s.install.commands = ["npm i demo-pkg", "b", "c", "d"]))).toEqual([
      "install.commands has 4 commands; a quick start is at most 3.",
    ])
    expect(errorsFor((s) => (s.install.commands = ["npm i other"]))).toEqual([
      'install.commands[0] must install "demo-pkg".',
    ])
    expect(errorsFor((s) => (s.install.commands = []))).toEqual([
      "install.commands needs at least one command.",
    ])
    expect(errorsFor((s) => delete s.install.commands)).toEqual([
      "install.commands needs at least one command.",
    ])
  })
  it("requires both calls to action and their labels", () => {
    expect(errorsFor((s) => delete s.cta.primary)).toEqual(["cta.primary is required."])
    expect(errorsFor((s) => delete s.cta.secondary)).toEqual(["cta.secondary is required."])
    expect(errorsFor((s) => (s.cta.secondary.label = " "))).toEqual([
      "cta.secondary.label is required.",
    ])
    expect(errorsFor((s) => (s.cta.primary.label = ""))).toEqual(["cta.primary.label is required."])
  })
  it("rejects a resource that repeats the primary call to action", () => {
    expect(errorsFor((s) => (s.resources.items[1].url = s.cta.primary.url))).toEqual([
      "resources.items[1].url repeats the primary call to action; the README is linked from the hero and the close only.",
    ])
  })
  it("requires each resource's title, description and label", () => {
    for (const field of ["title", "description", "label"]) {
      expect(errorsFor((s) => delete s.resources.items[0][field])).toEqual([
        `resources.items[0].${field} is required.`,
      ])
    }
  })
  it("does not fail on resources that are not a list", () => {
    expect(errorsFor((s) => (s.resources.items = "none"))).toContain(
      "resources.items needs at least one item.",
    )
  })
})

describe("validateSite -- guarantees", () => {
  it("requires a claim, link and url on each", () => {
    for (const field of ["claim", "linkLabel", "url"]) {
      expect(errorsFor((s) => delete s.guarantees.items[0][field])).toContain(
        `guarantees.items[0].${field} is required.`,
      )
    }
    expect(errorsFor((s) => (s.guarantees.items = []))).toEqual([
      "guarantees.items needs at least one guarantee.",
    ])
    expect(errorsFor((s) => delete s.guarantees.items)).toEqual([
      "guarantees.items needs at least one guarantee.",
    ])
  })
  it("requires a scope of at least twenty characters once trimmed", () => {
    const message =
      "guarantees.items[0].scope must say what the guarantee covers and what it does not (at least 20 characters)."
    expect(errorsFor((s) => (s.guarantees.items[0].scope = "x".repeat(20)))).toEqual([])
    expect(errorsFor((s) => (s.guarantees.items[0].scope = "x".repeat(19)))).toEqual([message])
    expect(errorsFor((s) => (s.guarantees.items[0].scope = `  ${"x".repeat(19)}  `))).toEqual([
      message,
    ])
    expect(errorsFor((s) => delete s.guarantees.items[0].scope)).toEqual([message])
  })
})

describe("validateSite -- comparison, adoption and demo", () => {
  it("needs two columns and a cell per column in every row", () => {
    expect(errorsFor((s) => (s.comparison.columns = ["Only"]))).toEqual([
      "comparison.columns needs at least 2 columns.",
    ])
    expect(errorsFor((s) => delete s.comparison.columns)).toEqual([
      "comparison.columns needs at least 2 columns.",
    ])
    expect(errorsFor((s) => (s.comparison.rows = [["a", "b"], ["c"], "x"]))).toEqual([
      "comparison.rows[1] has 1 cells; expected 2, one per column.",
      "comparison.rows[2] has 0 cells; expected 2, one per column.",
    ])
    expect(errorsFor((s) => delete s.comparison.rows)).toEqual([
      "comparison.rows needs at least one row.",
    ])
  })
  it("requires the not-for callout's title and text", () => {
    expect(errorsFor((s) => delete s.adoption.notFor.title)).toEqual([
      "adoption.notFor.title is required.",
    ])
    expect(errorsFor((s) => delete s.adoption.notFor.text)).toEqual([
      "adoption.notFor.text is required.",
    ])
    expect(errorsFor((s) => delete s.adoption.notFor)).toEqual([])
  })
  it("requires the demo's source, label and url", () => {
    expect(errorsFor((s) => delete s.demo.source)).toEqual(["demo.source is required."])
    expect(errorsFor((s) => delete s.demo.source.label)).toEqual(["demo.source.label is required."])
    expect(errorsFor((s) => delete s.demo.source.url)).toEqual(["demo.source.url is required."])
  })
})

describe("validateSite -- maturity", () => {
  const maturity = (version: string) =>
    errorsFor((s) => delete s.maturity, { name: "demo-pkg", version })
  it("requires it below 1.0.0 and only then, reading the leading number of the version", () => {
    const message = (v: string) =>
      `maturity is required while the package is below 1.0.0 (version ${v}).`
    expect(maturity("0.4.2")).toEqual([message("0.4.2")])
    expect(maturity("1.0.0")).toEqual([])
    expect(maturity("10.2.0")).toEqual([])
    expect(maturity("v1.0.0")).toEqual([message("v1.0.0")])
    expect(maturity("garbage")).toEqual([message("garbage")])
  })
})

describe("validateSite -- the brief", () => {
  const long = (n: number) => `${words(n)}`
  it("allows a sentence of thirty words and no more, in every field", () => {
    for (const key of ["oneLine", "problem", "whatItDoes", "whatItCosts", "whatWeAsk"]) {
      expect(errorsFor((s) => (s.brief[key] = long(30)))).toEqual([])
      expect(errorsFor((s) => (s.brief[key] = long(31)))).toEqual([
        `brief.${key} has a sentence of 31 words; keep each to 30 or fewer so a non-specialist can read it.`,
      ])
    }
    for (const key of ["whyItMatters", "whatCouldGoWrong"]) {
      expect(errorsFor((s) => (s.brief[key] = ["Fine.", long(31)]))).toEqual([
        `brief.${key}[1] has a sentence of 31 words; keep each to 30 or fewer so a non-specialist can read it.`,
      ])
    }
  })
  it("splits sentences on a full stop, a question mark or an exclamation mark", () => {
    for (const mark of [".", "!", "?"]) {
      const two = `${words(20).slice(0, -1)}${mark} ${words(20)}`
      expect(errorsFor((s) => (s.brief.problem = two))).toEqual([])
    }
    expect(errorsFor((s) => (s.brief.problem = `${long(20).slice(0, -1)}.\n${long(20)}`))).toEqual(
      [],
    )
    expect(errorsFor((s) => (s.brief.problem = `${long(20).slice(0, -1)}.x ${long(20)}`))).toEqual([
      "brief.problem has a sentence of 40 words; keep each to 30 or fewer so a non-specialist can read it.",
    ])
  })
  it("ignores a list that is not a list", () => {
    expect(errorsFor((s) => (s.brief.whyItMatters = "text"))).toEqual([
      "brief.whyItMatters needs at least one item.",
    ])
  })
})

describe("validateSite -- links and placeholders", () => {
  it("accepts an https URL or a relative path and nothing else", () => {
    const bad = (url: unknown) =>
      errorsFor((s) => (s.footer.license.url = url)).filter((e) => e.includes("footer.license.url"))
    expect(bad("https://a.test/x")).toEqual([])
    expect(bad("api/")).toEqual([])
    expect(bad("http://a.test")).toEqual([
      "footer.license.url must be an https URL or a relative path.",
    ])
    expect(bad("xhttps://a.test")).toHaveLength(1)
    expect(bad("https://a.test x")).toHaveLength(1)
    expect(bad("//a.test")).toHaveLength(1)
    expect(bad(5)).toHaveLength(1)
  })
  it("reports placeholder text with its path, inside lists too, and survives null values", () => {
    expect(errorsFor((s) => (s.hero.support = "TODO write this."))).toEqual([
      'hero.support contains placeholder text ("TODO").',
    ])
    expect(errorsFor((s) => (s.problem.items = ["fine", "lorem ipsum"]))).toEqual([
      'problem.items[1] contains placeholder text ("lorem ipsum").',
    ])
    expect(errorsFor((s) => (s.footer.extra = [{ note: "TBD" }]))).toEqual([
      'footer.extra[0].note contains placeholder text ("TBD").',
    ])
    expect(errorsFor((s) => (s.footer.extra = null))).toEqual([])
    expect(errorsFor((s) => (s.footer.extra = [5, true, null]))).toEqual([])
  })
})

describe("inline and slugOf", () => {
  it("escapes the five characters that can break out of markup", () => {
    expect(inline(`a & b < c > d "e" 'f'`)).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;",
    )
  })
  it("keeps an ampersand in a link URL and rejects an unsafe one", () => {
    expect(inline("[x](https://a.test/?a=1&b=2)")).toBe(
      '<a href="https://a.test/?a=1&amp;b=2">x</a>',
    )
    expect(inline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))")
  })
  it("makes a storage-safe key", () => {
    expect(slugOf("@Scope/My  Pkg")).toBe("scope-my-pkg")
    expect(slugOf("a-b")).toBe("a-b")
    expect(slugOf("--a--")).toBe("a")
  })
})

describe("renderIndex -- structure", () => {
  const html = (mutate: (s: Loose) => void = () => {}, p = pkg) => renderIndex(site(mutate), p)
  it("states maturity, version and licence in the hero, and omits the pre-1.0 label from 1.x", () => {
    expect(html()).toContain('<p class="hero-meta">Pre-1.0 · v0.4.2 · MIT</p>')
    expect(html(undefined, { ...pkg, version: "1.2.0" })).toContain(
      '<p class="hero-meta">v1.2.0 · MIT</p>',
    )
    expect(html(undefined, { ...pkg, version: "10.0.0" })).toContain(
      '<p class="hero-meta">v10.0.0 · MIT</p>',
    )
    expect(html(undefined, { ...pkg, version: "x1.0.0" })).toContain("Pre-1.0 · vx1.0.0")
  })
  it("shows the install note only when there is one", () => {
    expect(html()).toContain('<p class="hero-note">Install only the tools you already use.</p>')
    expect(html((s) => delete s.install.note)).not.toContain("hero-note")
  })
  it("leaves nothing behind where an optional part is absent", () => {
    const bare = html(
      (s) => {
        delete s.install.note
        delete s.adoption.notFor
        delete s.fit.links
      },
      { ...pkg, version: "1.0.0" },
    )
    expect(bare).toContain('</pre></div><div class="hero-actions">')
    expect(bare).toContain("</li></ol></div></div></section>")
    expect(bare).toContain('Read the README first.</p><div class="hero-actions">')
  })
  it("ends the problem diagram's text with one full stop", () => {
    expect(html()).toContain("no single place answers what is acceptable.")
    expect(html((s) => (s.problem.conclusion = "It ends already."))).toContain("It ends already.")
    expect(html((s) => (s.problem.conclusion = "no truth. really"))).toContain("no truth. really.")
  })
  it("joins repeated items with nothing between them", () => {
    const two = html((s) => {
      s.guarantees.items.push({ ...s.guarantees.items[0] })
      s.comparison.rows.push(["third", "fourth"])
      s.adoption.steps = ["One.", "Two.", "Three."]
      s.problem.items = ["a", "b"]
      s.model.flow = ["x", "y", "z"]
    })
    expect(two).toContain('</div><div class="adoption-card guarantee">')
    expect(two).toContain("</tr><tr>")
    expect(two).toContain("<li>One.</li><li>Two.</li><li>Three.</li>")
    expect(two).toContain("<li>a</li><li>b</li>")
    expect(two).toContain("</td></tr>")
    expect(two).not.toMatch(/Stryker/)
  })
  it("shows the not-for callout only when there is one", () => {
    expect(html()).toContain("You probably do not need it when")
    expect(html((s) => delete s.adoption.notFor)).not.toContain("You probably do not need it when")
  })
  it("shows the maturity note and the fit links only when they apply", () => {
    expect(html()).toContain('<p class="maturity">')
    expect(html(undefined, { ...pkg, version: "1.0.0" })).not.toContain('class="maturity"')
    expect(
      html(
        (s) =>
          (s.fit.links = [
            { label: "A", url: "api/" },
            { label: "B", url: "https://x.test" },
          ]),
      ),
    ).toContain('<p class="fit-links"><a href="api/">A</a> · <a href="https://x.test">B</a></p>')
    expect(html()).not.toContain("fit-links")
    expect(html((s) => (s.fit.links = []))).not.toContain("fit-links")
  })
  it("describes the social image when there is one, and a plain card when there is not", () => {
    const withImage = html((s) => (s.ogImage = "assets/og.png"))
    expect(withImage).toContain(
      '<meta property="og:image" content="https://example.github.io/demo-pkg/assets/og.png" />',
    )
    expect(withImage).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(withImage).toContain(
      '<meta name="twitter:image" content="https://example.github.io/demo-pkg/assets/og.png" />',
    )
    expect(html()).toContain('<meta name="twitter:card" content="summary" />')
    expect(html()).not.toContain("og:image")
  })
})

describe("renderBrief -- risks", () => {
  const brief = (mutate: (s: Loose) => void = () => {}, p = pkg) => renderBrief(site(mutate), p)
  it("lists only the stated risks when the maturity note does not apply", () => {
    const risk = "<ul><li>It is pre-1.0, so a minor release may change behaviour.</li></ul>"
    expect(
      brief((s) => (s.maturity = "demo-pkg is pre-1.0."), { ...pkg, version: "1.0.0" }),
    ).toContain(risk)
    expect(brief((s) => delete s.maturity)).toContain(risk)
  })
  it("lists the maturity note first for a pre-1.0 package, and never otherwise", () => {
    const maturityText = "demo-pkg is pre-1.0."
    expect(brief((s) => (s.maturity = maturityText))).toContain(
      `<li>${maturityText}</li><li>It is pre-1.0, so a minor release may change behaviour.</li>`,
    )
    expect(brief((s) => delete s.maturity)).not.toContain("<li>undefined</li>")
    expect(brief((s) => (s.maturity = maturityText), { ...pkg, version: "1.0.0" })).not.toContain(
      `<li>${maturityText}</li>`,
    )
  })
})
