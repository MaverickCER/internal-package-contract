// Entry point for the `DocsLinks` check (see checks/docs-links.ts). Runs two separate linkinator crawls and
// prints their combined `links` as one JSON envelope: `{ ok: true, value: { links } }`, or `{ ok: false,
// error }` with a non-zero exit when linkinator could not run or printed no JSON. The policy decides the
// verdict.
//
// The first crawl starts at README.md in Markdown mode and follows its relative links. The second starts
// at docs/ in HTML mode and descends into the site, including docs/api/** once generated, because the
// Markdown crawl never reaches a link written in the site's own markup. Each crawl runs only when its
// start file exists. The flags both crawls share are in scripts/docs-links-args.mjs.
//
// Every path is resolved against the working directory, the consumer's repository. The PATH shim at the
// top lets `linkinator` resolve when this package is installed as a symlink and not hoisted; the contract
// runner adds the same directories, and the shim repeats it so the script also runs on its own.

import { linkinatorArgs } from "./docs-links-args.mjs"
import { sync as spawnSync } from "cross-spawn"
import { existsSync } from "node:fs"
import path from "node:path"

// Put every node_modules/.bin between this script and the filesystem root on
// PATH, so `linkinator` resolves whether this package is symlinked (`file:`
// dep, not hoisted) or installed normally. It is the same shim scripts/run-attw.mjs
// uses. It is repeated here so this script also works when invoked directly rather
// than only through bin/contract.mjs. That one already applies it, but a
// child process re-deriving its own PATH here costs nothing and doesn't rely
// on that ordering.
for (let dir = import.meta.dirname; ;) {
  const bin = path.join(dir, "node_modules", ".bin")
  if (existsSync(bin)) process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`
  const parent = path.dirname(dir)
  if (parent === dir) break
  dir = parent
}

function runLinkinator(args) {
  const result = spawnSync("linkinator", linkinatorArgs(args), {
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

// `--recurse`: by default linkinator crawls only the given start file. Without
// it, this would check docs/index.html alone and never reach the generated
// docs/api/**.
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
