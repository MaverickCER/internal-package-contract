// Which files in a consumer repository this package owns, and whether they still say what it says.
//
// `init` scaffolds a starter and then steps back: everything it writes is the consumer's afterwards, and
// most of it should change (a README, the sources, the docs). A few files are different. They are plumbing
// that exists only to call this package's shared workflows or to configure the release it drives, so a
// consumer copy that drifts is a release that quietly stops behaving like the standard. Those are listed
// here as MANAGED; everything else stays consumer-owned and is never reported.
//
// Drift is judged on what a file means, not on its bytes: comments, blank lines and the commit an action is
// pinned to are ignored (the pin is moved by `dependency-pin-sync`, not by hand), so wording improvements
// in the template do not read as drift in every consumer.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { render } from "../init-lib.mjs"

/** The files this package owns, as template path, destination in the consumer, and how to compare them. */
export const MANAGED = Object.freeze([
  {
    from: "template/release.yml",
    to: ".github/workflows/release.yml",
    kind: "workflow",
  },
  {
    from: "template/package/.github/workflows/sync-internal-package-contract.yml",
    to: ".github/workflows/sync-internal-package-contract.yml",
    kind: "workflow",
  },
  {
    from: "template/package/.changeset/config.json",
    to: ".changeset/config.json",
    kind: "json",
  },
])

const PIN = /@(?:\{\{ipcSha\}\}|[0-9a-f]{40})[^\n]*/g
const CONSUMER_PIN = /@([0-9a-f]{40}) # (v\d+\.\d+\.\d+\S*)/

/**
 * What a file means, with everything that is only wording or a moving pin removed.
 * @param {"workflow" | "json"} kind
 * @param {string} text
 * @returns {string}
 */
export function meaning(kind, text) {
  if (kind === "json") return JSON.stringify(JSON.parse(text))
  return text
    .replace(PIN, "@PIN")
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*/, "").trimEnd())
    .filter((line) => line !== "")
    .join("\n")
}

/**
 * @param {string} text - a consumer's workflow.
 * @returns {{ ipcRef: string, ipcSha: string } | undefined} the pin it currently carries.
 */
export function pinOf(text) {
  const match = CONSUMER_PIN.exec(text)
  return match === null ? undefined : { ipcRef: match[2], ipcSha: match[1] }
}

/**
 * @param {string} templateText
 * @param {{ ipcRef: string, ipcSha: string }} pins
 * @returns {string} the template with this package's pin placeholders filled in.
 */
export function renderManaged(templateText, pins) {
  return render(templateText, pins)
}

/**
 * @typedef {object} ManagedState
 * @property {string} to - the file's path in the consumer.
 * @property {"current" | "missing" | "drifted"} state
 * @property {string} wanted - the template's text, for the consumer's own pin when it has one.
 * @property {string | undefined} have - the consumer's text, when the file exists.
 */

/**
 * @param {{ cwd: string, packageRoot: string, pins: { ipcRef: string, ipcSha: string } }} input
 * @returns {ManagedState[]} every managed file, in manifest order.
 */
export function inspectManaged({ cwd, packageRoot, pins }) {
  return MANAGED.map(({ from, to, kind }) => {
    const destination = path.join(cwd, to)
    const have = existsSync(destination) ? readFileSync(destination).toString() : undefined
    const template = readFileSync(path.join(packageRoot, from)).toString()
    // Stryker disable next-line ConditionalExpression: equivalent -- a missing file has no text to read a pin from, and reading one from `undefined` finds none, so the supplied pins are used either way.
    const wanted = renderManaged(template, (have === undefined ? undefined : pinOf(have)) ?? pins)
    if (have === undefined) return { to, state: "missing", wanted, have }
    return {
      to,
      state: meaning(kind, wanted) === meaning(kind, have) ? "current" : "drifted",
      wanted,
      have,
    }
  })
}
