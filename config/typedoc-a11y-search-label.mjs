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

// Also turns the permalink icons inside an accordion `<summary>` into inert spans: a link nested in the
// summary (itself a control) is axe's `nested-interactive` violation -- and a negative `tabindex` does
// not cure it, axe says so explicitly -- and TypeDoc's default theme renders one in every section
// heading. The heading keeps its `id`, so `#section` URLs still work; only the little permalink icon
// inside the collapsible header stops being a link.
const LABEL_SCRIPT = [
  'document.getElementById("tsd-search-input")',
  '?.setAttribute("aria-label", "Search the documentation");',
  // The navigation tree is built by script after load, so the permalinks inside its summaries appear later
  // than the page's own: run once now and again whenever the DOM changes.
  "function fixSummaryLinks() {",
  'document.querySelectorAll("summary a.tsd-anchor-icon").forEach(function (a) {',
  'var s = document.createElement("span");',
  's.className = a.className; s.setAttribute("aria-hidden", "true"); s.innerHTML = a.innerHTML;',
  "a.replaceWith(s); });",
  // TypeDoc gives a class's constructor section and its constructor signature the same id; a duplicate id is an
  // HTML error (and makes `#constructor` ambiguous). The first keeps the id, later ones get a numeric suffix.
  "var seen = Object.create(null);",
  'document.querySelectorAll("[id]").forEach(function (el) {',
  "var id = el.id; if (seen[id] === undefined) { seen[id] = 1; return; }",
  'seen[id] += 1; el.id = id + "-" + seen[id]; }); }',
  "fixSummaryLinks();",
  "new MutationObserver(fixSummaryLinks).observe(document.body, { childList: true, subtree: true });",
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
