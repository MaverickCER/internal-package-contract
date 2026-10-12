import { describe, expect, it } from "vitest"
import {
  MAX_LINES,
  REQUIRED_BADGES,
  REQUIRED_SECTIONS,
  validateReadme,
} from "../scripts/readme/validate.mjs"

const BADGES = [
  "[![CI](https://github.com/o/p/actions/workflows/ci.yml/badge.svg)](x)",
  "[![npm](https://img.shields.io/npm/v/p.svg)](x)",
  "[![Coverage](https://img.shields.io/endpoint?url=https://o.github.io/p/coverage-badge.json)](x)",
  "[![Mutation](https://img.shields.io/endpoint?url=https://o.github.io/p/mutation-badge.json)](x)",
  "[![Scorecard](https://api.scorecard.dev/projects/github.com/o/p/badge)](x)",
  "[![Socket Badge](https://badge.socket.dev/npm/package/p/latest)](x)",
  "[![License](https://img.shields.io/npm/l/p.svg)](LICENSE)",
]

/** A README that meets the layout, assembled so each test can break one thing. */
function readme({
  sections = REQUIRED_SECTIONS,
  badges = BADGES,
  seeItRun = true,
  nextSteps = "- **Evaluate:** a\n- **Integrate:** b\n- **Verify:** c",
  title = "# p",
  extra = "",
}: {
  sections?: readonly string[]
  badges?: readonly string[]
  seeItRun?: boolean
  nextSteps?: string
  title?: string
  extra?: string
} = {}): string {
  const body = sections.map((name) => {
    if (name === "What it does")
      return `## ${name}\n\n${seeItRun ? "### See it run\n\nout\n" : "text\n"}`
    if (name === "Next steps") return `## ${name}\n\n${nextSteps}\n`
    return `## ${name}\n\ntext\n`
  })
  return [title, "", ...badges, "", "Tagline.", "", ...body, extra].join("\n")
}

