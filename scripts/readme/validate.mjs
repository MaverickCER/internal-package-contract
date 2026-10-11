// The README layout every published package shares. A README exists to help a developer decide whether to
// install and adopt the package, so it answers the same questions in the same order everywhere and sends
// everything else to the guides. This module is the mechanical half of that bar: which sections, in what
// order, with which badges, within what length. Whether the prose is true and persuasive stays a review.

/** The `##` sections, in the order a reader's questions arrive. */
export const REQUIRED_SECTIONS = [
  "Why it exists",
  "How it differs",
  "What it does",
  "Install and verify",
  "Fit and capabilities",
  "Limits and when not to use it",
  "Security and supply chain",
  "Maturity, versioning and support",
  "Documentation",
  "Next steps",
]

/** Longer than this and the README is doing a guide's job. */
export const MAX_LINES = 220

/** The trust signals a reader looks for before reading anything else. */
export const REQUIRED_BADGES = [
  { label: "CI status", pattern: /actions\/workflows|workflow\/status/ },
  { label: "npm version", pattern: /\/npm\/v\// },
  { label: "coverage", pattern: /coverage/i },
  { label: "Socket", pattern: /badge\.socket\.dev/ },
  { label: "license", pattern: /license/i },
]

const NEXT_STEPS = ["Evaluate", "Integrate", "Verify"]

/** Headings outside code fences, with their level, text and 1-based line. */
function headings(lines) {
  const found = []
  let fence
  lines.forEach((text, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1]
    if (fence === undefined && marker !== undefined) fence = marker[0]
    else if (fence !== undefined && marker?.[0] === fence) fence = undefined
    else if (fence === undefined) {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text)
      if (match) found.push({ level: match[1].length, text: match[2], line: index + 1 })
    }
  })
  return found
}

/**
 * @param {string} markdown the README's text
 * @returns {string[]} one sentence per problem; empty when the README meets the layout
 */
export function validateReadme(markdown) {
  const problems = []
  const lines = markdown.replace(/\n$/, "").split("\n")
  const found = headings(lines)

  const titles = found.filter((heading) => heading.level === 1)
  if (titles.length !== 1 || found[0]?.level !== 1) {
    problems.push('README.md must open with a single "# <package name>" title.')
  }

  const sections = found.filter((heading) => heading.level === 2)
  const names = sections.map((section) => section.text)
  for (const required of REQUIRED_SECTIONS) {
    if (!names.includes(required)) problems.push(`README.md is missing the "${required}" section.`)
  }
  for (const name of names) {
    if (!REQUIRED_SECTIONS.includes(name)) {
      problems.push(
        `README.md has a section that is not part of the standard layout: "${name}". Move its content into the section it belongs to, or into a guide.`,
      )
    }
  }
  const present = names.filter((name) => REQUIRED_SECTIONS.includes(name))
  const expected = REQUIRED_SECTIONS.filter((name) => present.includes(name))
  if (present.join("\n") !== expected.join("\n")) {
    problems.push(
      `README.md sections are out of order: expected ${expected.join(", ")}; found ${present.join(", ")}.`,
    )
  }

  const whatItDoes = sections.find((section) => section.text === "What it does")
  if (whatItDoes !== undefined) {
    const next = sections.find((section) => section.line > whatItDoes.line)
    const end = next?.line ?? Infinity
    const seeItRun = found.some(
      (heading) =>
        heading.level === 3 &&
        heading.text === "See it run" &&
        heading.line > whatItDoes.line &&
        heading.line < end,
    )
    if (!seeItRun) {
      problems.push(
        'README.md must have a "### See it run" under "What it does" that shows real output.',
      )
    }
  }

  const firstSection = sections[0]?.line ?? lines.length + 1
  const header = lines.slice(0, firstSection - 1).filter((text) => /!\[[^\]]*\]\(/.test(text))
  for (const badge of REQUIRED_BADGES) {
    if (!header.some((text) => badge.pattern.test(text))) {
      problems.push(`README.md is missing the ${badge.label} badge above its first section.`)
    }
  }

  const nextSteps = sections.find((section) => section.text === "Next steps")
  if (nextSteps !== undefined) {
    const following = sections.find((section) => section.line > nextSteps.line)
    const body = lines.slice(nextSteps.line, (following?.line ?? lines.length + 1) - 1).join("\n")
    for (const step of NEXT_STEPS) {
      if (!body.includes(`**${step}:**`)) {
        problems.push(`README.md "Next steps" must offer **${step}:** as its own step.`)
      }
    }
  }

  if (lines.length > MAX_LINES) {
    problems.push(
      `README.md is ${lines.length} lines, over the ${MAX_LINES}-line limit. Move detail into the guides and link to it.`,
    )
  }
  return problems
}
