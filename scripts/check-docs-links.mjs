// Entry point for the `DocsLinks` check (see checks/docs-links.ts). Runs two
// independent linkinator crawls -- the README's Markdown link graph, and a
// second, HTML-mode crawl over the consumer's own docs/ site -- and prints
// their combined `links` array as one JSON object to stdout.
//
// The second crawl closes a real, confirmed gap: the Markdown-only crawl
// never covers docs/index.html's own HTML link graph at all (a broken link
// added directly to the site's markup previously went uncaught). Modeled on
// repo-contract's own scripts/check-docs.mjs, which runs the same two crawls
// for the identical reason.
//
// Every path here is resolved relative to process.cwd() -- the consumer's
// own repo root, same as every other check in this package.

import { sync as spawnSync } from "cross-spawn"
import { existsSync } from "node:fs"
import path from "node:path"

// Put every node_modules/.bin between this script and the filesystem root on
// PATH, so `linkinator` resolves whether this package is symlinked (`file:`
// dep, not hoisted) or installed normally -- same shim scripts/run-attw.mjs
// uses, repeated here so this script also works when invoked directly rather
// than only through bin/contract.mjs (which already applies it once, but a
// child process re-deriving its own PATH here costs nothing and doesn't rely
// on that ordering).
for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

function runLinkinator(args) {
  const result = spawnSync("linkinator", [...args, "--retry", "--format", "json"], {
    encoding: "utf8",
  })
  if (result.error) {
    return { ok: false, error: result.error.message }
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) }
  } catch (error) {
    return { ok: false, error: `linkinator did not produce valid JSON: ${error.message}` }
  }
}

const crawls = []

if (existsSync(path.join(process.cwd(), "README.md"))) {
  crawls.push(runLinkinator(["README.md", "--recurse", "--markdown"]))
}

// --recurse: linkinator's default is "crawl only the given start file" --
// without it, this would check docs/index.html alone and never descend into
// docs/api/** once that's been generated.
if (existsSync(path.join(process.cwd(), "docs", "index.html"))) {
  crawls.push(runLinkinator(["docs", "--recurse"]))
}

const failed = crawls.find((c) => !c.ok)
if (failed) {
  process.stdout.write(JSON.stringify(failed))
  process.exitCode = 1
} else {
  const links = crawls.flatMap((c) => c.value.links ?? [])
  process.stdout.write(JSON.stringify({ ok: true, value: { links } }))
  process.exitCode = 0
}
