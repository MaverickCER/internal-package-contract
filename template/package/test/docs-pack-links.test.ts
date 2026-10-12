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
    // stderr stays visible so a failing `npm pack` explains itself.
    stdio: ["ignore", "pipe", "inherit"],
    // npm colours its JSON when the runner forces colour on, which is not parseable.
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      npm_config_color: "false",
      npm_config_ignore_scripts: "true",
    },
  })
  // Whatever else printed first (a lifecycle script, a notice), the report is the last JSON array.
  const start = output.lastIndexOf("\n[\n")
  const [result] = JSON.parse(start === -1 ? output : output.slice(start + 1)) as PackResult[]
  return (result?.files ?? []).map((file) => file.path)
}

/** The link target with percent-encoding decoded, or `undefined` when the encoding is malformed. */
function decodeTarget(target: string): string | undefined {
  try {
    return decodeURI(target)
  } catch {
    return undefined
  }
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)|^ {0,3}\[[^\]]+\]:\s*(\S+)/g

/** Relative link targets (anchor stripped) with the 1-based line they appear on; code fences are skipped. */
function relativeLinks(markdown: string): { line: number; target: string }[] {
  const links: { line: number; target: string }[] = []
  // CommonMark: a fence opens with three or more backticks or tildes and closes only with the same
  // character, at least as many of them, and nothing else on the line.
  let fence: { char: string; length: number } | undefined
  markdown.split("\n").forEach((text, index) => {
    const [, opener = "", info = ""] = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(text) ?? []
    if (fence !== undefined) {
      const closes =
        opener !== "" &&
        opener.startsWith(fence.char) &&
        opener.length >= fence.length &&
        info.trim() === ""
      if (closes) fence = undefined
      return
    }
    if (opener !== "") {
      fence = { char: opener.slice(0, 1), length: opener.length }
      return
    }
    for (const match of text.matchAll(LINK)) {
      const target = (match[1] ?? match[2] ?? "").split("#")[0] ?? ""
      if (target === "" || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue
      links.push({ line: index + 1, target })
    }
  })
  return links
}

describe("decodeTarget", () => {
  it("decodes valid percent-encoding and refuses a malformed sequence", () => {
    expect(decodeTarget("./a%20b.md")).toBe("./a b.md")
    expect(decodeTarget("./%E0%A4%A.md")).toBeUndefined()
  })
})

describe("relativeLinks", () => {
  it("skips links inside backtick and tilde fences, honouring the opening length", () => {
    const markdown = [
      "[a](./a.md)",
      "````md",
      "```",
      "[inner](./inner.md)",
      "```",
      "[still inside](./inside.md)",
      "````",
      "~~~",
      "[tilde](./tilde.md)",
      "~~~",
      "[b](./b.md)",
    ].join("\n")
    expect(relativeLinks(markdown)).toEqual([
      { line: 1, target: "./a.md" },
      { line: 11, target: "./b.md" },
    ])
  })
  it("does not close a fence on a different character or on a line with text after the marker", () => {
    const markdown = ["```", "~~~", "``` text", "[x](./x.md)", "```", "[y](./y.md)"].join("\n")
    expect(relativeLinks(markdown)).toEqual([{ line: 6, target: "./y.md" }])
  })
  it("reads reference definitions indented by up to three spaces, but not four", () => {
    expect(relativeLinks("  [details]: ./missing.md")).toEqual([
      { line: 1, target: "./missing.md" },
    ])
    expect(relativeLinks("    [code]: ./code.md")).toEqual([])
  })
})

describe("published documentation links", () => {
  const published = publishedFiles()
  const documents = published.filter((file) => file.endsWith(".md"))

  it("publishes a meaningful number of documents", () => {
    expect(documents).toContain("README.md")
    expect(documents.length).toBeGreaterThan(20)
  })

  it("publishes Markdown only from the folders meant to ship documentation", () => {
    const unexpected = documents.filter(
      (file) =>
        !file.startsWith("node_modules/") &&
        !/^(?:[^/]+\.md|(?:specs|skills|benchmarks|docs\/api-report)\/.+\.md|examples\/README\.md)$/.test(
          file,
        ),
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
        const decoded = decodeTarget(target)
        if (decoded === undefined) {
          offenders.push(`${file}:${String(line)}: ${target} (malformed percent-encoding)`)
          continue
        }
        const resolved = path.posix
          .normalize(path.posix.join(path.posix.dirname(file), decoded))
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
