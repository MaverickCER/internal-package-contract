import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os, { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { gzipSync } from "node:zlib"
import {
  collectBundleSizes,
  collectEnvironment,
  describeEnvironment,
  gitState,
  physicalCores,
} from "../scripts/benchmark/kit/environment.mjs"

type Exec = (command: string, args: string[], options: object) => string
type Read = (file: string, encoding: string) => string
const never = (): never => {
  throw new Error("should not be called")
}

describe("physicalCores()", () => {
  it("asks sysctl on macOS and reads the number, trimmed", () => {
    const calls: unknown[][] = []
    const exec: Exec = (...args) => {
      calls.push(args)
      return " 10 \n"
    }
    expect(physicalCores("darwin", exec, never)).toBe(10)
    expect(calls).toEqual([["sysctl", ["-n", "hw.physicalcpu"], { encoding: "utf8" }]])
  })

  it("is null when sysctl fails, and does not read cpuinfo on macOS", () => {
    expect(
      physicalCores(
        "darwin",
        () => {
          throw new Error("no sysctl")
        },
        never,
      ),
    ).toBeNull()
  })

  it("counts distinct physical-id/core-id pairs from /proc/cpuinfo on Linux", () => {
    const reads: unknown[][] = []
    const read: Read = (...args) => {
      reads.push(args)
      return [
        "processor\t: 0",
        "physical id\t: 0",
        "core id\t\t: 0",
        "processor\t: 1",
        "physical id\t: 0",
        "core id\t\t: 1",
        "processor\t: 2",
        "physical id\t: 1",
        "core id\t\t: 0",
        "processor\t: 3",
        "physical id\t: 1",
        "core id\t\t: 0",
        "",
      ].join("\n")
    }
    expect(physicalCores("linux", never, read)).toBe(3)
    expect(reads).toEqual([["/proc/cpuinfo", "utf8"]])
  })

  it("treats a missing physical id as 0, and counts the same core id once per package", () => {
    expect(physicalCores("linux", never, () => "core id: 0\ncore id: 1\ncore id: 1\n")).toBe(2)
    expect(
      physicalCores(
        "linux",
        never,
        () => "physical id : 0\ncore id : 0\nphysical id : 1\ncore id : 0\n",
      ),
    ).toBe(2)
    expect(
      physicalCores(
        "linux",
        never,
        () => "physical id : 3 \ncore id : 7 \nphysical id : 3\ncore id : 7\n",
      ),
    ).toBe(1)
  })

  it("does not read cpuinfo on a platform other than Linux, even if it could", () => {
    expect(physicalCores("win32", never, () => "core id: 0\n")).toBeNull()
    expect(physicalCores("freebsd", never, () => "core id: 0\n")).toBeNull()
  })

  it("uses 0 as the physical id until one is seen, and again when a line gives none", () => {
    expect(physicalCores("linux", never, () => "core id: 0\nphysical id: 0\ncore id: 0\n")).toBe(1)
    expect(physicalCores("linux", never, () => "core id: 0\nphysical id\ncore id: 0\n")).toBe(1)
  })

  it("survives lines with no colon", () => {
    expect(physicalCores("linux", never, () => "physical id\ncore id\ncore id\n")).toBe(1)
    expect(physicalCores("linux", never, () => "physical id\ncore id: 4\n")).toBe(1)
  })

  it("ignores lines that merely contain the keys", () => {
    expect(physicalCores("linux", never, () => "not physical id: 9\nnot core id: 9\n")).toBeNull()
  })

  it("is null when there are no core ids, when the read fails, and on any other platform", () => {
    expect(physicalCores("linux", never, () => "processor : 0\n")).toBeNull()
    expect(physicalCores("linux", never, () => "")).toBeNull()
    expect(
      physicalCores("linux", never, () => {
        throw new Error("no proc")
      }),
    ).toBeNull()
    expect(physicalCores("win32", never, never)).toBeNull()
    expect(physicalCores("", never, never)).toBeNull()
  })
})

describe("describeEnvironment()", () => {
  const system = {
    cpus: [{ model: "Fast CPU" }, { model: "Fast CPU" }, { model: "Fast CPU" }],
    arch: "arm64",
    physicalCores: 2,
    platform: "darwin",
    release: "25.0.0",
    totalMemoryBytes: 8 * 1024 * 1024 * 1024,
    nodeVersion: "v22.1.0",
    env: {},
  }

  it("describes the machine from what it was given", () => {
    expect(describeEnvironment(system)).toEqual({
      cpuModel: "Fast CPU",
      processArch: "arm64",
      logicalCores: 3,
      physicalCores: 2,
      platform: "darwin",
      osRelease: "25.0.0",
      totalMemoryMb: 8192,
      nodeVersion: "v22.1.0",
      isCI: false,
      runner: "local",
    })
  })

  it("has no CPU model when there are no CPUs, and no physical core count when it is unknown", () => {
    expect(describeEnvironment({ ...system, cpus: [], physicalCores: null })).toMatchObject({
      cpuModel: null,
      logicalCores: 0,
      physicalCores: null,
    })
    expect(describeEnvironment({ ...system, cpus: [{}] }).cpuModel).toBeNull()
  })

  it("rounds memory to the nearest megabyte", () => {
    const mb = 1024 * 1024
    expect(
      describeEnvironment({ ...system, totalMemoryBytes: 3 * mb + mb / 2 }).totalMemoryMb,
    ).toBe(4)
    expect(
      describeEnvironment({ ...system, totalMemoryBytes: 3 * mb + mb / 4 }).totalMemoryMb,
    ).toBe(3)
    expect(describeEnvironment({ ...system, totalMemoryBytes: 5 * mb }).totalMemoryMb).toBe(5)
  })

  it("names the runner from the environment", () => {
    const of = (env: Record<string, string | undefined>) => {
      const { isCI, runner } = describeEnvironment({ ...system, env })
      return { isCI, runner }
    }
    expect(of({})).toEqual({ isCI: false, runner: "local" })
    expect(of({ CI: "true" })).toEqual({ isCI: true, runner: "CI (unspecified)" })
    expect(of({ CI: "true", GITHUB_ACTIONS: "true" })).toEqual({
      isCI: true,
      runner: "GitHub Actions",
    })
    expect(of({ GITHUB_ACTIONS: "true" })).toEqual({ isCI: false, runner: "GitHub Actions" })
    expect(of({ CI: "", GITHUB_ACTIONS: "" })).toEqual({ isCI: false, runner: "local" })
    expect(of({ CI: "true", GITHUB_ACTIONS: "" })).toEqual({
      isCI: true,
      runner: "CI (unspecified)",
    })
  })
})

describe("collectEnvironment()", () => {
  it("describes this machine", () => {
    const environment = collectEnvironment()
    expect(environment.processArch).toBe(process.arch)
    expect(environment.platform).toBe(process.platform)
    expect(environment.nodeVersion).toBe(process.version)
    expect(environment.osRelease).toBe(os.release())
    expect(environment.logicalCores).toBe(os.cpus().length)
    expect(Math.abs(environment.totalMemoryMb - os.totalmem() / (1024 * 1024))).toBeLessThanOrEqual(
      0.5,
    )
    expect(environment.cpuModel).toBe(os.cpus()[0]?.model ?? null)
    expect(environment.isCI).toBe(Boolean(process.env["CI"]))
    expect(environment.physicalCores === null || environment.physicalCores > 0).toBe(true)
  })
})

describe("gitState()", () => {
  const record = (replies: (args: string[]) => string) => {
    const calls: { command: string; args: string[]; options: unknown }[] = []
    const exec: Exec = (command, args, options) => {
      calls.push({ command, args, options })
      return replies(args)
    }
    return { calls, exec }
  }

  it("asks git for the commit, branch and status, quietly, in the given folder", () => {
    const { calls, exec } = record((args) =>
      args[0] === "status" ? "" : `out-${args.join("-")}\n`,
    )
    expect(gitState("/repo", exec)).toEqual({
      gitCommit: "out-rev-parse-HEAD",
      gitBranch: "out-rev-parse---abbrev-ref-HEAD",
      gitDirty: false,
    })
    const options = { cwd: "/repo", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    expect(calls.map((call) => call.command)).toEqual(["git", "git", "git"])
    for (const call of calls) expect(call.options).toEqual(options)
    expect(calls[0]?.args).toEqual([
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
    expect(calls[1]?.args).toEqual(["rev-parse", "HEAD"])
    expect(calls[2]?.args).toEqual(["rev-parse", "--abbrev-ref", "HEAD"])
  })

  it("is dirty exactly when status prints something, and unknown when it fails", () => {
    expect(
      gitState("/r", record((args) => (args[0] === "status" ? " M a.ts\n" : "x\n")).exec).gitDirty,
    ).toBe(true)
    expect(
      gitState("/r", record((args) => (args[0] === "status" ? "\n" : "x\n")).exec).gitDirty,
    ).toBe(false)
    const failing: Exec = (_command, args) => {
      if (args[0] === "status") throw new Error("no repo")
      return "x\n"
    }
    expect(gitState("/r", failing)).toEqual({ gitCommit: "x", gitBranch: "x", gitDirty: null })
    const allFail: Exec = () => {
      throw new Error("no git")
    }
    expect(gitState("/r", allFail)).toEqual({ gitCommit: null, gitBranch: null, gitDirty: null })
  })
})

describe("collectBundleSizes()", () => {
  const roots: string[] = []
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it("measures raw and gzip bytes per file, with nulls for a missing one", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-sizes-"))
    roots.push(root)
    mkdirSync(path.join(root, "dist"))
    const content = "export const x = 1\n".repeat(50)
    writeFileSync(path.join(root, "dist/index.js"), content)
    expect(collectBundleSizes(root, ["dist/index.js", "dist/missing.js"])).toEqual({
      "dist/index.js": {
        bytes: Buffer.byteLength(content),
        gzipBytes: gzipSync(Buffer.from(content)).length,
      },
      "dist/missing.js": { bytes: null, gzipBytes: null },
    })
    expect(collectBundleSizes(root, [])).toEqual({})
  })
})
