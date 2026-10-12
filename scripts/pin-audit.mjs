// Asks GitHub whether the pins of this package in a consumer are real.
//
// `pin-consistency.mjs` checks, offline, that a consumer's pins agree with one another. They can all
// agree on a commit that is not part of this repository's history: the release bot once tagged an
// unmerged release-branch commit, and three consumers pinned it. This audit asks GitHub two things
// per pin: is the commit reachable from the default branch, and does the `# vX` comment name a tag
// that points at that very commit. GitHub being unreachable is "blocked", never a pass.

import { shaFromLockfile } from "./init-lib.mjs"
import { workflowPins } from "./pin-consistency.mjs"

const REPO = "MaverickCER/internal-package-contract"
const BRANCH = "main"
const FULL_SHA = /^[0-9a-f]{40}$/

/**
 * @typedef {{ ok: boolean, status: number, json?: any }} GhReply
 * @typedef {(apiPath: string) => Promise<GhReply>} Gh
 */

/**
 * @param {{ lockfile: string | undefined, workflows: readonly { file: string, text: string }[] }} input
 * @returns {{ where: string, sha: string, comment: string }[]} every pin that is a full commit SHA.
 */
export function collectPins({ lockfile, workflows }) {
  const locked = shaFromLockfile(lockfile)
  const pins =
    locked === undefined ? [] : [{ where: "package-lock.json", sha: locked, comment: "" }]
  for (const { file, text } of workflows) {
    for (const pin of workflowPins(text)) {
      if (FULL_SHA.test(pin.ref)) {
        pins.push({ where: `${file}:${pin.line}`, sha: pin.ref, comment: pin.comment })
      }
    }
  }
  return pins
}

/**
 * @param {{ pins: readonly { where: string, sha: string, comment: string }[], gh: Gh }} input
 * @returns {Promise<{ problems: string[], blocked: string[] }>}
 */
export async function auditPins({ pins, gh }) {
  const cache = new Map()
  const ask = (apiPath) => {
    if (!cache.has(apiPath)) cache.set(apiPath, gh(apiPath))
    return cache.get(apiPath)
  }
  const problems = []
  const blocked = []
  for (const { where, sha, comment } of pins) {
    const short = sha.slice(0, 7)
    const reach = await ask(`repos/${REPO}/compare/${BRANCH}...${sha}`)
    if (reach.ok) {
      if (reach.json.status !== "behind" && reach.json.status !== "identical") {
        problems.push(
          `${where}: ${short} is not reachable from ${BRANCH} (it is ${reach.json.status}); it was never merged, or was rewritten away.`,
        )
      }
    } else if (reach.status === 404) {
      problems.push(`${where}: commit ${short} does not exist in ${REPO}.`)
    } else {
      blocked.push(
        `${where}: could not ask GitHub whether ${short} is reachable (HTTP ${reach.status}).`,
      )
    }

    if (!/^v\d/.test(comment)) continue
    const tag = await ask(`repos/${REPO}/commits/${comment}`)
    if (tag.ok) {
      if (tag.json.sha !== sha) {
        problems.push(
          `${where}: tag ${comment} is ${tag.json.sha.slice(0, 7)}, not ${short}; the comment and the pin name different commits.`,
        )
      }
    } else if (tag.status === 404) {
      problems.push(`${where}: there is no tag ${comment} in ${REPO}.`)
    } else {
      blocked.push(
        `${where}: could not ask GitHub where tag ${comment} points (HTTP ${tag.status}).`,
      )
    }
  }
  return { problems, blocked }
}

/**
 * @param {{ lockfile: string | undefined, workflows: readonly { file: string, text: string }[], gh: Gh, io: { out: (text: string) => void, err: (text: string) => void } }} input
 * @returns {Promise<number>} 0 all pins real, 1 a pin is not, 2 blocked.
 */
export async function run({ lockfile, workflows, gh, io }) {
  const pins = collectPins({ lockfile, workflows })
  if (pins.length === 0) {
    io.out("This repository pins nothing from internal-package-contract; nothing to audit.\n")
    return 0
  }
  const { problems, blocked } = await auditPins({ pins, gh })
  if (problems.length > 0) {
    io.err(`${problems.map((p) => `- ${p}`).join("\n")}\n`)
    return 1
  }
  if (blocked.length > 0) {
    io.err(`Pin audit blocked, not passed:\n${blocked.map((p) => `- ${p}`).join("\n")}\n`)
    return 2
  }
  io.out(
    `${String(pins.length)} pin(s) audited: every commit is on ${BRANCH} and every release comment matches its tag.\n`,
  )
  return 0
}