describe("validateReadme", () => {
  it("accepts a README with every section, badge and next step", () => {
    expect(validateReadme(readme())).toEqual([])
  })
  it("names the layout, the badges and the limit it enforces", () => {
    expect(REQUIRED_SECTIONS).toHaveLength(10)
    expect(REQUIRED_BADGES.map((badge) => badge.label)).toEqual([
      "CI status",
      "npm version",
      "coverage",
      "mutation",
      "Scorecard",
      "Socket",
      "license",
    ])
    expect(MAX_LINES).toBe(220)
  })
  it("requires one title that comes first", () => {
    const message = 'README.md must open with a single "# <package name>" title.'
    expect(validateReadme(readme({ title: "text" }))).toContain(message)
    expect(validateReadme(readme({ extra: "# second" }))).toContain(message)
    expect(validateReadme(readme({ title: "## p" }))).toContain(message)
  })
  it("names each missing section", () => {
    const sections = REQUIRED_SECTIONS.filter((name) => name !== "How it differs")
    expect(validateReadme(readme({ sections }))).toEqual([
      'README.md is missing the "How it differs" section.',
    ])
  })
  it("rejects a section outside the layout and says where its content goes", () => {
    expect(validateReadme(readme({ extra: "## Roadmap\n\ntext\n" }))).toEqual([
      'README.md has a section that is not part of the standard layout: "Roadmap". Move its content into the section it belongs to, or into a guide.',
    ])
  })
  it("rejects sections out of order, listing both orders", () => {
    const [first, second, ...rest] = REQUIRED_SECTIONS
    const swapped = [second as string, first as string, ...rest]
    expect(validateReadme(readme({ sections: swapped }))).toEqual([
      `README.md sections are out of order: expected ${REQUIRED_SECTIONS.join(", ")}; found ${swapped.join(", ")}.`,
    ])
  })
  it("ignores headings inside code fences", () => {
    const fenced = readme({ extra: "```md\n## Roadmap\n# another\n```\n~~~\n## More\n~~~\n" })
    expect(validateReadme(fenced)).toEqual([])
  })
  it("requires a See it run under What it does, not elsewhere", () => {
    const message =
      'README.md must have a "### See it run" under "What it does" that shows real output.'
    expect(validateReadme(readme({ seeItRun: false }))).toEqual([message])
    const elsewhere = readme({ seeItRun: false, extra: "### See it run\n" })
    expect(validateReadme(elsewhere)).toEqual([message])
    const before = readme({ seeItRun: false }).replace(
      "## Why it exists",
      "### See it run\n\n## Why it exists",
    )
    expect(validateReadme(before)).toEqual([message])
  })
  it("names each missing badge", () => {
    expect(validateReadme(readme({ badges: BADGES.slice(1) }))).toEqual([
      "README.md is missing the CI status badge above its first section.",
    ])
    expect(validateReadme(readme({ badges: BADGES.slice(0, 6) }))).toEqual([
      "README.md is missing the license badge above its first section.",
    ])
  })
  it("requires the mutation and Scorecard badges", () => {
    const without = (needle: string) => BADGES.filter((badge) => !badge.includes(needle))
    expect(validateReadme(readme({ badges: without("mutation-badge") }))).toEqual([
      "README.md is missing the mutation badge above its first section.",
    ])
    expect(validateReadme(readme({ badges: without("scorecard.dev") }))).toEqual([
      "README.md is missing the Scorecard badge above its first section.",
    ])
  })
  it("counts only badges above the first section", () => {
    const late = readme({ badges: BADGES.slice(1) }) + `\n${BADGES[0]}\n`
    expect(validateReadme(late)).toEqual([
      "README.md is missing the CI status badge above its first section.",
    ])
  })
  it("requires each of the three next steps", () => {
    expect(validateReadme(readme({ nextSteps: "- **Evaluate:** a" }))).toEqual([
      'README.md "Next steps" must offer **Integrate:** as its own step.',
      'README.md "Next steps" must offer **Verify:** as its own step.',
    ])
  })
  it("reads the next steps only from that section", () => {
    const text = readme({ nextSteps: "- nothing" }) + "\n## Extra\n- **Evaluate:** a\n"
    expect(validateReadme(text)).toContain(
      'README.md "Next steps" must offer **Evaluate:** as its own step.',
    )
  })
  it("allows exactly the limit and rejects one line more", () => {
    const base = readme()
    const used = base.replace(/\n$/, "").split("\n").length
    const atLimit = base + "pad\n".repeat(MAX_LINES - used).replace(/\n$/, "")
    expect(atLimit.split("\n")).toHaveLength(MAX_LINES)
    expect(validateReadme(atLimit)).toEqual([])
    expect(validateReadme(`${atLimit}\npad`)).toHaveLength(1)
  })
  it("limits the length", () => {
    const long = readme({ extra: "line\n".repeat(MAX_LINES) })
    const problems = validateReadme(long)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(
      /^README\.md is \d+ lines, over the 220-line limit\. Move detail into the guides and link to it\.$/,
    )
    expect(validateReadme(readme({ extra: "line\n".repeat(150) }))).toEqual([])
  })
})

describe("validateReadme -- code fences and heading syntax", () => {
  const roadmap =
    'README.md has a section that is not part of the standard layout: "Roadmap". Move its content into the section it belongs to, or into a guide.'
  const withExtra = (extra: string) => validateReadme(readme({ extra }))

  it("sees a heading after a closed fence", () => {
    expect(withExtra("```md\n## Hidden\n```\n## Roadmap\n")).toEqual([roadmap])
    expect(withExtra("~~~\n## Hidden\n~~~\n## Roadmap\n")).toEqual([roadmap])
  })
  it("closes a fence only with the same character", () => {
    expect(withExtra("```\n~~~\n## Hidden\n```\n## Roadmap\n")).toEqual([roadmap])
    expect(withExtra("~~~\n```\n## Hidden\n~~~\n## Roadmap\n")).toEqual([roadmap])
  })
  it("allows up to three spaces before a fence", () => {
    expect(withExtra("   ```\n## Hidden\n   ```\n## Roadmap\n")).toEqual([roadmap])
  })
  it("does not treat text before backticks, one backtick or one tilde as a fence", () => {
    expect(withExtra("text ``` text\n## Roadmap\n")).toEqual([roadmap])
    expect(withExtra("ab```\n## Roadmap\n")).toEqual([roadmap])
    expect(withExtra("`code` and text\n## Roadmap\n")).toEqual([roadmap])
    expect(withExtra("~not a fence\n## Roadmap\n")).toEqual([roadmap])
    expect(withExtra("    ```\n## Roadmap\n")).toEqual([roadmap])
  })
  it("reads a heading only at the start of a line, with spaces after the hashes", () => {
    expect(withExtra("see ## Roadmap\n")).toEqual([])
    expect(withExtra("##Roadmap\n")).toEqual([])
    expect(withExtra("####### seven\n")).toEqual([])
  })
  it("trims extra spaces and closing hashes from a heading's text", () => {
    const text = readme().replace("## Why it exists", "##   Why it exists   ##  ")
    expect(validateReadme(text)).toEqual([])
  })
  it("still sees a final heading when the file ends with a newline", () => {
    expect(validateReadme(`${readme()}## Roadmap\n`)).toEqual([roadmap])
    expect(validateReadme(`${readme()}## Roadmap`)).toEqual([roadmap])
  })
})

