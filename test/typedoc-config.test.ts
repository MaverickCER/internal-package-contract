import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

const configDir = path.resolve(import.meta.dirname, "../config")

vi.mock("typedoc", () => ({
  JSX: {
    createElement: (tag: string, props: unknown, ...children: unknown[]) => ({
      tag,
      props,
      children,
    }),
    Raw: "raw",
  },
}))

describe("shared TypeDoc accessibility config", () => {
  const config = JSON.parse(readFileSync(path.join(configDir, "typedoc.json"), "utf8")) as {
    customCss: string
    plugin: string[]
  }

  it("ships the stylesheet it points at", () => {
    expect(existsSync(path.resolve(configDir, config.customCss))).toBe(true)
  })

  it("underlines links that sit in running text and keeps focus visible under forced colors", () => {
    const css = readFileSync(path.resolve(configDir, config.customCss), "utf8")
    expect(css).toContain("text-decoration: underline")
    expect(css).toContain(".tsd-signature a")
    expect(css).toContain("@media (forced-colors: active)")
  })

  it("injects a script that names the search box and defuses nested permalinks", async () => {
    const plugin = (await import("../config/typedoc-a11y-search-label.mjs")) as {
      load(app: { renderer: { hooks: { on(name: string, fn: () => unknown): void } } }): void
    }
    let rendered: unknown
    plugin.load({
      renderer: {
        hooks: {
          on: (name, fn) => {
            if (name === "body.end") rendered = fn()
          },
        },
      },
    })
    const script = JSON.stringify(rendered)
    expect(script).toContain("tsd-search-input")
    expect(script).toContain("aria-label")
    expect(script).toContain('querySelectorAll(\\"summary a.tsd-anchor-icon\\")')
    expect(script).toContain("replaceWith")
    expect(script).toContain("MutationObserver")
    expect(script).toContain("seen[id]")
  })
})
