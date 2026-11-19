#!/usr/bin/env node
// TypeDoc plugin: gives the default HTML theme's search input a real accessible name.
//
// TypeDoc's default theme renders the search box as
// `<input id="tsd-search-input" role="combobox" ...>`. It has no `aria-label`, `title`
// or associated `<label>`, and a `placeholder` is not a valid accessible name (WCAG
// 2.1 SC 1.3.1 / 4.1.2). pa11y's WCAG2AA ruleset flags two errors (H91, F68) on every
// generated docs/api/index.html. TypeDoc generates that markup; no consumer wrote it.
//
// docs/api/ is regenerated from scratch on every docs build and never committed.
// A hand-patch of the emitted HTML would be undone by the next build. So the fix is a
// TypeDoc plugin, wired in through the `plugin` array of `typedoc.json`. It hooks the
// theme's own `body.end` extension point, which the theme also uses for its dark-mode
// script. There it injects a one-line script that sets the missing `aria-label` once
// the page has rendered. pa11y drives a headless Chromium page through puppeteer, so it
// evaluates the live DOM after this script runs, not the static markup.
//
// Dependency-free apart from the `typedoc` peer it runs inside: dev tooling, never
// shipped. It resolves the consumer's own installed `typedoc`. Node module resolution
// walks up from node_modules/internal-package-contract/ to the consumer's
// node_modules/typedoc. This package deliberately does not declare `typedoc` itself.
import { JSX } from "typedoc"

// Also turns the permalink icons inside an accordion `<summary>` into inert spans. A link nested in
// the summary, itself a control, is axe's `nested-interactive` violation. A negative `tabindex` does
// not cure it; axe says so explicitly. TypeDoc's default theme renders one in every section heading.
// The heading keeps its `id`, so `#section` URLs still work. Only the permalink icon stops being a link.
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
    // (`"` -> `&quot;`): fine for normal text nodes, but inside `<script>` those
    // entities are never decoded by the browser, which breaks the script outright.
    // `JSX.Raw` (the same primitive TypeDoc's own theme uses for its inline
    // theme/search bootstrap scripts) inserts the string verbatim instead.
    JSX.createElement("script", null, JSX.createElement(JSX.Raw, { html: LABEL_SCRIPT })),
  )
}
