// A package that declares a minimum Node.js in `engines` promises it works there. That promise is only as good
// as the CI that runs on that version, so `EngineMatrix` fails when no workflow tests the declared minimum.
// This finds the lowest major in `engines.node` (`>=22`, `^22.4`, `22.x`, `>=22 <25`). It then finds every
// major on a `node-version:` line, or in the block list under one, across every file in `.github/workflows`.
// It reads declarations, never runs anything. A missing `engines.node`, or one no minimum can be read from, is
// its own failure state. A private package is exempt (scripts/check-engines.mjs).

/**
 * @param {unknown} range - the `engines.node` value, such as `>=22.0.0`, `^22.4`, `22.x` or `>=22 <25`.
 * @returns {number | undefined} the lowest major version the range allows, or undefined when none can be read.
 */
export function minimumNodeMajor(range) {
  if (typeof range !== "string") return undefined
  const majors = [...range.matchAll(/(?:^|[\s^~>=v])(\d+)(?=[.\sx*]|$)/g)].map((match) =>
    Number(match[1]),
  )
  return majors.length === 0 ? undefined : Math.min(...majors)
}

/**
 * The Node versions a workflow file asks for: every value on a `node-version:` line (a single value or an
 * inline matrix list) and every item of a block list that follows one.
 * @param {string} text - a workflow file.
 * @returns {string[]} the raw version strings.
 */
export function testedVersions(text) {
  const versions = []
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    const match = /^\s*node-version\s*:\s*([^#]*)/.exec(line)
    if (match === null) return
    const inline = match[1]
    if (inline !== "") {
      versions.push(...inline.replace(/[[\]"']/g, "").split(","))
      return
    }
    for (const next of lines.slice(index + 1)) {
      const item = /^\s*-\s*(.+?)\s*$/.exec(next)
      if (item === null) break
      versions.push(item[1].replace(/["']/g, ""))
    }
  })
  return versions.map((version) => version.trim()).filter((version) => version !== "")
}

/**
 * @param {{ engines?: { node?: unknown } }} manifest - the package's `package.json`.
 * @param {readonly string[]} workflows - the text of every workflow file.
 * @returns {{ state: "ok" | "no-engines" | "unreadable" | "untested", minimum?: number, tested?: number[] }}
 */
export function judgeEngineMatrix(manifest, workflows) {
  const declared = manifest.engines?.node
  if (declared === undefined) return { state: "no-engines" }
  const minimum = minimumNodeMajor(declared)
  if (minimum === undefined) return { state: "unreadable" }
  const tested = [
    ...new Set(
      workflows
        .flatMap(testedVersions)
        .map((version) => /^v?(\d+)(?:[.x*]|$)/.exec(version)?.[1])
        .filter((major) => major !== undefined)
        .map(Number),
    ),
  ].sort((a, b) => a - b)
  return { state: tested.includes(minimum) ? "ok" : "untested", minimum, tested }
}
