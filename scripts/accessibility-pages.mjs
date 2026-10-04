// Which pages the `Accessibility` check scans.
//
// Scanning only the landing pages said nothing about the pages most likely to fail -- the generated
// benchmark history (charts), and each kind of API reference page -- so a clean run was not evidence
// of a conforming site. This picks, from whatever a repository has built under `docs/`:
//
//   - every top-level `docs/*.html` and every `docs/<dir>/index.html` (the site, the API landing page,
//     the benchmark history, any other section's landing page);
//   - ONE representative page from each subdirectory of `docs/api/` (TypeDoc renders every symbol of a
//     kind with the same template: its classes/, functions/, interfaces/ ... pages share one structure,
//     so one of each covers the template without scanning thousands of near-identical files).
//
// Capped, so a pathological tree cannot make the check run for an hour.

import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

/** The most pages ever scanned in one run. */
export const MAX_PAGES = 40

/** @param {string} path @returns {Promise<boolean>} */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** @param {string} dir @returns {Promise<string[]>} entry names, sorted; empty when unreadable. */
async function list(dir) {
  try {
    return (await readdir(dir)).sort()
  } catch {
    return []
  }
}

/**
 * @param {string} docsDir - the repository's `docs` directory.
 * @returns {Promise<string[]>} absolute paths of the pages to scan.
 * @throws {Error} when `docs/api/` exists but has no landing page (the generator's output is broken).
 */
export async function resolvePages(docsDir) {
  const pages = []
  const entries = await list(docsDir)
  for (const entry of entries) {
    const full = join(docsDir, entry)
    if (entry.endsWith(".html")) pages.push(full)
    else if (await isDirectory(full)) {
      const landing = join(full, "index.html")
      if ((await list(full)).includes("index.html")) pages.push(landing)
    }
  }

  const apiDir = join(docsDir, "api")
  if (await isDirectory(apiDir)) {
    if (!pages.includes(join(apiDir, "index.html"))) {
      throw new Error(
        `docs/api/ exists but the expected landing page ${join(apiDir, "index.html")} does not -- check the API-doc generator's own output configuration.`,
      )
    }
    for (const kind of await list(apiDir)) {
      // A page directly under api/ (the module index, say) is its own template.
      if (kind.endsWith(".html")) pages.push(join(apiDir, kind))
      const kindDir = join(apiDir, kind)
      if (!(await isDirectory(kindDir))) continue
      const names = (await list(kindDir)).filter((name) => name.endsWith(".html"))
      const first = names.find((name) => name !== "index.html") ?? names[0]
      if (first !== undefined) pages.push(join(kindDir, first))
    }
  }
  return [...new Set(pages)].slice(0, MAX_PAGES)
}
