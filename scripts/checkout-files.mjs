// What a checkout holds that is not ignored: the set of files a copy, a hash or a comparison of it has to consider.

import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"

/**
 * @param {string} dir - a checkout.
 * @returns {string[]} what is in it that is not ignored, relative to it: git's answer when it is a repository, else
 *   everything but node_modules and .git.
 */
export function filesOf(dir) {
  const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
  if (listed.status === 0) return listed.stdout.split("\0").filter((name) => name !== "")
  /** @param {string} at @returns {string[]} */
  const walk = (at) =>
    readdirSync(path.join(dir, at), { withFileTypes: true }).flatMap((entry) => {
      const relative = path.join(at, entry.name)
      if (entry.name === "node_modules" || entry.name === ".git") return []
      return entry.isDirectory() ? walk(relative) : [relative]
    })
  return walk("")
}
