// Checks a package's landing-page content (docs/site.json) against the quality bar every MaverickCER site
// meets. The bar is mechanical on purpose: it cannot judge whether copy is good, but it can refuse the
// failures that make a page useless to a decision-maker -- a missing organizational outcome, a guarantee
// with no stated scope, a pre-1.0 package that does not say so, a manager's brief nobody could read.

const MAX_HERO_WORDS = 80
const MAX_INSTALL_COMMANDS = 3
const MAX_BRIEF_SENTENCE_WORDS = 30
const MIN_SCOPE_CHARS = 20
const PLACEHOLDER = /\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum/i

/** Required text fields, by section. */
const REQUIRED_TEXT = {
  hero: ["eyebrow", "heading", "lede", "support", "outcome"],
  install: ["label"],
  problem: ["eyebrow", "heading", "lede", "listLabel", "conclusion", "closing"],
  model: ["eyebrow", "heading", "lede", "flowDescription", "note"],
  guarantees: ["eyebrow", "heading", "lede"],
  comparison: ["eyebrow", "heading", "lede", "caption"],
  demo: ["eyebrow", "heading", "intro", "command", "output", "explanation"],
  adoption: ["eyebrow", "heading", "lede", "calloutTitle"],
  resources: ["eyebrow", "heading", "lede"],
  brief: ["heading", "oneLine", "problem", "whatItDoes", "whatItCosts", "whatWeAsk"],
  fit: ["eyebrow", "heading", "lede"],
  footer: ["copyright"],
}

/** Lists that must have at least one entry, as `section.field`. */
const REQUIRED_LISTS = [
  "problem.items",
  "model.flow",
  "comparison.rows",
  "adoption.steps",
  "resources.items",
  "brief.whyItMatters",
  "brief.whatCouldGoWrong",
]

const SECTIONS = [
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
]

/**
 * @param {string} text
 * @returns {number} the number of whitespace-separated words.
 */
export function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length
}

const isText = (value) => typeof value === "string" && value.trim() !== ""
const isLink = (url) =>
  typeof url === "string" && (/^https:\/\/\S+$/.test(url) || /^(?!\/\/)[^:\s]+$/.test(url))

/** Every `url` in the tree, as `[path, value]`. */
function* urlsIn(node, at) {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* urlsIn(item, `${at}[${String(i)}]`)
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const next = at === "" ? key : `${at}.${key}`
      if (key === "url") yield [next, value]
      else yield* urlsIn(value, next)
    }
  }
}

/** Every string in the tree, as `[path, value]`. */
function* stringsIn(node, at) {
  if (typeof node === "string") yield [at, node]
  else if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* stringsIn(item, `${at}[${String(i)}]`)
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node))
      yield* stringsIn(value, at === "" ? key : `${at}.${key}`)
  }
}

function longSentence(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(wordCount)
    .find((words) => words > MAX_BRIEF_SENTENCE_WORDS)
}

/**
 * @param {Record<string, any>} site - the parsed `docs/site.json`.
 * @param {{ name: string, version: string }} pkg - the package's own name and version.
 * @returns {string[]} every problem found, empty when the content meets the bar.
 */
