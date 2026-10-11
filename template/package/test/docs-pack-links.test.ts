import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The README and every document it links to are read from `node_modules`, from the published tarball and
 * from offline mirrors, where the repository does not exist. A relative link therefore only works when its
 * target is itself in the published package. A link to anything that is not published (source, tests,
 * examples, workflows) must be an absolute URL.
 */
const root = path.resolve(import.meta.dirname, "..")

interface PackResult {
  files: { path: string }[]
}

function publishedFiles(): string[] {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  })
  const [result] = JSON.parse(output) as PackResult[]
  return (result?.files ?? []).map((file) => file.path)
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|^\[[^\]]+\]:\s*(\S+)/g

/** Relative link targets (anchor stripped) with the 1-based line they appear on; code fences are skipped. */
function relativeLinks(markdown: string): { line: number; target: string }[] {
  const links: { line: number; target: string }[] = []
  let inFence = false
  markdown.split("\n").forEach((text, index) => {
    if (/^\s*```/.test(text)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    for (const match of text.matchAll(LINK)) {
      const target = (match[1] ?? match[2] ?? "").split("#")[0] ?? ""
      if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue
      links.push({ line: index + 1, target })
    }
  })
  return links
}

describe("published documentation links", () => {
  const published = publishedFiles()
  const documents = published.filter((file) => file.endsWith(".md"))

  it("publishes a meaningful number of documents", () => {
    expect(documents).toContain("README.md")
    expect(documents.length).toBeGreaterThan(5)
  })

  it("publishes Markdown only from the folders meant to ship documentation", () => {
    const unexpected = documents.filter(
      (file) =>
        !file.startsWith("node_modules/") &&
        !/^(?:[^/]+\.md|(?:specs|skills|benchmarks|examples|docs\/api-report)\/.+\.md)$/.test(file),
    )
    expect(
      unexpected,
      "Markdown outside the documentation folders, such as a generated file",
    ).toEqual([])
  })

  it("only links, by relative path, to files that are published", () => {
    const offenders: string[] = []
    for (const file of documents) {
      for (const { line, target } of relativeLinks(readFileSync(path.join(root, file), "utf8"))) {
        const resolved = path.posix
          .normalize(path.posix.join(path.posix.dirname(file), decodeURI(target)))
          .replace(/\/$/, "")
        const found =
          published.includes(resolved) ||
          published.some((entry) => entry.startsWith(`${resolved}/`))
        if (!found) offenders.push(`${file}:${String(line)}: ${target}`)
      }
    }
    expect(
      offenders,
      "relative links to unpublished files; publish the target or use an absolute URL",
    ).toEqual([])
  })
})
