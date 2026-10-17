// Whether a package's agent skill is right: what it should say, what is on disk, and whether what the author wrote
// still holds (the example exists, the links resolve, the commands are real, and the manual is short enough to load).

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { readFacts } from "./facts.mjs"
import {
  DEFAULT_BUDGET,
  MAXIMUM_BUDGET,
  renderApi,
  renderSkill,
  skillFolder,
  wordsOf,
} from "./render.mjs"

/** The longest example, in lines, that is worth loading in every manual. */
const LONGEST_EXAMPLE = 40
/** The longest cell the author writes in a table, in characters: a table row that long no longer scans. */
const LONGEST_CELL = 200
/** The longest `when`, in characters: it is read to decide whether to load the skill at all. */
const LONGEST_WHEN = 300

/** @param {unknown} value @returns {boolean} whether it is a list of strings. */
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string")

/** @param {unknown} value @returns {boolean} whether it is an object whose named fields are all strings. */
const rowOf = (value, /** @type {string[]} */ ...names) =>
  typeof value === "object" &&
  value !== null &&
  names.every((name) => typeof (/** @type {Record<string, unknown>} */ (value)[name]) === "string")

/**
 * @param {any} skill - what `docs/skill.json` says.
 * @param {(file: string) => boolean} exists - whether a file is in the package.
 * @returns {string[]} what is wrong with it.
 */
