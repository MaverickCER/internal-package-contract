// Renders a package's landing page and one-page brief from its content (docs/site.json). Pure: content in,
// HTML out. The markup uses the class names in assets/styles.css, and every package gets the same
// structure, so a fix to the page or its accessibility lands once.

/** @param {unknown} value @returns {string} text safe for HTML content or a double-quoted attribute. */
function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const SAFE_URL = /^(?:https:\/\/[^\s"'<>)]+|(?!\/\/)[^:\s"'<>)]+)$/

/**
 * Escapes text, then turns `code`, **bold** and [text](url) into markup. A link whose URL is neither https
 * nor a relative path is left as the literal text it was written as.
 * @param {string} text
 * @returns {string}
 */
export function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(([^)\s`*]+)\)/g, (whole, label, url) => {
      return SAFE_URL.test(url) ? `<a href="${url}">${label}</a>` : whole
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}

/** @param {string} name @returns {string} a storage-safe key made from a package name. */
export function slugOf(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const isPreOne = (version) => {
  const major = /^(\d+)\./.exec(String(version))
  return major === null || Number(major[1]) === 0
}

/** The small line under the headline: maturity, version, licence. */
function heroMeta(pkg) {
  return [isPreOne(pkg.version) ? "Pre-1.0" : null, `v${pkg.version}`, pkg.license ?? null]
    .filter(Boolean)
    .join(" · ")
}

const heading = (level, id, text) => `<h${level} id="${id}">${inline(text)}</h${level}>`
const eyebrow = (text) => `<p class="section-eyebrow">${inline(text)}</p>`

function section({ id, muted = false, narrow = true, body }) {
  return `<section class="section${muted ? " section--muted" : ""}" id="${id}" aria-labelledby="${id}-heading"><div class="container${narrow ? " container--narrow" : ""}">${body}</div></section>`
}

/** @param {string} description the text for assistive technology @param {string[]} htmlLines already-escaped markup, one per line of the drawing */
function diagram(description, htmlLines) {
  return `<div class="diagram"><p class="sr-only">${inline(description)}</p><ol class="diagram-tree" aria-hidden="true">${htmlLines.map((line) => `<li>${line}</li>`).join("")}</ol></div>`
}

function codeBlock({ label, id, code }) {
  return `<div class="code-block"><div class="code-block-header"><span class="code-block-filename">${inline(label)}</span><button class="copy-button" type="button" data-copy-target="${id}">Copy</button></div><pre tabindex="0"><code id="${id}">${esc(code)}</code></pre></div>`
}

function button(link, kind) {
  return `<a class="button button--${kind}" href="${esc(link.url)}">${inline(link.label)}</a>`
}

/**
 * @param {Record<string, any>} site - validated content.
 * @param {{ name: string, version: string, license?: string }} pkg
 * @returns {string} the whole landing page.
 */
export function renderIndex(site, pkg) {
  const {
    hero,
    install,
    cta,
    problem,
    model,
    guarantees,
    comparison,
    demo,
    adoption,
    resources,
    brief,
    fit,
    footer,
  } = site
  const preOne = isPreOne(pkg.version)
  const nav = [
    ["why", "Why it exists"],
    ["how", "How it works"],
    ["see-it", "See it"],
    ["guarantees", "Guarantees"],
    ["adoption", "Adoption"],
    ["proof", "Proof"],
  ]

  const heroSection = `<section class="hero" id="top" aria-labelledby="hero-heading"><div class="container">${eyebrow(hero.eyebrow)}${heading(1, "hero-heading", hero.heading)}<p class="hero-lede">${inline(hero.lede)}</p><p class="hero-support">${inline(hero.support)}</p><p class="hero-outcome">${inline(hero.outcome)}</p><p class="hero-meta">${esc(heroMeta(pkg))}</p>${codeBlock({ label: install.label, id: "hero-install", code: install.commands.join("\n") })}${install.note ? `<p class="hero-note">${inline(install.note)}</p>` : ""}<div class="hero-actions">${button(cta.primary, "primary")}${button(cta.secondary, "secondary button--on-dark")}<a class="hero-link" href="brief.html">${inline("For your manager: the one-page brief")}</a></div></div></section>`

  const problemLines = [
    `<span class="diagram-branch-label">${esc(problem.listLabel)}</span><ol>${problem.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`,
    `<span class="diagram-branch-label">&rarr; ${esc(problem.conclusion)}</span>`,
  ]
  const problemSection = section({
    id: "why",
    body: `${eyebrow(problem.eyebrow)}${heading(2, "why-heading", problem.heading)}<p class="section-lede">${inline(problem.lede)}</p>${diagram(`${problem.listLabel}: ${problem.items.join(", ")} — ${problem.conclusion}${/[.!?]$/.test(problem.conclusion) ? "" : "."}`, problemLines)}<p>${inline(problem.closing)}</p>`,
  })

  const modelLines = model.flow.map(
    (line) => `<span class="diagram-branch-label">${inline(line)}</span>`,
  )
  const modelSection = section({
    id: "how",
    muted: true,
    body: `${eyebrow(model.eyebrow)}${heading(2, "how-heading", model.heading)}<p class="section-lede">${inline(model.lede)}</p>${diagram(model.flowDescription, modelLines)}<p>${inline(model.note)}</p>`,
  })

  const demoSection = section({
    id: "see-it",
    body: `${eyebrow(demo.eyebrow)}${heading(2, "see-it-heading", demo.heading)}<p class="section-lede">${inline(demo.intro)}</p>${codeBlock({ label: demo.command, id: "demo-output", code: demo.output })}<p class="source-note">Source: <a href="${esc(demo.source.url)}">${inline(demo.source.label)}</a></p><p>${inline(demo.explanation)}</p>`,
  })

  const guaranteeSection = section({
    id: "guarantees",
    muted: true,
    narrow: false,
    body: `${eyebrow(guarantees.eyebrow)}${heading(2, "guarantees-heading", guarantees.heading)}<p class="section-lede">${inline(guarantees.lede)}</p><div class="adoption-grid">${guarantees.items.map((item) => `<div class="adoption-card guarantee"><span class="adoption-card-title">${inline(item.claim)}</span><span class="adoption-card-desc"><strong>Scope:</strong> ${inline(item.scope)}</span><a class="external-link-note" href="${esc(item.url)}">${inline(item.linkLabel)} ↗</a></div>`).join("")}</div>`,
  })

  const comparisonSection = section({
    id: "why-not-ci",
    narrow: false,
    body: `${eyebrow(comparison.eyebrow)}${heading(2, "why-not-ci-heading", comparison.heading)}<p class="section-lede">${inline(comparison.lede)}</p><div class="table-scroll"><table class="comparison-table"><caption>${inline(comparison.caption)}</caption><thead><tr>${comparison.columns.map((column) => `<th scope="col">${inline(column)}</th>`).join("")}</tr></thead><tbody>${comparison.rows.map(([first, ...rest]) => `<tr><th scope="row">${inline(first)}</th>${rest.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
  })

  const adoptionSection = section({
    id: "adoption",
    muted: true,
    body: `${eyebrow(adoption.eyebrow)}${heading(2, "adoption-heading", adoption.heading)}<p class="section-lede">${inline(adoption.lede)}</p><div class="callout callout--note"><p class="callout-title">${inline(adoption.calloutTitle)}</p><ol class="callout-steps">${adoption.steps.map((step) => `<li>${inline(step)}</li>`).join("")}</ol></div>${adoption.notFor ? `<div class="callout callout--note"><p class="callout-title">${inline(adoption.notFor.title)}</p><p>${inline(adoption.notFor.text)}</p></div>` : ""}`,
  })

  const briefSection = section({
    id: "brief",
    body: `${eyebrow("For decision-makers")}${heading(2, "brief-heading", brief.heading)}<p class="section-lede">${inline(brief.oneLine)}</p><p>It answers what this is, why it matters, what it costs, what could go wrong and what is being asked, in plain language, on one printable page.</p><div class="hero-actions"><a class="button button--secondary" href="brief.html">Open the one-page brief</a></div>`,
  })

  const proofSection = section({
    id: "proof",
    muted: true,
    narrow: false,
    body: `${eyebrow(resources.eyebrow)}${heading(2, "proof-heading", resources.heading)}<p class="section-lede">${inline(resources.lede)}</p><div class="adoption-grid">${resources.items.map((item) => `<a class="adoption-card" href="${esc(item.url)}"><span class="adoption-card-title">${inline(item.title)}</span><span class="adoption-card-desc">${inline(item.description)}</span><span class="external-link-note">${inline(item.label)} ↗</span></a>`).join("")}</div>`,
  })

  const fitSection = section({
    id: "fit",
    body: `${eyebrow(fit.eyebrow)}${heading(2, "fit-heading", fit.heading)}<p class="section-lede">${inline(fit.lede)}</p>${preOne ? `<p class="maturity">${inline(site.maturity)}</p>` : ""}<div class="hero-actions">${button(cta.primary, "primary")}${button(cta.secondary, "secondary")}</div>${fit.links?.length ? `<p class="fit-links">${fit.links.map((link) => `<a href="${esc(link.url)}">${inline(link.label)}</a>`).join(" · ")}</p>` : ""}`,
  })

  const footerNav = [
    ...nav.map(([id, label]) => `<li><a href="#${id}">${esc(label)}</a></li>`),
    `<li><a href="brief.html">One-page brief</a></li>`,
    ...footer.links.map((link) => `<li><a href="${esc(link.url)}">${inline(link.label)}</a></li>`),
  ].join("")

  const themeKey = `${slugOf(pkg.name)}-theme`
  const og = site.ogImage
    ? `<meta property="og:image" content="${esc(site.siteUrl)}${esc(site.ogImage)}" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content="${esc(site.siteUrl)}${esc(site.ogImage)}" />`
    : `<meta name="twitter:card" content="summary" />`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script>
;(function () {
  var KEY = ${JSON.stringify(themeKey)}
  try {
    var stored = window.localStorage.getItem(KEY)
    var isDark = stored === "dark" ? true : stored === "light" ? false : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light")
    document.documentElement.setAttribute("data-theme-key", KEY)
  } catch (error) {}
})()
</script>
<title>${esc(site.title)}</title>
<meta name="description" content="${esc(site.description)}" />
<link rel="canonical" href="${esc(site.siteUrl)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${esc(site.siteUrl)}" />
<meta property="og:title" content="${esc(site.title)}" />
<meta property="og:description" content="${esc(site.description)}" />
<meta name="twitter:title" content="${esc(site.title)}" />
<meta name="twitter:description" content="${esc(site.description)}" />
${og}
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="icon" href="favicon.png" type="image/png" sizes="48x48" />
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="container"><a class="site-logo" href="#top">${esc(pkg.name)}</a><nav class="primary-nav" id="primary-nav" aria-label="Primary"><ul class="primary-nav-list">${nav.map(([id, label]) => `<li><a href="#${id}">${esc(label)}</a></li>`).join("")}</ul></nav><div class="header-actions"><button class="icon-button" type="button" id="theme-toggle" aria-pressed="false"><span aria-hidden="true" class="theme-toggle-icon">◐</span><span class="sr-only">Toggle dark mode</span></button><a class="github-link" href="${esc(site.repoUrl)}">GitHub ↗</a><button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav">Menu</button></div></div></header>
<main id="main">
${heroSection}
${problemSection}
${modelSection}
${demoSection}
${guaranteeSection}
${comparisonSection}
${adoptionSection}
${briefSection}
${proofSection}
${fitSection}
</main>
<footer class="site-footer"><div class="container footer-inner"><ul class="footer-nav">${footerNav}</ul><p class="footer-meta"><span>© ${esc(footer.copyright)}</span><span><a href="${esc(footer.license.url)}">${inline(footer.license.label)}</a></span></p></div></footer>
<div class="sr-only" role="status" aria-live="polite" id="copy-status"></div>
<script src="script.js"></script>
</body>
</html>
`
}

/**
 * @param {Record<string, any>} site - validated content.
 * @param {{ name: string, version: string, license?: string }} pkg
 * @returns {string} the one-page brief a developer can hand to a manager: plain language, fixed order, printable.
 */
export function renderBrief(site, pkg) {
  const { brief, cta } = site
  const risks = [
    ...(isPreOne(pkg.version) && site.maturity ? [site.maturity] : []),
    ...brief.whatCouldGoWrong,
  ]
  const block = (title, content) =>
    `<section class="brief-block"><h2>${esc(title)}</h2>${content}</section>`
  const list = (items) => `<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(pkg.name)}: a one-page brief</title>
<meta name="description" content="${esc(brief.oneLine)}" />
<link rel="canonical" href="${esc(site.siteUrl)}brief.html" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="styles.css" />
</head>
<body class="brief-page">
<a class="skip-link" href="#main">Skip to content</a>
<main id="main" class="brief">
<p class="brief-back"><a href="index.html">&larr; ${esc(pkg.name)}</a></p>
<h1>${esc(pkg.name)}: a one-page brief</h1>
<p class="brief-oneline">${inline(brief.oneLine)}</p>
${block("The problem", `<p>${inline(brief.problem)}</p>`)}
${block("What it does", `<p>${inline(brief.whatItDoes)}</p>`)}
${block("Why it matters", list(brief.whyItMatters))}
${block("What it costs", `<p>${inline(brief.whatItCosts)}</p>`)}
${block("What could go wrong", list(risks))}
${block("What we are asking for", `<p>${inline(brief.whatWeAsk)}</p>`)}
<p class="brief-next">To judge it yourself: <a href="${esc(cta.primary.url)}">${inline(cta.primary.label)}</a> · <a href="${esc(cta.secondary.url)}">${inline(cta.secondary.label)}</a></p>
<p class="brief-print">Print this page or save it as a PDF to share.</p>
</main>
</body>
</html>
`
}
