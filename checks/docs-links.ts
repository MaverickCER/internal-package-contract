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
import { packageRoot, parseToolEnvelope } from "./shared.js"

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

    const envelope = parseToolEnvelope<ToolResult<LinkinatorReport>>(
      result,
      "linkinator",
      "Docs (links): linkinator",
    )
    if (!envelope.ok) return envelope.result

    const evidence = envelope.value
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
      // Stryker disable Regex: two of this line's mutants are equivalent, hand-verified (one at a
      // time, every test in docs-links.test.ts still passes unchanged) -- Stryker's per-line
      // disable can't separate them from a third, genuinely-killable mutant on this same regex
      // literal (dropping the leading `^` anchor from `/^\.?\//`, covered by the "strips only a
      // LEADING './' or '/'" test above), so that one loses its mutation-score credit too:
      //  - dropping the `$` anchor from `/[#?].*$/` is unobservable for any url this check will
      //    ever see -- a url with no embedded newline (every realistic and every currently-tested
      //    url) makes `.*` already greedy-consume to the true end of the string, so `$` never adds
      //    a constraint; an embedded newline does make the two diverge, but in that case BOTH
      //    variants leave a stray "\n" attached to `rel`, which can never match a real on-disk
      //    filename either way -- `existsLocally` can't tell them apart from either side.
      //  - `path.join` (below) already normalizes away a leading "/" whether or not `/^\.?\//`
      //    actually stripped it (`path.join(cwd, "/x")` === `path.join(cwd, "x")`), so relaxing
      //    the optional-dot requirement in `/^\.?\//` to mandatory (`/^\.\//`) can never change
      //    what `existsSync` resolves.
      const rel = decodeURIComponent(url.replace(/[#?].*$/, "")).replace(/^\.?\//, "")
      // Stryker restore Regex
      return rel.length > 0 && existsSync(path.join(process.cwd(), rel))
    }
    const broken = links.filter((l) => l.state === "BROKEN" && !existsLocally(l.url))
    const brokenLocal = broken.filter((l) => !isExternal(l.url))
    // Stryker disable next-line MethodExpression: an equivalent mutant -- this line only ever
    // executes inside the `brokenLocal.length === 0` branch below, at which point `broken` is
    // ALREADY entirely external links by construction (`brokenLocal`/`brokenExternal` partition
    // `broken` by `isExternal`, and the local partition being empty means nothing was excluded
    // from the external one), so `broken.filter(isExternal)` and `broken` are content-identical
    // whenever this value is actually read. Hand-verified: forcing this to `broken` (dropping the
    // filter) leaves every test in docs-links.test.ts passing unchanged.
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