export function problemsOf(skill, exists) {
  /** @type {string[]} */
  const problems = []
  const wrong = (/** @type {string} */ field, /** @type {string} */ why) =>
    problems.push(`docs/skill.json: "${field}" ${why}.`)
  for (const field of ["when", "purpose", "notFor"]) {
    if (skill[field] !== undefined && typeof skill[field] !== "string") wrong(field, "must be text")
  }
  if (typeof skill.when === "string" && skill.when.length > LONGEST_WHEN) {
    wrong(
      "when",
      `is ${String(skill.when.length)} characters; it is read to decide whether to load the skill, so keep it under ${String(LONGEST_WHEN)}`,
    )
  }
  for (const field of ["rules", "behavior", "verify"]) {
    if (skill[field] !== undefined && !strings(skill[field])) wrong(field, "must be a list of text")
  }
  if (
    skill.mistakes !== undefined &&
    !(Array.isArray(skill.mistakes) && skill.mistakes.every((row) => rowOf(row, "wrong", "right")))
  ) {
    wrong("mistakes", 'must be a list of { "wrong", "right" }')
  }
  if (
    Array.isArray(skill.mistakes) &&
    skill.mistakes.every((row) => rowOf(row, "wrong", "right"))
  ) {
    for (const { wrong: before, right: after } of skill.mistakes) {
      for (const text of [before, after]) {
        if (text.length > LONGEST_CELL) {
          wrong(
            "mistakes",
            `has a cell of ${String(text.length)} characters, over ${String(LONGEST_CELL)}: it would be cut mid-sentence, so shorten it`,
          )
        }
      }
    }
  }
  if (
    skill.imports !== undefined &&
    !(
      typeof skill.imports === "object" &&
      skill.imports !== null &&
      !Array.isArray(skill.imports) &&
      Object.values(skill.imports).every(
        (text) => typeof text === "string" && text.length <= LONGEST_CELL,
      )
    )
  ) {
    wrong(
      "imports",
      `must map an import to its words, each at most ${String(LONGEST_CELL)} characters`,
    )
  }
  if (
    skill.references !== undefined &&
    !(
      Array.isArray(skill.references) && skill.references.every((row) => rowOf(row, "when", "path"))
    )
  ) {
    wrong("references", 'must be a list of { "when", "path" }')
  } else {
    for (const { path: target } of skill.references ?? []) {
      if (!exists(String(target).replace(/[#?].*/, "")))
        wrong("references", `names \`${String(target)}\`, which is not in the package`)
    }
  }
  if (
    skill.budget !== undefined &&
    !(Number.isInteger(skill.budget) && skill.budget >= 100 && skill.budget <= MAXIMUM_BUDGET)
  ) {
    wrong("budget", `must be a whole number of words from 100 to ${String(MAXIMUM_BUDGET)}`)
  }
  return problems
}

/**
 * @param {string} cwd - the package.
 * @returns {{
 *   state: "none" | "invalid" | "checked",
 *   problems: string[],
 *   notes: string[],
 *   stale: string[],
 *   words: number,
 *   budget: number,
 *   files: Record<string, string>,
 * }} where it stands: the problems that fail it, the notes that do not, the files that are not what they should be,
 *   and the files it should have.
 */
export function inspectSkill(cwd) {
  const facts = readFacts(cwd)
  const empty = { notes: [], stale: [], words: 0, budget: DEFAULT_BUDGET, files: {} }
  if (facts === undefined || facts.skill === undefined) {
    return {
      ...empty,
      state: "none",
      problems: ["there is no docs/skill.json, so there is nothing to write the skill from"],
    }
  }
  const exists = (/** @type {string} */ file) => existsSync(path.join(cwd, file))
  const problems = problemsOf(facts.skill, exists)
  const notes = [
    ...(facts.skill.example === undefined
      ? ["there is no example, which is the part an agent copies from"]
      : []),
    ...((facts.skill.rules ?? []).length === 0
      ? ["there are no rules: say what an agent must not do, and what to do instead"]
      : []),
  ]
  /** @type {{ code: string, file: string, language: string } | undefined} */
  let example
  if (facts.skill.example !== undefined) {
    const { file, lines } = facts.skill.example
    if (typeof file !== "string" || !exists(file)) {
      problems.push(
        `docs/skill.json: "example" names \`${String(file)}\`, which is not in the package.`,
      )
    } else {
      const all = readFileSync(path.join(cwd, file)).toString().replace(/\n$/, "").split("\n")
      // Stryker disable next-line ArrayDeclaration: any non-integer pair fails the next check the same way.
      const [from, to] = lines === undefined ? [1, all.length] : Array.isArray(lines) ? lines : []
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        to > all.length ||
        from > to
      ) {
        problems.push(
          `docs/skill.json: "example" lines ${String(from)} to ${String(to)} are not in \`${file}\` (${String(all.length)} lines): give them as [from, to].`,
        )
      } else if (to - from + 1 > LONGEST_EXAMPLE) {
        problems.push(
          `docs/skill.json: "example" is ${String(to - from + 1)} lines; keep it to ${String(LONGEST_EXAMPLE)}, or choose the lines that matter.`,
        )
      } else {
        example = {
          code: all.slice(from - 1, to).join("\n"),
          file,
          language: path.extname(file).slice(1),
        }
      }
    }
  }
  if (problems.length > 0) return { ...empty, state: "invalid", problems, notes }
  const folder = skillFolder(facts.name)
  const manual = renderSkill(facts, example)
  const files = {
    [`${folder}/SKILL.md`]: manual,
    ...(facts.entries.some((/** @type {{ api: unknown[] }} */ entry) => entry.api.length > 0)
      ? { [`${folder}/references/api.md`]: renderApi(facts) }
      : {}),
  }
  const words = wordsOf(manual.slice(manual.indexOf("\n---\n", 4) + 5))
  const budget = facts.skill.budget ?? DEFAULT_BUDGET
  if (words > budget) {
    problems.push(
      `the manual is ${String(words)} words, over its budget of ${String(budget)}: move detail into a reference and link it, or cut it.`,
    )
  }
  const stale = Object.entries(files)
    .filter(
      ([file, text]) => !exists(file) || readFileSync(path.join(cwd, file)).toString() !== text,
    )
    .map(([file]) => file)
  return { state: "checked", problems, notes, stale, words, budget, files }
}