describe("validateReadme -- structure edge cases", () => {
  const seeItRun =
    'README.md must have a "### See it run" under "What it does" that shows real output.'
  it("requires the title to be the first heading, not merely present", () => {
    const message = 'README.md must open with a single "# <package name>" title.'
    expect(validateReadme(readme({ title: "## Early\n\n# p" }))).toContain(message)
  })
  it("reports only the missing section when What it does or Next steps is absent", () => {
    const without = (name: string) => REQUIRED_SECTIONS.filter((section) => section !== name)
    expect(validateReadme(readme({ sections: without("What it does") }))).toEqual([
      'README.md is missing the "What it does" section.',
    ])
    expect(validateReadme(readme({ sections: without("Next steps") }))).toEqual([
      'README.md is missing the "Next steps" section.',
    ])
  })
  it("does not fail when What it does or Next steps is the last section", () => {
    const only = validateReadme(readme({ sections: ["What it does"] }))
    expect(only).toContain('README.md is missing the "Why it exists" section.')
    expect(only).not.toContain(seeItRun)
    const last = validateReadme(readme({ sections: ["Next steps"] }))
    expect(last).not.toContain('README.md "Next steps" must offer **Verify:** as its own step.')
  })
  it("accepts See it run only as a level-3 heading with that text under What it does", () => {
    const base = (inner: string) => readme().replace("### See it run\n", inner)
    expect(validateReadme(base("#### See it run\n"))).toEqual([seeItRun])
    expect(validateReadme(base("### Something else\n"))).toEqual([seeItRun])
    expect(validateReadme(base("### See it run later\n"))).toEqual([seeItRun])
    expect(validateReadme(base("## See it run\n"))).toContain(seeItRun)
  })
  it("rejects a See it run under a different section", () => {
    const moved = readme()
      .replace("### See it run\n", "")
      .replace("## Install and verify\n", "## Install and verify\n\n### See it run\n")
    expect(validateReadme(moved)).toEqual([seeItRun])
  })
  it("finds the badges when there are no sections, and ignores a badge on the first section's lines", () => {
    const noSections = ["# p", ...BADGES].join("\n")
    expect(validateReadme(noSections)).not.toContain(
      "README.md is missing the license badge above its first section.",
    )
    const justAfter = readme({ badges: BADGES.slice(1) }).replace(
      "## Why it exists\n",
      `## Why it exists\n${BADGES[0]}\n`,
    )
    expect(validateReadme(justAfter)).toEqual([
      "README.md is missing the CI status badge above its first section.",
    ])
  })
  it("finds the next-step markers in any line of that section only", () => {
    const text = readme({
      nextSteps: "- a\n- **Evaluate:** x\n- b\n- **Integrate:** y\n- **Verify:** z",
    })
    expect(validateReadme(text)).toEqual([])
    const inEarlier = readme({ nextSteps: "- nothing" }).replace(
      "## Maturity, versioning and support\n",
      "## Maturity, versioning and support\n\n**Evaluate:** **Integrate:** **Verify:**\n",
    )
    expect(validateReadme(inEarlier)).toHaveLength(3)
  })
})

describe("validateReadme -- only images count as badges", () => {
  it("does not take a line of text that mentions a badge's subject for the badge", () => {
    const text = readme({ badges: BADGES.slice(0, 6) }).replace(
      "Tagline.",
      "Released under the MIT license.",
    )
    expect(validateReadme(text)).toEqual([
      "README.md is missing the license badge above its first section.",
    ])
  })
})
