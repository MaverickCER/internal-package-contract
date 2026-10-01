// Environment, git and package-size metadata for a results file. Best-effort: anything that cannot be
// determined on this platform is `null`, never a thrown error.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"

function physicalCores() {
  try {
    if (process.platform === "darwin") {
      return parseInt(
        execFileSync("sysctl", ["-n", "hw.physicalcpu"], { encoding: "utf8" }).trim(),
        10,
      )
    }
    if (process.platform === "linux") {
      const ids = new Set()
      let physicalId = "0"
      for (const line of readFileSync("/proc/cpuinfo", "utf8").split("\n")) {
        if (line.startsWith("physical id")) physicalId = line.split(":")[1]?.trim() ?? "0"
        if (line.startsWith("core id")) ids.add(`${physicalId}:${line.split(":")[1]?.trim()}`)
      }
      return ids.size || null
    }
  } catch {
    return null
  }
  return null
}

/** @returns {object} the machine this run executed on. */
export function collectEnvironment() {
  const cpus = os.cpus()
  return {
    cpuModel: cpus[0]?.model ?? null,
    processArch: process.arch,
    logicalCores: cpus.length,
    physicalCores: physicalCores(),
    platform: process.platform,
    osRelease: os.release(),
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    nodeVersion: process.version,
    isCI: Boolean(process.env["CI"]),
    runner: process.env["GITHUB_ACTIONS"]
      ? "GitHub Actions"
      : process.env["CI"]
        ? "CI (unspecified)"
        : "local",
  }
}

/**
 * @param {string} root - the repository root.
 * @returns {{ gitCommit: string | null, gitBranch: string | null, gitDirty: boolean | null }}
 */
export function collectGit(root) {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
    } catch {
      return null
    }
  }
  const status = run(["status", "--porcelain"])
  return {
    gitCommit: run(["rev-parse", "HEAD"]),
    gitBranch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    gitDirty: status === null ? null : status.length > 0,
  }
}

/**
 * Raw and gzip size of each shipped entry file -- context for the cost report (bytes shipped are bytes
 * parsed at every cold start), not a benchmark in itself.
 * @param {string} root - the repository root.
 * @param {readonly string[]} files - repo-relative files to measure.
 * @returns {Record<string, { bytes: number | null, gzipBytes: number | null }>}
 */
export function collectBundleSizes(root, files) {
  return Object.fromEntries(
    files.map((file) => {
      const filePath = path.join(root, file)
      if (!existsSync(filePath)) return [file, { bytes: null, gzipBytes: null }]
      const content = readFileSync(filePath)
      return [file, { bytes: content.length, gzipBytes: gzipSync(content).length }]
    }),
  )
}
