#!/usr/bin/env node
// TypeDoc plugin: gives the default HTML theme's search input a real accessible name.
//
// TypeDoc's own bundled default theme renders the search box as
// `<input id="tsd-search-input" role="combobox" ...>` with no `aria-label`, `title`,
// or associated `<label>` (a `placeholder` is not a valid accessible name -- WCAG
// 2.1 SC 1.3.1 / 4.1.2). pa11y's WCAG2AA ruleset flags that as two errors (H91,
// F68) on every generated docs/api/index.html -- markup TypeDoc itself generates,
// not anything hand-authored in a consuming package.
//
// docs/api/ is regenerated from scratch on every docs build (never committed), so
// hand-patching the emitted HTML would be silently undone the next time anyone
// builds the docs. Fixing it here, as a TypeDoc plugin wired in via `typedoc.json`'s
// `plugin` array, keeps the fix in the build pipeline instead: it hooks the theme's
// own `body.end` extension point (the same mechanism the theme uses internally, e.g.
// for its dark-mode bootstrap script) to inject a one-line script that sets the
// missing `aria-label` once the page has rendered. pa11y drives a real headless
// Chromium page via puppeteer, so it evaluates the live DOM after this script runs,
// not the static markup TypeDoc emitted.
//
// Dependency-free (only the `typedoc` peer this plugin runs inside) -- dev tooling,
// never shipped. Resolves against whichever consuming repo's own installed
// `typedoc` is running this plugin (standard Node module resolution walks up from
// this file's location under the consumer's node_modules/internal-package-contract/,
// finding the consumer's own node_modules/typedoc) -- this package deliberately
// does not declare `typedoc` as its own dependency.
import { JSX } from "typedoc"

const LABEL_SCRIPT = [
  'document.getElementById("tsd-search-input")',
  '?.setAttribute("aria-label", "Search the documentation");',
].join("")

/** @param {import("typedoc").Application} app */
export function load(app) {
  app.renderer.hooks.on("body.end", () =>
    // A plain string child would come back through TypeDoc's JSX renderer HTML-escaped
    // (`"` -> `&quot;`) -- fine for normal text nodes, but inside `<script>` those
    // entities are never decoded by the browser, which breaks the script outright.
    // `JSX.Raw` (the same primitive TypeDoc's own theme uses for its inline
    // theme/search bootstrap scripts) inserts the string verbatim instead.
    JSX.createElement("script", null, JSX.createElement(JSX.Raw, { html: LABEL_SCRIPT })),
  )
}
