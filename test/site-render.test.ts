import { describe, expect, it } from "vitest"
import { inline, renderBrief, renderIndex, slugOf } from "../scripts/site/render.mjs"
import { validSite, type Loose } from "./support-site.js"

const pkg = { name: "demo-pkg", version: "0.4.2", license: "MIT" }
const page = (mutate: (s: Loose) => void = () => {}, p = pkg) => {
  const site = structuredClone(validSite()) as Loose
  mutate(site)
  return renderIndex(site, p)
}
const count = (html: string, needle: string) => html.split(needle).length - 1
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))

describe("inline", () => {
  it("escapes HTML, then turns `code`, **bold** and [links](url) into markup", () => {
    expect(inline("a <b> & c")).toBe("a &lt;b&gt; &amp; c")
    expect(inline("run `npm i <x>` now")).toBe("run <code>npm i &lt;x&gt;</code> now")
    expect(inline("a **strong** word")).toBe("a <strong>strong</strong> word")
    expect(inline("see [the docs](https://example.com/a?b=1&c=2)")).toBe(
      'see <a href="https://example.com/a?b=1&amp;c=2">the docs</a>',
    )
    expect(inline("see [local](api/)")).toBe('see <a href="api/">local</a>')
  })
  it("never produces an attribute-breaking or script link", () => {
    expect(inline('[x](https://a.com/"onclick="y)')).not.toContain('"onclick')
    expect(inline("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))")
  })
})

describe("slugOf", () => {
  it("makes a storage-safe key from a package name", () => {
    expect(slugOf("@scope/My Pkg")).toBe("scope-my-pkg")
    expect(slugOf("repo-contract")).toBe("repo-contract")
  })
})

describe("renderIndex: structure", () => {
  const html = page()
  it("is a complete, language-tagged document with one h1, a skip link and landmarks", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain('<html lang="en"')
    expect(count(html, "<h1")).toBe(1)
    expect(html).toContain('<a class="skip-link" href="#main">Skip to content</a>')
    for (const landmark of ["<header", "<nav", '<main id="main"', "<footer"])
      expect(html).toContain(landmark)
  })
  it("gives every section a heading that names it", () => {
    for (const m of html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) {
      expect(ids(html).has(m[1]!), m[1]).toBe(true)
    }
  })
  it("has a nav link and a footer link only to sections that exist", () => {
    for (const m of html.matchAll(/href="#([^"]+)"/g)) expect(ids(html).has(m[1]!), m[1]).toBe(true)
  })
  it("makes every copy button point at a code block that exists", () => {
    for (const m of html.matchAll(/data-copy-target="([^"]+)"/g))
      expect(ids(html).has(m[1]!), m[1]).toBe(true)
  })
  it("orders the sections the way a decision-maker reads them", () => {
    const order = [
      "top",
      "why",
      "how",
      "see-it",
      "guarantees",
      "why-not-ci",
      "adoption",
      "brief",
      "proof",
      "fit",
    ]
    const at = order.map((id) => html.indexOf(`id="${id}"`))
    expect(at.every((n) => n > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })
  it("links the stylesheet and script that ship beside it, and sets the theme key from the package", () => {
    expect(html).toContain('<link rel="stylesheet" href="styles.css" />')
    expect(html).toContain('<script src="script.js"></script>')
    expect(html).toContain('"demo-pkg-theme"')
  })
})

describe("renderIndex: content", () => {
  it("shows the heading, the organizational outcome and the quick start in the hero", () => {
    const html = page()
    expect(html).toContain('<h1 id="hero-heading">Do the thing once, everywhere.</h1>')
    expect(html).toContain('<p class="hero-outcome">Give every repository one versioned standard')
    expect(html).toContain(
      '<code id="hero-install">npm install --save-dev demo-pkg\nnpx demo-pkg init</code>',
    )
    expect(html).toContain("Install only the tools you already use.")
  })
  it("uses the primary call to action twice, in the hero and the close, and never in the header", () => {
    const html = page()
    const url = "https://github.com/example/demo-pkg#readme"
    expect(count(html, `class="button button--primary" href="${url}"`)).toBe(2)
    expect(count(html, `href="${url}"`)).toBe(2)
    expect(html).toContain("Run the examples")
  })
  it("states each guarantee with its scope and a link, right next to each other", () => {
    const html = page()
    expect(html).toContain("No network calls in the shipped code.")
    expect(html).toContain(
      "Covers this package&#39;s own code; it does not cover commands you configure.",
    )
    expect(html).toContain('href="https://github.com/example/demo-pkg/blob/main/SECURITY.md"')
  })
  it("shows the demo output verbatim, escaped, with the command and its source", () => {
    const html = page((s) => (s["demo"].output = "a <b> & c\n  next"))
    expect(html).toContain('<code id="demo-output">a &lt;b&gt; &amp; c\n  next</code>')
    expect(html).toContain("npm run demo")
    expect(html).toContain('href="https://github.com/example/demo-pkg/tree/main/examples/demo"')
  })
  it("renders the comparison as a captioned table, with the columns the package names", () => {
    const html = page()
    expect(html).toContain("<caption>Where common approaches stop</caption>")
    expect(html).toContain('<th scope="col">Today</th><th scope="col">With demo-pkg</th>')
    expect(html).toContain('<th scope="row">Rules scattered</th><td>One contract</td>')
    const three = page((s) => {
      s["comparison"].columns = ["Tool", "Solves", "Does not"]
      s["comparison"].rows = [["dotenv", "Loads values", "Says nothing about owners"]]
    })
    expect(three).toContain(
      '<th scope="col">Tool</th><th scope="col">Solves</th><th scope="col">Does not</th>',
    )
    expect(three).toContain(
      '<th scope="row">dotenv</th><td>Loads values</td><td>Says nothing about owners</td>',
    )
  })
  it("offers a theme toggle that the shared script drives, named for assistive technology", () => {
    const html = page()
    expect(html).toContain(
      '<button class="icon-button" type="button" id="theme-toggle" aria-pressed="false"><span aria-hidden="true" class="theme-toggle-icon">◐</span><span class="sr-only">Toggle dark mode</span></button>',
    )
  })
  it("says when the package is probably not for you, if the content does", () => {
    expect(page()).toContain(
      '<p class="callout-title">You probably do not need it when</p><p>Your project is small and one team owns every rule.</p>',
    )
    expect(page((s) => delete s["adoption"].notFor)).not.toContain("You probably do not need it")
  })
  it("gives diagrams an accessible description and hides the drawing from assistive technology", () => {
    const html = page()
    expect(html).toContain(
      '<p class="sr-only">Tools feed demo-pkg, which produces one verdict.</p>',
    )
    expect(html).toContain('<ol class="diagram-tree" aria-hidden="true">')
  })
  it("ends the problem diagram's description with one full stop, whether or not the conclusion has punctuation", () => {
    const plain = page()
    expect(plain).toContain("CI files, scripts — no single place answers what is acceptable.</p>")
    const asked = page((s) => (s["problem"].conclusion = "what does acceptable mean here?"))
    expect(asked).toContain("CI files, scripts — what does acceptable mean here?</p>")
    expect(asked).not.toContain("here?.")
  })
  it("makes every code block keyboard-focusable, so one that scrolls sideways can still be read", () => {
    const html = page()
    const blocks = [...html.matchAll(/<pre[^>]*>/g)].map((m) => m[0])
    expect(blocks.length).toBe(2)
    for (const tag of blocks) expect(tag).toBe('<pre tabindex="0">')
  })
  it("offers the brief with the standard secondary button, whose contrast is already checked", () => {
    const html = page()
    expect(html).toContain(
      '<a class="button button--secondary" href="brief.html">Open the one-page brief</a>',
    )
    expect(html).not.toContain("primary-outline")
  })
  it("escapes package-controlled text", () => {
    const html = page((s) => (s["hero"].heading = "<script>alert(1)</script>"))
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  })
})

describe("renderIndex: maturity", () => {
  it("says pre-1.0 in the hero and repeats the statement in the closing section", () => {
    const html = page()
    expect(html).toContain('<p class="hero-meta">Pre-1.0 · v0.4.2 · MIT</p>')
    expect(
      count(html, "demo-pkg is pre-1.0. A 0.x minor may carry a breaking change; pin accordingly."),
    ).toBe(1)
    expect(html.indexOf("is pre-1.0.")).toBeGreaterThan(html.indexOf('id="fit"'))
  })
  it("shows only the version and licence once the package is 1.0 or later", () => {
    const html = page((s) => delete s["maturity"], {
      name: "demo-pkg",
      version: "1.2.0",
      license: "MIT",
    })
    expect(html).toContain('<p class="hero-meta">v1.2.0 · MIT</p>')
    expect(html).not.toContain("Pre-1.0")
  })
})

describe("renderIndex: the manager's brief", () => {
  it("points to the one-page brief from its own section and from the hero", () => {
    const html = page()
    expect(count(html, 'href="brief.html"')).toBeGreaterThanOrEqual(2)
    expect(html).toContain("demo-pkg lets every repository follow one shared engineering standard.")
  })
})

describe("renderBrief", () => {
  const site = validSite() as Loose
  const html = renderBrief(site, pkg)
  it("is a standalone page that prints on one sheet, with its own title and a way back", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("<title>demo-pkg: a one-page brief</title>")
    expect(count(html, "<h1")).toBe(1)
    expect(html).toContain('href="styles.css"')
    expect(html).toContain('<a href="index.html">')
  })
  it("answers the manager's questions in a fixed order, in their own words", () => {
    const order = [
      "The problem",
      "What it does",
      "Why it matters",
      "What it costs",
      "What could go wrong",
      "What we are asking for",
    ]
    const at = order.map((heading) => html.indexOf(`>${heading}<`))
    expect(at.every((n) => n > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html).toContain("Teams keep their quality rules in many different places")
    expect(html).toContain("<li>Every team is held to the same bar.</li>")
  })
  it("lists the maturity statement first among the risks when there is one", () => {
    expect(html).toContain(
      "<li>demo-pkg is pre-1.0. A 0.x minor may carry a breaking change; pin accordingly.</li><li>It is pre-1.0",
    )
  })
  it("sends the reader on to the README and the examples", () => {
    expect(html).toContain('href="https://github.com/example/demo-pkg#readme"')
    expect(html).toContain('href="https://github.com/example/demo-pkg/tree/main/examples"')
  })
})
