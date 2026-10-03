// Entry point for the `Accessibility` check (see contract.ts). Runs pa11y
// (WCAG2AA, its default standard) against a consumer's own built docs
// site and prints a `{ ok, value | error }` result to stdout, matching the
// file-based-tool-output pattern the docs/markdownlint checks already use.
// pa11y drives a real headless Chrome page -- an actual accessibility tree,
// not static markup analysis -- so contrast, focus order, and ARIA issues
// are caught the same way a real browser would surface them.
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
// `pa11y`/`puppeteer` are real, hard `dependencies` of this package (never
// something a consumer -- env-cap, data-cap, ... -- has to separately
// install), but the real `puppeteer` package carries its own
// Chromium-download `postinstall` script, which this organization's public
// packages must ship with zero install scripts of any kind (a Socket.dev
// "Install scripts" finding directly hurts a package's own supply-chain
// score). package.json's own `overrides` field aliases `puppeteer` to
// `puppeteer-core` wherever pa11y itself resolves it -- pa11y's `require
// ("puppeteer")` transparently gets puppeteer-core's identical launch API,
// with no bundled browser and, critically, no install script at all.
// `findChromeExecutable` below supplies the browser puppeteer-core no
// longer downloads: a system Chrome/Chromium, auto-detected the same way a
// developer's own machine or a CI runner already has one (GitHub Actions'
// own `ubuntu-latest` images ship Google Chrome preinstalled).
//
// Tests each page directly via a file:// URL -- none has a build step
// beyond what already produced it, so nothing needs to run first here.
//
// Which pages are scanned is decided by accessibility-pages.mjs: every top-level docs page and every
// section's landing page (the site, the API reference, the benchmark history), plus one representative
// page per kind of generated API page. Two runners check each: HTML_CodeSniffer and axe-core, which
// disagree about real problems (axe finds contrast and keyboard-focus failures HTML_CodeSniffer
// misses, and measured 0-213 violations per page where HTML_CodeSniffer reported none).

import pa11y from "pa11y"
import { sync as spawnSync } from "cross-spawn"
import { access } from "node:fs/promises"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { resolvePages } from "./accessibility-pages.mjs"

const repoRoot = process.cwd()
const docsDir = join(repoRoot, "docs")

// Every well-known system Chrome/Chromium install location this check knows to look for, in
// priority order, per platform -- checked only if `PUPPETEER_EXECUTABLE_PATH`/`CHROME_PATH`
// (an explicit override) isn't already set. Covers GitHub Actions' own `ubuntu-latest` runner
// image (ships Google Chrome preinstalled) and the common macOS/Linux developer-machine defaults.
const CANDIDATE_EXECUTABLE_PATHS = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
}

// A last-resort PATH lookup for a handful of common binary names -- covers a Chromium installed
// under a name/location this check's own candidate list doesn't happen to enumerate.
const PATH_LOOKUP_NAMES = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"]

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Finds a real, usable Chrome/Chromium executable on this machine -- `puppeteer-core` (see this
 * module's own doc comment for why it's used in place of real `puppeteer`) bundles no browser of
 * its own and requires one to be supplied explicitly.
 * @returns The executable's absolute path, or `undefined` if none could be found.
 */
async function findChromeExecutable() {
  const override = process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH
  if (override && (await pathExists(override))) return override

  const candidates = CANDIDATE_EXECUTABLE_PATHS[process.platform] ?? []
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }

  for (const name of PATH_LOOKUP_NAMES) {
    const which = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
      encoding: "utf8",
    })
    const found = which.stdout?.split("\n")[0]?.trim()
    if (which.status === 0 && found) return found
  }

  return undefined
}

try {
  const executablePath = await findChromeExecutable()
  if (executablePath === undefined) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error:
          "no system Chrome/Chromium executable found. Install one, or set PUPPETEER_EXECUTABLE_PATH.",
      }),
    )
    process.exitCode = 0
  } else {
    const chromeLaunchConfig = {
      executablePath,
      // Chromium's own sandbox needs kernel unprivileged-user-namespace support, which a GitHub
      // Actions runner's AppArmor profile restricts -- without these flags Chrome exits
      // immediately on launch and pa11y produces no report at all. Safe here: every page this
      // check ever loads is the consumer's own static, committed HTML over a file:// URL, never
      // untrusted content.
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }

    const existingPages = await resolvePages(docsDir)

    const perPage = await Promise.all(
      existingPages.map(async (path) => {
        const result = await pa11y(pathToFileURL(path).href, {
          chromeLaunchConfig,
          runners: ["axe", "htmlcs"],
        })
        // Attach the repo-relative page path to every issue -- with more than one page scanned,
        // a finding's rationale has to say which page it is on to be actionable.
        const page = relative(repoRoot, path)
        return result.issues.map((issue) => ({ ...issue, page }))
      }),
    )

    // `pagesScanned` lets the policy tell a genuine "0 issues across N pages" pass apart from
    // "0 pages existed to scan" (no built docs site at all) -- both produce an empty `value`
    // array otherwise, and only the first is actually a clean pass. See resolvePages() above.
    process.stdout.write(
      JSON.stringify({ ok: true, value: perPage.flat(), pagesScanned: existingPages.length }),
    )
    process.exitCode = 0
  }
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  )
  process.exitCode = 1
}
