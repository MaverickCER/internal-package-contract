// The "checks" region: every check in the standard, one table per phase, read from `checks/standard.ts` and
// each check's doc header. No document then restates a check by hand.
//
// The phases are the `// (Writers)`, `// (Build barrier)` and `// (Readers)` markers in `standardChecks()`,
// and the rows keep its declaration order. A row's summary is the first paragraph of the check's header, after
// "`Id`: ". The degradation ids and exception registries are the ones the header names; the environment
// registry is left out, since the degradation ids stand for it. A check built by repo-contract's `npmScript` is
// described from its options. A check taken from repo-contract's `strict` tier (`tier.<Id>`) has a fixed
// summary here, because its source is not in this package; an IPC wrapper whose header opens on the check's
// id describes it instead. Generation stops on a missing marker, header or summary, on a check it cannot
// place, and on an `npmScript` entry without a literal script.

import { readFileSync } from "node:fs"
import path from "node:path"
import { toTable } from "./entry-points.mjs"
import { STANDARD_ROOT } from "./thresholds.mjs"

const STANDARD = "checks/standard.ts"
const ENVIRONMENT_REGISTRY = ".repo-contract/exceptions/environment.json"

/** The phases in schedule order: the marker in standard.ts, the heading, and what the heading says. */
const PHASES = [
  ["(Writers)", "1. Writers", "Writers run first, in order."],
  [
    "(Build barrier)",
    "2. Build barrier",
    "Writers finish first and readers wait, so the packaging checks see a fresh `dist/`.",
  ],
  [
    "(Readers)",
    "3. Readers",
    "Readers run concurrently, except where `isolated` or `dependsOn` says otherwise.",
  ],
]

/**
 * What each check taken from repo-contract's `strict` tier holds, with IPC's options applied
 * (checks/strict.ts). repo-contract defines them, so no header here describes them.
 */
const TIER = {
  Lint: { summary: "ESLint reports no error. A warning warns." },
  Format: { summary: "Prettier finds every file formatted." },
  Typecheck: { summary: "`tsc --noEmit` reports no type error." },
  Build: {
    summary: "The package's `npm run build` passes. It fails when the script is absent.",
  },
  Coverage: {
    summary:
      "The package-wide test coverage holds the standard's thresholds. Under `--scope affected` it warns without judging.",
  },
  Crap: {
    summary:
      "No function is both complex and poorly covered. Under `--scope affected` only the affected sources are judged.",
  },
  Duplication: { summary: "Copied code stays within a share of `src/`, as jscpd measures it." },
  Packaging: {
    summary:
      "publint reports no packaging error. A warning warns. A private package passes as not applicable.",
  },
  BundledDependencies: {
    summary:
      "Every package that package.json bundles is also declared in `dependencies`. A private package passes as not applicable.",
  },
  Licenses: { summary: "Every shipped dependency carries a license the policy allows." },
  DocsMarkdown: { summary: "The root and `docs/` Markdown passes markdownlint." },
  Mutation: {
    summary:
      "Every Stryker mutant is detected, or a hand-verified record covers it. None times out.",
    registries: [".repo-contract/exceptions/mutation.json"],
  },
}

/** @param {string} text @returns {string} the text with its first letter capitalized. */
const capitalized = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/** @param {string[]} items @returns {string} each in backticks, or "none". */
const listed = (items) =>
  items.length === 0 ? "none" : items.map((item) => `\`${item}\``).join(", ")

/** @param {string} file @returns {string | undefined} the file's text, or nothing when it cannot be read. */
function readText(file) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    // The caller names what is missing.
  }
}

/**
 * @param {string} entry - a check's entry in `standardChecks()`, comment lines left out.
 * @returns {string | undefined} what an `npmScript` entry holds, from its options, or nothing when the
 *   entry names no literal script.
 */
function npmScriptSummary(entry) {
  const script = /script: "([^"]+)"/.exec(entry)?.[1]
  if (script === undefined) return undefined
  const watched = [...(/mustNotChange: \[([^\]]*)\]/.exec(entry)?.[1].matchAll(/"([^"]+)"/g) ?? [])]
  const leaves =
    watched.length === 0 ? "" : ` and leaves ${listed(watched.map((m) => m[1]))} unchanged`
  const absent = /whenMissing: "fail"/.test(entry)
    ? "It fails when the script is absent."
    : "It passes with a note when the script is absent."
  return `The package's \`npm run ${script}\` passes${leaves}. ${absent}`
}

/**
 * @param {string} source - a check module's text.
 * @param {string} id - the check its header should open on.
 * @returns {{ summary: string, lines: string[] } | undefined} the first paragraph of the module's first doc
 *   comment after "`id`: ", and every line of that comment; nothing when no header opens on `id`.
 */
