// An agent skill as two files: a short operating manual an agent loads whole, and a reference of every public
// signature it loads only when it needs one. The manual says what the package is for, shows one example that works,
// states what the types cannot, and says how to check the result; everything longer is a link, so the cost of loading
// it stays small however large the package is. Pure: what goes in is read elsewhere.

/** How many words the manual may have before it stops being cheap to load. */
export const DEFAULT_BUDGET = 600
/** The largest budget a package may set for itself. */
export const MAXIMUM_BUDGET = 1000

const LONGEST_PURPOSE = 80

/** @param {string} name @returns {string} the package's name without its scope. */
export const shortName = (name) => name.replace(/^@[^/]+\//, "")

/** @param {string} name @returns {string} where the skill's files live in the package. */
export const skillFolder = (name) => `skills/${shortName(name)}`

/** @param {string} text @returns {number} how many words it has. */
export const wordsOf = (text) => (text.match(/\S+/g) ?? []).length

/**
 * @param {string} text - what goes in one table cell.
 * @returns {string} it on one line, shortened to the cell's length: cut after a whole word, never inside a code span,
 *   so what is left is still Markdown that reads.
 */
export const cell = (text) => {
  const flat = text.replace(/\s+/g, " ").trim()
  if (flat.length <= LONGEST_PURPOSE) return flat.replaceAll("|", "\\|")
  const head = flat.slice(0, LONGEST_PURPOSE - 1)
  // An even number of pieces means an odd number of backticks: the cut is inside a code span, so drop the span.
  const insideCode = head.split("`").length % 2 === 0
  const space = head.lastIndexOf(" ")
  const whole = insideCode
    ? head.slice(0, head.lastIndexOf("`"))
    : space === -1
      ? head
      : head.slice(0, space)
  return `${whole.replace(/[,;:\s-]+$/, "").replaceAll("|", "\\|")}…`
}

/**
 * @param {string} text - what the author wrote for one table cell.
 * @returns {string} it on one line with its pipes escaped, whole: the author's words are never cut.
 */
export const whole = (text) => text.replace(/\s+/g, " ").trim().replaceAll("|", "\\|")

/**
 * @param {string} repository - the repository's address.
 * @param {string} file - a path in it.
 * @returns {string} the address of the file on the default branch.
 */
export const linkTo = (repository, file) => `${repository}/blob/main/${file}`

/**
 * @param {string} repository - the repository's address.
 * @param {string} name - the package's name.
 * @returns {string} the address to give an agent: the manual as plain text.
 */
export function rawLink(repository, name) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repository)
  return match === null
    ? linkTo(repository, `${skillFolder(name)}/SKILL.md`)
    : `https://raw.githubusercontent.com/${String(match[1])}/${String(match[2])}/main/${skillFolder(name)}/SKILL.md`
}

/**
 * @param {any} facts - see facts.mjs.
 * @param {{ code: string, file: string, language: string } | undefined} example - the example, read from its file.
 * @returns {string} the manual.
 */
export function renderSkill(facts, example) {
  const skill = facts.skill ?? {}
  const name = shortName(facts.name)
  const fence = "```"
  const lines = [
    "---",
    `name: ${name}`,
    `description: ${skill.when ?? `Use when working with ${facts.name}: ${facts.description}`}`,
    "---",
    "",
    `# ${facts.name}`,
    "",
    String(skill.purpose ?? facts.description),
    "",
  ]
  if (skill.notFor !== undefined) lines.push(`Not for: ${String(skill.notFor)}`, "")
  if (example !== undefined) {
    lines.push(
      "## Use it",
      "",
      `${fence}${example.language}`,
      example.code,
      fence,
      "",
      `From \`${example.file}\`.`,
      "",
    )
  }
  const said = skill.imports ?? {}
  /** The words for an import: the author's own when given, whole; otherwise the entry point's purpose, shortened. */
  const forEntry = (/** @type {{ specifier: string, purpose: string }} */ entry) =>
    Object.hasOwn(said, entry.specifier) ? whole(said[entry.specifier]) : cell(entry.purpose)
  const entries = facts.entries.filter(
    (/** @type {{ specifier: string, purpose: string }} */ entry) =>
      entry.purpose !== "" || Object.hasOwn(said, entry.specifier),
  )
  if (entries.length > 0) {
    lines.push(
      "## Import from",
      "",
      "| Import | For |",
      "| --- | --- |",
      ...entries.map(
        (/** @type {{ specifier: string, purpose: string }} */ entry) =>
          `| \`${entry.specifier}\` | ${forEntry(entry)} |`,
      ),
      "",
    )
  }
  /** @type {[string, string[] | undefined][]} */
  const lists = [
    ["Rules", skill.rules],
    ["Rely on", skill.behavior],
  ]
  for (const [heading, items] of lists) {
    if (items !== undefined && items.length > 0) {
      lines.push(`## ${heading}`, "", ...items.map((/** @type {string} */ item) => `- ${item}`), "")
    }
  }
  if (skill.mistakes !== undefined && skill.mistakes.length > 0) {
    lines.push(
      "## Common mistakes",
      "",
      "| Instead of | Do this |",
      "| --- | --- |",
      ...skill.mistakes.map(
        (/** @type {{ wrong: string, right: string }} */ row) =>
          `| ${whole(row.wrong)} | ${whole(row.right)} |`,
      ),
      "",
    )
  }
  const verify = skill.verify ?? []
  lines.push(
    "## Verify",
    "",
    ...(verify.length > 0
      ? verify.map(
          (/** @type {string} */ command, /** @type {number} */ index) =>
            `${String(index + 1)}. ${command}`,
        )
      : ["1. Run the project's type check and tests."]),
    "",
    "Report any check you could not run, and any assumption you made.",
    "",
    "## Go deeper",
    "",
    ...(skill.references ?? []).map(
      (/** @type {{ when: string, path: string }} */ reference) =>
        `- [${reference.when}](${linkTo(facts.repository, reference.path)})`,
    ),
    `- [Every public signature](${linkTo(facts.repository, `${skillFolder(facts.name)}/references/api.md`)})`,
    "",
    "## Authority",
    "",
    `Target \`${facts.name}@${facts.version}\`. The installed package's exports and type declarations are the API: do not invent exports, options or return values. Behaviour is established by its tests and examples. If this skill and the code disagree, say so rather than guessing.`,
    "",
  )
  return lines.join("\n")
}

/**
 * @param {any} facts - see facts.mjs.
 * @returns {string} every public signature, by entry point.
 */
export function renderApi(facts) {
  const lines = [
    `# ${facts.name} public API`,
    "",
    `Every export a consumer can import, by entry point, for version ${facts.version}. Generated from the package's committed API baselines; the type declarations in the installed package are the authority.`,
    "",
  ]
  for (const entry of facts.entries.filter(
    (/** @type {{ api: unknown[] }} */ candidate) => candidate.api.length > 0,
  )) {
    lines.push(`## \`${entry.specifier}\``, "")
    for (const member of entry.api) {
      lines.push(
        `- \`${member.name}\` (${member.kind.toLowerCase()}${member.tag === "Public" ? "" : `, ${member.tag.toLowerCase()}`}): \`${member.signature}\``,
      )
    }
    lines.push("")
  }
  return lines.join("\n")
}