export function validateSite(site, pkg) {
  const errors = []
  for (const key of ["siteUrl", "repoUrl", "title", "description"]) {
    if (!isText(site[key])) errors.push(`${key} is required.`)
  }
  for (const key of ["siteUrl", "repoUrl"]) {
    if (isText(site[key]) && !/^https:\/\/\S+$/.test(site[key]))
      errors.push(`${key} must be an https URL.`)
  }
  for (const key of SECTIONS) {
    if (!site[key]) errors.push(`${key} is required.`)
  }

  for (const [section, fields] of Object.entries(REQUIRED_TEXT)) {
    if (!site[section]) continue
    for (const field of fields) {
      if (!isText(site[section][field])) errors.push(`${section}.${field} is required.`)
    }
  }
  for (const path of REQUIRED_LISTS) {
    const [section, field] = path.split(".")
    if (!site[section]) continue
    if (!Array.isArray(site[section][field]) || site[section][field].length === 0) {
      errors.push(
        `${path} needs at least one ${field === "rows" ? "row" : field === "steps" ? "step" : "item"}.`,
      )
    }
  }

  if (site.hero && isText(site.hero.outcome)) {
    const outcome = site.hero.outcome.trim()
    if (!/[.!?]$/.test(outcome) || /[.!?]\s+\S/.test(outcome))
      errors.push("hero.outcome must be a single sentence.")
  }
  if (site.hero && isText(site.hero.lede) && isText(site.hero.support)) {
    const total = wordCount(site.hero.lede) + wordCount(site.hero.support)
    if (total > MAX_HERO_WORDS) {
      errors.push(
        `hero.lede and hero.support together are ${String(total)} words; keep them to ${String(MAX_HERO_WORDS)} or fewer.`,
      )
    }
  }

  if (site.install) {
    const commands = site.install.commands
    if (!Array.isArray(commands) || commands.length === 0)
      errors.push("install.commands needs at least one command.")
    else {
      if (commands.length > MAX_INSTALL_COMMANDS) {
        errors.push(
          `install.commands has ${String(commands.length)} commands; a quick start is at most ${String(MAX_INSTALL_COMMANDS)}.`,
        )
      }
      if (!String(commands[0]).includes(pkg.name))
        errors.push(`install.commands[0] must install "${pkg.name}".`)
    }
  }

  if (site.cta) {
    for (const key of ["primary", "secondary"]) {
      if (!site.cta[key]) errors.push(`cta.${key} is required.`)
      else if (!isText(site.cta[key].label)) errors.push(`cta.${key}.label is required.`)
    }
  }
  if (site.cta?.primary && Array.isArray(site.resources?.items)) {
    for (const [i, item] of site.resources.items.entries()) {
      if (item.url === site.cta.primary.url) {
        errors.push(
          `resources.items[${String(i)}].url repeats the primary call to action; the README is linked from the hero and the close only.`,
        )
      }
    }
  }
  if (Array.isArray(site.resources?.items)) {
    for (const [i, item] of site.resources.items.entries()) {
      for (const field of ["title", "description", "label"]) {
        if (!isText(item[field])) errors.push(`resources.items[${String(i)}].${field} is required.`)
      }
    }
  }

  if (site.guarantees) {
    const items = site.guarantees.items
    if (!Array.isArray(items) || items.length === 0)
      errors.push("guarantees.items needs at least one guarantee.")
    else {
      for (const [i, item] of items.entries()) {
        const at = `guarantees.items[${String(i)}]`
        for (const field of ["claim", "linkLabel", "url"]) {
          if (!isText(item[field])) errors.push(`${at}.${field} is required.`)
        }
        if (!isText(item.scope) || item.scope.trim().length < MIN_SCOPE_CHARS) {
          errors.push(
            `${at}.scope must say what the guarantee covers and what it does not (at least ${String(MIN_SCOPE_CHARS)} characters).`,
          )
        }
      }
    }
  }

  if (site.comparison) {
    const columns = site.comparison.columns
    if (!Array.isArray(columns) || columns.length < 2)
      errors.push("comparison.columns needs at least 2 columns.")
    else if (Array.isArray(site.comparison.rows)) {
      for (const [i, row] of site.comparison.rows.entries()) {
        if (!Array.isArray(row) || row.length !== columns.length) {
          const cells = Array.isArray(row) ? row.length : 0
          errors.push(
            `comparison.rows[${String(i)}] has ${String(cells)} cells; expected ${String(columns.length)}, one per column.`,
          )
        }
      }
    }
  }

  if (site.adoption?.notFor) {
    for (const field of ["title", "text"]) {
      if (!isText(site.adoption.notFor[field])) errors.push(`adoption.notFor.${field} is required.`)
    }
  }

  if (site.demo) {
    if (!site.demo.source) errors.push("demo.source is required.")
    else
      for (const field of ["label", "url"])
        if (!isText(site.demo.source[field])) errors.push(`demo.source.${field} is required.`)
  }

  const major = /^(\d+)\./.exec(String(pkg.version))
  if ((major === null || Number(major[1]) === 0) && !isText(site.maturity)) {
    errors.push(
      `maturity is required while the package is below 1.0.0 (version ${String(pkg.version)}).`,
    )
  }

  if (site.brief) {
    for (const key of ["oneLine", "problem", "whatItDoes", "whatItCosts", "whatWeAsk"]) {
      const words = isText(site.brief[key]) ? longSentence(site.brief[key]) : undefined
      if (words !== undefined)
        errors.push(
          `brief.${key} has a sentence of ${String(words)} words; keep each to ${String(MAX_BRIEF_SENTENCE_WORDS)} or fewer so a non-specialist can read it.`,
        )
    }
    for (const key of ["whyItMatters", "whatCouldGoWrong"]) {
      for (const [i, text] of (Array.isArray(site.brief[key]) ? site.brief[key] : []).entries()) {
        const words = isText(text) ? longSentence(text) : undefined
        if (words !== undefined)
          errors.push(
            `brief.${key}[${String(i)}] has a sentence of ${String(words)} words; keep each to ${String(MAX_BRIEF_SENTENCE_WORDS)} or fewer so a non-specialist can read it.`,
          )
      }
    }
  }

  for (const [path, url] of urlsIn(site, "")) {
    if (!isLink(url)) errors.push(`${path} must be an https URL or a relative path.`)
  }
  for (const [path, text] of stringsIn(site, "")) {
    const match = PLACEHOLDER.exec(text)
    if (match) errors.push(`${path} contains placeholder text ("${match[0]}").`)
  }
  return errors
}
