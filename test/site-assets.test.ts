import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { renderBrief, renderIndex } from "../scripts/site/render.mjs"
import { validSite } from "./support-site.js"

const assets = path.resolve(import.meta.dirname, "../scripts/site/assets")
const css = readFileSync(path.join(assets, "styles.css"), "utf8")
const script = readFileSync(path.join(assets, "script.js"), "utf8")
const pkg = { name: "demo-pkg", version: "0.4.2", license: "MIT" }

/** Classes the markup uses only as semantic hooks, with no rule of their own. */
const NO_RULE_NEEDED = new Set<string>(["external-link-note"])

describe("the shared stylesheet", () => {
  const pages = [renderIndex(validSite(), pkg), renderBrief(validSite(), pkg)]
  const used = new Set(
    pages.flatMap((html) =>
      [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)),
    ),
  )
  it("styles every class the generated pages use", () => {
    const missing = [...used].filter(
      (name) => !NO_RULE_NEEDED.has(name) && !css.includes(`.${name}`),
    )
    expect(missing).toEqual([])
  })
  it("keeps the accessible contrast fix for inline code in dark mode", () => {
    expect(css).toContain("--color-code-bg")
  })
  it("hides the site chrome and shows link addresses when the brief is printed", () => {
    expect(css).toMatch(/@media print[\s\S]*\.site-header[\s\S]*display: none/)
    expect(css).toContain('content: " (" attr(href) ")"')
  })
})

describe("the shared script", () => {
  it("takes the theme key from the page, so two packages do not share a stored choice", () => {
    expect(script).toContain('document.documentElement.getAttribute("data-theme-key")')
    expect(script).not.toContain("repo-contract")
  })
  it("wires the menu toggle and the copy buttons the markup provides", () => {
    for (const hook of [".nav-toggle", "primary-nav", "copy-button", "copy-status"])
      expect(script).toContain(hook)
  })
})

describe("inline code on the hero's navy panel", () => {
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((value) => {
      const channel = value / 255
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  it("has white text on a translucent white background, readable on the navy", () => {
    const rule = /\.hero code \{([^}]*)\}/.exec(css)?.[1] ?? ""
    expect(rule).toContain("color: #fff;")
    const alpha = Number(/background: rgb\(255 255 255 \/ ([\d.]+)\)/.exec(rule)?.[1])
    expect(alpha).toBeGreaterThan(0)
    const navy = /--color-navy:\s*#([0-9a-fA-F]{6})/.exec(css)?.[1] ?? ""
    const base = [0, 2, 4].map((i) => parseInt(navy.slice(i, i + 2), 16))
    const blended = base.map((channel) => channel * (1 - alpha) + 255 * alpha)
    const ratio = (luminance([255, 255, 255]) + 0.05) / (luminance(blended) + 0.05)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
