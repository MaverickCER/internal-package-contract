// Entry point for the `Accessibility` check (see contract.ts). Runs pa11y
// (WCAG2AA, its default standard) against a consumer's own built docs
// site and prints a `{ ok, value | error }` result to stdout, matching the
// file-based-tool-output pattern the docs/markdownlint checks already use.
// pa11y drives a real headless Chromium page via puppeteer -- an actual
// accessibility tree, not static markup analysis -- so contrast, focus
// order, and ARIA issues are caught the same way a real browser would
// surface them.
//
// A near-direct port of repo-contract's own scripts/check-accessibility.mjs
// (see specs/decisions/0008-self-hosting-tool-and-dependency-choices.md
// there for why pa11y was chosen), generalized to run against WHICHEVER
// package installs this: every page path below is resolved against
// process.cwd() (the consumer's own repo root -- every check here runs with
// that cwd, same as docs-links.ts/docs-markdown.ts), not against this
// script's own on-disk location the way repo-contract's self-hosted
// original resolves against __dirname.
//
// Tests each page directly via a file:// URL -- none has a build step
// beyond what already produced it, so nothing needs to run first here.
//
// PAGES covers the shared page shell/template mechanically, not every
// generated page individually: docs/index.html (the site), plus, once the
// consumer's own docs/api/ HTML API reference has been generated (release-
// cadence only -- normal for it to be absent between releases), its
// index.html landing page.
//
// repo-contract's own original script additionally scans one representative
// page containing a real <table> (its API-doc tool emits raw, uncaptioned
// <table> markup -- a real accessibility risk). That case doesn't transfer
// here: both env-cap and data-cap generate their HTML API reference with
// typedoc, whose default theme renders symbol members as <dl>/<div
// class="tsd-*"> structures, not <table> elements at all (confirmed: zero
// <table> matches anywhere under a real generated docs/api/ tree). Scanning
// the landing page is enough to cover the shared template/theme every
// generated page reuses; add a representative-page entry back here if a
// future API-doc tool (or typedoc theme) starts emitting raw tables.

import pa11y from "pa11y"
import { access } from "node:fs/promises"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = process.cwd()
const docsApiDir = join(repoRoot, "docs", "api")

const MAIN_SITE_PAGE = join(repoRoot, "docs", "index.html")
const API_LANDING_PAGE = join(docsApiDir, "index.html")

const CHROME_LAUNCH_CONFIG = {
  // Chromium's own sandbox needs kernel unprivileged-user-namespace
  // support, which a GitHub Actions runner's AppArmor profile restricts --
  // without these flags the bundled Chromium exits immediately on launch
  // and pa11y produces no report at all. Safe here: every page this check
  // ever loads is the consumer's own static, committed HTML over a
  // file:// URL, never untrusted content.
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolves which pages to scan: docs/index.html only when it exists (not every
 * consumer has built a site yet); docs/api/index.html additionally, only once
 * docs/api/ has actually been generated in this working tree -- but once that
 * directory exists, the landing page must too, or this throws naming exactly
 * what's missing, rather than silently scanning fewer pages.
 * @returns Absolute paths of every page to scan.
 */
async function resolvePages() {
  const pages = []
  if (await pathExists(MAIN_SITE_PAGE)) pages.push(MAIN_SITE_PAGE)
  if (!(await pathExists(docsApiDir))) return pages

  if (!(await pathExists(API_LANDING_PAGE))) {
    throw new Error(
      `docs/api/ exists but the expected landing page ${API_LANDING_PAGE} does not -- check the API-doc generator's own output configuration.`,
    )
  }
  pages.push(API_LANDING_PAGE)
  return pages
}

try {
  const existingPages = await resolvePages()

  const perPage = await Promise.all(
    existingPages.map(async (path) => {
      const result = await pa11y(pathToFileURL(path).href, {
        chromeLaunchConfig: CHROME_LAUNCH_CONFIG,
      })
      // Attach the repo-relative page path to every issue -- with more than one page scanned, a
      // finding's rationale has to say which page it is on to be actionable.
      const page = relative(repoRoot, path)
      return result.issues.map((issue) => ({ ...issue, page }))
    }),
  )

  process.stdout.write(JSON.stringify({ ok: true, value: perPage.flat() }))
  process.exitCode = 0
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exitCode = 1
}
