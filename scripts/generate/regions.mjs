// Generated regions inside hand-written Markdown.
//
// A document that mixes prose a person owns with a fact the package can derive marks the derived part:
//
//   <!-- ipc:begin entry-points -->
//   ...generated; never edit by hand...
//   <!-- ipc:end entry-points -->
//
// `generate` rewrites what is between the markers and nothing else, so the prose around a region is never
// touched. Markers that are missing, repeated, nested or out of order are reported with their line, never
// guessed at.

const BEGIN = /^<!-- ipc:begin ([a-z][a-z0-9-]*) -->$/
const END = /^<!-- ipc:end ([a-z][a-z0-9-]*) -->$/

/**
 * @typedef {object} Region
 * @property {string} name
 * @property {number} start - the index just after the begin marker's line break.
 * @property {number} end - the index at the start of the end marker's line.
 */

/**
 * @param {string} text - a Markdown document.
 * @returns {{ regions: Region[], problems: { line: number, message: string }[] }}
 */
export function findRegions(text) {
  /** @type {Region[]} */
  const regions = []
  /** @type {{ line: number, message: string }[]} */
  const problems = []
  const names = new Set()
  let open
  let offset = 0
  for (const [index, line] of text.split("\n").entries()) {
    const number = index + 1
    const begin = BEGIN.exec(line.trimEnd())
    const end = END.exec(line.trimEnd())
    if (begin !== null) {
      if (open !== undefined) {
        problems.push({
          line: number,
          message: `region "${begin[1]}" starts inside region "${open.name}", which is still open (opened on line ${String(open.line)}).`,
        })
      } else if (names.has(begin[1])) {
        problems.push({ line: number, message: `region "${begin[1]}" appears more than once.` })
      } else {
        names.add(begin[1])
        open = { name: begin[1], line: number, start: offset + line.length + 1 }
      }
    } else if (end !== null) {
      if (open === undefined || open.name !== end[1]) {
        problems.push({
          line: number,
          message:
            open === undefined
              ? `end marker for "${end[1]}" has no begin marker.`
              : `end marker for "${end[1]}" closes the wrong region; "${open.name}" is open (opened on line ${String(open.line)}).`,
        })
      } else {
        regions.push({ name: open.name, start: open.start, end: offset })
        open = undefined
      }
    }
    offset += line.length + 1
  }
  if (open !== undefined) {
    problems.push({
      line: open.line,
      message: `region "${open.name}" has no end marker.`,
    })
  }
  return { regions, problems }
}

/**
 * @param {string} text - a document whose regions are well formed (see {@link findRegions}).
 * @param {Region[]} regions
 * @param {(name: string) => string} render - the generated body for a region, without surrounding blank lines.
 * @returns {string} the document with every region's body replaced.
 */
export function replaceRegions(text, regions, render) {
  let out = ""
  let cursor = 0
  for (const region of regions) {
    out += `${text.slice(cursor, region.start)}\n${render(region.name)}\n\n`
    cursor = region.end
  }
  return out + text.slice(cursor)
}
