// `internal-package-contract sync`: reports whether the files this package owns in a consumer still match
// it, and, only when asked, brings them back. Applying a standard is a separate act from checking it.
//
//   internal-package-contract sync                  report; exit 1 if any file is missing or has drifted
//   internal-package-contract sync --apply          also write the files that are missing
//   internal-package-contract sync --apply --update also replace files that have drifted (shown first)
//   internal-package-contract sync --add <name>     start carrying a managed copy of shared code, and write it
//
// Nothing here runs at install time, nothing outside the managed list is touched, and a drifted file is
// never overwritten without `--update`, so a deliberate customization is never lost by surprise.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { shaFromLockfile } from "../init-lib.mjs"
import { COPIES, enrolledCopies, inspectManaged } from "./inspect.mjs"

const USAGE = "Usage: internal-package-contract sync [--apply [--update]] [--add <copy>]\n"

/**
 * @param {string} wanted
 * @param {string} have
 * @returns {string} the changes from `have` to `wanted` as unified-diff hunks, or a plain note without git.
 */
export function unifiedDiff(wanted, have) {
  // Stryker disable next-line StringLiteral: equivalent -- the prefix only names the temporary directory.
  const dir = mkdtempSync(path.join(tmpdir(), "ipc-sync-diff-"))
  try {
    writeFileSync(path.join(dir, "yours"), have)
    writeFileSync(path.join(dir, "standard"), wanted)
    const result = spawnSync(
      "git",
      ["diff", "--no-index", "--no-color", "--", "yours", "standard"],
      { cwd: dir, encoding: "utf8" },
    )
    const lines = result.stdout.split("\n")
    const start = lines.findIndex((line) => line.startsWith("@@"))
    return start === -1 ? "(the files differ)\n" : lines.slice(start).join("\n")
  } finally {
    rmSync(dir, { recursive: true })
  }
}

/**
 * @param {readonly string[]} argv
 * @param {string} cwd - the consumer's root.
 * @param {string} packageRoot - this package's root.
 * @param {{ out: (text: string) => void, err: (text: string) => void }} io
 * @param {readonly { name: string }[]} [copies] - the managed copies on offer; a test seam, defaulting to the real ones.
 * @returns {number} the exit code.
 */
export function run(argv, cwd, packageRoot, io, copies = COPIES) {
  let apply = false
  let update = false
  let add
  const unknown = []
  const items = argv[Symbol.iterator]()
  for (const arg of items) {
    if (arg === "--apply") apply = true
    else if (arg === "--update") update = true
    else if (arg === "--add") add = items.next().value ?? ""
    else unknown.push(arg)
  }
  if (add !== undefined && !copies.some(({ name }) => name === add)) {
    io.err(
      `[sync] unknown managed copy: ${add || "(none given)"}. Available: ${copies.map(({ name }) => name).join(", ")}.\n${USAGE}`,
    )
    return 2
  }
  if (unknown.length > 0 || (update && !apply && add === undefined)) {
    io.err(
      unknown.length > 0
        ? `[sync] unknown argument: ${unknown[0]}\n${USAGE}`
        : `[sync] --update needs --apply.\n${USAGE}`,
    )
    return 2
  }
  if (add !== undefined) {
    // Starting to carry a copy is an explicit act: it is recorded, then the file is written.
    const file = path.join(cwd, "package.json")
    const manifest = JSON.parse(readFileSync(file).toString())
    const copies = [...new Set([...enrolledCopies(cwd), add])].sort()
    manifest["internal-package-contract"] = { ...manifest["internal-package-contract"], copies }
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
    io.out(`enrolled ${add} in package.json\n`)
    apply = true
  }
  const version = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json")).toString(),
  ).version
  const lockPath = path.join(cwd, "package-lock.json")
  const sha = shaFromLockfile(existsSync(lockPath) ? readFileSync(lockPath).toString() : undefined)
  const pins = { ipcRef: `v${version}`, ipcSha: sha ?? "" }

  let unresolved = 0
  for (const entry of inspectManaged({ cwd, packageRoot, pins })) {
    if (entry.state === "current") {
      io.out(`current  ${entry.to}\n`)
      continue
    }
    const unpinned = entry.wanted.includes("@ # ")
    if (entry.state === "missing") {
      if (apply && !unpinned) {
        mkdirSync(path.dirname(path.join(cwd, entry.to)), { recursive: true })
        writeFileSync(path.join(cwd, entry.to), entry.wanted)
        io.out(`written  ${entry.to}\n`)
        continue
      }
      io.out(
        `missing  ${entry.to}${unpinned ? " (no commit of internal-package-contract to pin it to: run npm install, then sync again)" : ""}\n`,
      )
      unresolved += 1
      continue
    }
    io.out(`drifted  ${entry.to}\n${unifiedDiff(entry.wanted, entry.have)}`)
    if (apply && update) {
      writeFileSync(path.join(cwd, entry.to), entry.wanted)
      io.out(`updated  ${entry.to}\n`)
    } else {
      unresolved += 1
    }
  }
  if (unresolved > 0) {
    io.out(
      apply
        ? "Drifted files were left as they are; add --update to replace them with the standard's.\n"
        : "Run `internal-package-contract sync --apply` to write missing files, and add --update to replace drifted ones.\n",
    )
    return 1
  }
  return 0
}
