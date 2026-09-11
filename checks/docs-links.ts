/**
 * Broken-link detection across a consumer's docs, via linkinator -- both the
 * Markdown link graph reachable from `README.md`, and a second, HTML-mode
 * crawl over `docs/` (the site itself, and `docs/api/**` once generated).
 * Both crawls run through the bundled `scripts/check-docs-links.mjs` (see its
 * own doc comment for exactly why two separate crawls, not one).
 *
 * Differences from the `brokenLinks` preset, all forced by linkinator quirks:
 *   - the Markdown crawl starts at `README.md` and `--recurse`s the relative-
 *     link graph -- its directory-recurse mode only follows `index.html`,
 *     never loose `.md` files -- with `--markdown` explicit (linkinator
 *     silently stops parsing markdown when `--format json` is set otherwise);
 *   - the HTML crawl starts at `docs` and `--recurse`s the same way, with no
 *     `--markdown` flag;
 *   - external (`http(s)://`) links are filtered in this policy, not via
 *     linkinator's `--skip` (whose regex handling zeroes the whole crawl for
 *     several common patterns). External link rot is best-effort, not a
 *     release gate; a broken *local* link is always blocking.
 *   - a local link that resolves to an existing file OR directory on disk is
 *     not counted broken -- linkinator 404s a bare directory link (`specs/`)
 *     that a git host (GitHub, GitLab) renders fine.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, packageRoot } from "./shared.js"

const docsLinksScript = path.join(packageRoot, "scripts", "check-docs-links.mjs")

interface LinkinatorLink {
  readonly url: string
  readonly status?: number
  readonly state: "OK" | "BROKEN" | "SKIPPED"
  readonly parent?: string
}
interface LinkinatorReport {
  readonly links?: readonly LinkinatorLink[]
}
type ToolResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export const docsLinks: CheckDefinitionConfig = {
  run: ["node", docsLinksScript],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    const hasReadme = existsSync(path.join(process.cwd(), "README.md"))
    const hasDocsSite = existsSync(path.join(process.cwd(), "docs", "index.html"))
    if (!hasReadme && !hasDocsSite) {
      return { outcome: "pass", rationale: "Docs (links): no README.md or docs/index.html." }
    }

    const terminated = abnormalTermination(result, "linkinator")
    if (terminated) return { outcome: "fail", rationale: terminated }

    const parsed: unknown = result.output?.success ? result.output.value : undefined
    if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
      const printed = combinedOutput(result)
      return {
        outcome: "fail",
        rationale: `Docs (links): linkinator output could not be parsed as JSON.${printed ? `\n${printed}` : ""}`,
      }
    }

    const evidence = parsed as ToolResult<LinkinatorReport>
    if (!evidence.ok) {
      return {
        outcome: "fail",
        rationale: `Docs (links): linkinator could not be evaluated: ${evidence.error}`,
      }
    }

    const value = evidence.value
    if (!value || !Array.isArray(value.links)) {
      return { outcome: "fail", rationale: "Docs (links): linkinator produced invalid JSON." }
    }

    const links: readonly LinkinatorLink[] = value.links
    const isExternal = (url: string): boolean => /^https?:\/\//i.test(url)
    // linkinator reports a bare directory link (`specs/decisions/`) as a 404
    // even though every git host renders it. Treat any local link that exists
    // on disk (file or dir) -- stripping a `#anchor`/`?query` -- as fine.
    const existsLocally = (url: string): boolean => {
      const rel = decodeURIComponent(url.replace(/[#?].*$/, "")).replace(/^\.?\//, "")
      return rel.length > 0 && existsSync(path.join(process.cwd(), rel))
    }
    const broken = links.filter((l) => l.state === "BROKEN" && !existsLocally(l.url))
    const brokenLocal = broken.filter((l) => !isExternal(l.url))
    const brokenExternal = broken.filter((l) => isExternal(l.url))

    if (brokenLocal.length === 0) {
      const note =
        brokenExternal.length > 0
          ? ` (${String(brokenExternal.length)} external link(s) also unreachable -- not blocking)`
          : ""
      return {
        outcome: brokenExternal.length > 0 ? "warn" : "pass",
        rationale: `Docs (links): 0 broken local link(s) across ${String(links.length)} checked${note}.`,
      }
    }

    return {
      outcome: "fail",
      rationale: [
        `Docs (links): ${String(brokenLocal.length)} broken local link(s):`,
        ...brokenLocal.map(
          (l) =>
            `- ${l.url}${l.parent ? ` (from ${l.parent})` : ""} -- HTTP ${String(l.status ?? "?")}`,
        ),
      ].join("\n"),
    }
  },
}
