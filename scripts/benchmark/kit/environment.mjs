// Environment, git and package-size metadata for a results file. Best-effort: anything that cannot be
// determined on this platform is `null`, never a thrown error.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"

/**
 * @param {string} platform - `process.platform`.
 * @param {(command: string, args: string[], options: object) => string} exec - runs a command, like `execFileSync`.
 * @param {(file: string, encoding: string) => string} read - reads a text file, like `readFileSync`.
 * @returns {number | null} the number of physical cores, or `null` where it cannot be determined.
 */
export function physicalCores(platform, exec, read) {
  try {
    if (platform === "darwin") {
      return parseInt(exec("sysctl", ["-n", "hw.physicalcpu"], { encoding: "utf8" }), 10)
    }
    if (platform === "linux") {
      const ids = new Set()
      let physicalId = "0"
      for (const line of read("/proc/cpuinfo", "utf8").split("\n")) {
        if (line.startsWith("physical id")) physicalId = line.split(":")[1]?.trim() ?? "0"
        if (line.startsWith("core id")) ids.add(`${physicalId}:${line.split(":")[1]?.trim()}`)
      }
      return ids.size || null
    }
  } catch {
    // Best effort: a machine that will not say is reported as unknown, below.
  }
  return null
}

/**
 * @typedef {object} System
 * @property {readonly { model?: string }[]} cpus - `os.cpus()`.
 * @property {string} arch - `process.arch`.
 * @property {number | null} physicalCores - see {@link physicalCores}.
 * @property {string} platform - `process.platform`.
 * @property {string} release - `os.release()`.
 * @property {number} totalMemoryBytes - `os.totalmem()`.
 * @property {string} nodeVersion - `process.version`.
 * @property {Readonly<Record<string, string | undefined>>} env - `process.env`.
 */

/**
 * @param {System} system - the machine and process to describe.
 * @returns {object} the machine this run executed on.
 */
export function describeEnvironment(system) {
  return {
    cpuModel: system.cpus[0]?.model ?? null,
    processArch: system.arch,
    logicalCores: system.cpus.length,
    physicalCores: system.physicalCores,
    platform: system.platform,
    osRelease: system.release,
    totalMemoryMb: Math.round(system.totalMemoryBytes / (1024 * 1024)),
    nodeVersion: system.nodeVersion,
    isCI: Boolean(system.env["CI"]),
    runner: system.env["GITHUB_ACTIONS"]
      ? "GitHub Actions"
      : system.env["CI"]
        ? "CI (unspecified)"
        : "local",
  }
}

/** @returns {object} the machine this run executed on. */
export function collectEnvironment() {
  return describeEnvironment({
    cpus: os.cpus(),
    arch: process.arch,
    physicalCores: physicalCores(process.platform, execFileSync, readFileSync),
    platform: process.platform,
    release: os.release(),
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    env: process.env,
  })
}

/**
 * @param {string} root - the repository root.
 * @returns {{ gitCommit: string | null, gitBranch: string | null, gitDirty: boolean | null }}
 */
export function collectGit(root) {
  return gitState(root, execFileSync)
}

/**
 * @param {string} root - the repository root.
 * @param {(command: string, args: string[], options: object) => string} exec - runs a command, like `execFileSync`.
 * @returns {{ gitCommit: string | null, gitBranch: string | null, gitDirty: boolean | null }}
 */
export function gitState(root, exec) {
  const run = (args) => {
    try {
      return exec("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
    } catch {
      return null
    }
  }
  // The benchmark's own outputs are written into the tree before the next suite starts, so they must
  // not make the tree "dirty": `gitDirty` means the CODE under test had uncommitted changes.
  const status = run([
    "status",
    "--porcelain",
    "--",
    ".",
    ":(exclude)**/results.json",
    ":(exclude)**/BENCHMARKS.md",
    ":(exclude)**/history/**",
    ":(exclude)reports/**",
    ":(exclude)docs/benchmarks/**",
  ])
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