function headerOf(source, id) {
  const comment = source.match(/\/\*\*([\s\S]*?)\*\//)
  if (comment === null) return undefined
  const lines = comment[1].split("\n").map((line) => line.replace(/^\s*\*/, "").trim())
  const blank = lines.indexOf("", 1)
  const opening = lines
    .slice(0, blank === -1 ? lines.length : blank)
    .join(" ")
    .trim()
  const summary = new RegExp(`^\`${id}\`: (.+)$`).exec(opening)?.[1]
  return summary === undefined ? undefined : { summary, lines }
}

/**
 * @param {string} root - where the standard's sources are read from.
 * @returns {{ problems: string[], markdown: string }} the region's body, or what stops it being written.
 */
export function checksRegion(root = STANDARD_ROOT) {
  const standard = readText(path.join(root, STANDARD))
  if (standard === undefined) {
    return {
      problems: [`${STANDARD} not found; the "checks" region lists its checks.`],
      markdown: "",
    }
  }
  const fromPresets = /^import \{ ([^}]+) \} from "repo-contract\/presets"$/m.exec(standard)
  const importsNpmScript = fromPresets !== null && fromPresets[1].split(", ").includes("npmScript")
  const moduleOf = new Map(
    [...standard.matchAll(/^import \{ ([\w, ]+) \} from "\.\/([\w-]+)\.js"$/gm)].flatMap((match) =>
      match[1].split(", ").map((name) => [name, match[2]]),
    ),
  )
  // Each imported module's text, or nothing where it cannot be read. Only a check that needs it is a problem.
  const sources = new Map(
    [...moduleOf.values()].map((module) => [
      module,
      readText(path.join(root, `checks/${module}.ts`)),
    ]),
  )
  /** @type {string[]} */
  const problems = PHASES.filter(([marker]) => !standard.includes(`    // ${marker}\n`)).map(
    ([marker]) => `${STANDARD} has no "// ${marker}" marker for the "checks" region.`,
  )

  // Each entry with the phase it is declared in, its text without comment lines.
  /** @type {{ id: string, phase: number, text: string }[]} */
  const entries = []
  let phase = -1
  for (const line of standard.split("\n")) {
    const marker = PHASES.findIndex(([name]) => line === `    // ${name}`)
    const start = /^ {4}([A-Z]\w+): /.exec(line)
    if (marker !== -1) phase = marker
    else if (start !== null) entries.push({ id: start[1], phase, text: line })
    else if (entries.length > 0 && !line.trimStart().startsWith("//"))
      entries[entries.length - 1].text += `\n${line}`
  }

  /** @type {string[][][]} */
  const tables = PHASES.map(() => [
    ["Check", "What it holds", "Degradations", "Exception registry", "Defined in"],
  ])
  for (const { id, phase: at, text } of entries) {
    // An entry starts with its id, so it always has a word.
    const words = text.match(/\w+/g)
    // The module of the first word that names an import.
    const module = words.map((word) => moduleOf.get(word)).find((name) => name !== undefined)
    const fromTier = Object.hasOwn(TIER, id) && new RegExp(`\\btier\\.${id}\\b`).test(text)
    const source = sources.get(module)
    const header = source === undefined ? undefined : headerOf(source, id)
    let row
    if (importsNpmScript && words.includes("npmScript")) {
      const holds = npmScriptSummary(text)
      if (holds === undefined) {
        problems.push(
          `${STANDARD}: \`${id}\` gives \`npmScript\` no literal \`script: "..."\` for the "checks" region.`,
        )
        continue
      }
      row = [`\`${id}\``, holds, "none", "none", "`repo-contract/presets`"]
    } else if (header === undefined && fromTier) {
      const { summary: holds, registries = [] } = TIER[id]
      const wrapper = module === undefined ? "" : `, \`checks/${module}.ts\``
      row = [`\`${id}\``, holds, "none", listed(registries), `\`repo-contract/tiers\`${wrapper}`]
    } else if (module === undefined) {
      problems.push(`${STANDARD}: no module or preset defines \`${id}\` for the "checks" region.`)
      continue
    } else if (source === undefined) {
      problems.push(
        `checks/${module}.ts not found; the "checks" region reads \`${id}\` from its header.`,
      )
      continue
    } else if (header === undefined) {
      problems.push(
        `checks/${module}.ts: the doc header does not open with "\`${id}\`: what it holds." for the "checks" region.`,
      )
      continue
    } else {
      // Neither pattern holds a space, so a mention never spans two lines.
      /** @param {RegExp} pattern @returns {string[]} each distinct first group the header's lines match. */
      const mentioned = (pattern) => [
        ...new Set(header.lines.flatMap((line) => [...line.matchAll(pattern)].map((m) => m[1]))),
      ]
      const degradations = mentioned(/`([A-Z][A-Za-z]+:(?:[a-z][a-z0-9-]*|<[a-z]+>))`/g)
      const registries = mentioned(/`(\.repo-contract\/exceptions\/[a-z-]+\.json)`/g).filter(
        (registry) => registry !== ENVIRONMENT_REGISTRY,
      )
      row = [
        `\`${id}\``,
        capitalized(header.summary),
        listed(degradations),
        listed(registries),
        `\`checks/${module}.ts\``,
      ]
    }
    // An entry before the first marker has no phase; the missing marker is already a problem.
    if (at !== -1) tables[at].push(row)
  }
  const markdown = PHASES.map(([, heading, lede], index) =>
    [`### ${heading}`, "", lede, "", toTable(tables[index])].join("\n"),
  ).join("\n\n")
  return { problems, markdown }
}
