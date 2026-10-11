#!/usr/bin/env node
// Entry point for the `PackedConsumer` check (see checks/packed-consumer.ts), and the release build's
// last gate before a tarball is published. Takes the packed tarball, installs it into an empty project,
// and imports every entry point the way a consumer would. Prints one JSON envelope.
//
//   node check-packed-consumer.mjs [--tarball <file.tgz>] [--strict]
//
// Without `--tarball` it packs the package in the working directory. With `--strict` a problem is also a
// non-zero exit, which is what a release workflow wants; the contract check reads the envelope instead.

import { sync as spawnSync } from "cross-spawn"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  classifyFailure,
  entryPoints,
  missingFromTarball,
  promisedFiles,
  tarballFiles,
} from "./packed-consumer/plan.mjs"

const argv = process.argv.slice(2)
const strict = argv.includes("--strict")
const tarballFlag = argv.indexOf("--tarball")
const given = tarballFlag === -1 ? undefined : argv[tarballFlag + 1]

const cwd = process.cwd()
const manifest = JSON.parse(readFileSync(path.join(cwd, "package.json")).toString())
const work = mkdtempSync(path.join(tmpdir(), "ipc-packed-consumer-"))

function finish(report) {
  rmSync(work, { recursive: true, force: true })
  process.stdout.write(JSON.stringify({ ok: true, ...report }))
  process.exitCode = strict && report.state === "problem" ? 1 : 0
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options })
}

if (manifest.private === true) {
  finish({ state: "exempt" })
} else if (entryPoints(manifest).length === 0) {
  finish({ state: "none" })
} else {
  let tarball = given === undefined ? undefined : path.resolve(cwd, given)
  if (tarball === undefined) {
    const packed = run("npm", ["pack", "--ignore-scripts", "--pack-destination", work], { cwd })
    const name = packed.stdout.trim().split("\n").at(-1) ?? ""
    tarball = path.join(work, name)
  }
  if (!existsSync(tarball)) {
    finish({ state: "problem", problems: [`no tarball to check at ${tarball}.`], skipped: [] })
  } else {
    const packedFiles = tarballFiles(readFileSync(tarball))
    const problems = missingFromTarball(promisedFiles(manifest), packedFiles).map(
      (file) => `${file} is promised by package.json but is not in the tarball.`,
    )

    const consumer = path.join(work, "consumer")
    mkdirSync(consumer)
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({ name: "consumer", private: true, type: "module" }),
    )
    const install = run(
      "npm",
      ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"],
      { cwd: consumer },
    )
    if (install.status !== 0) {
      finish({
        state: "install-failed",
        message: install.stderr.trim().split("\n").slice(-4).join("\n"),
        problems,
        skipped: [],
      })
    } else {
      const skipped = []
      const attempt = (specifier, mode, code) => {
        const result = run(process.execPath, code, { cwd: consumer })
        if (result.status === 0) return
        const verdict = classifyFailure(`${result.stderr}\n${result.stdout}`, manifest)
        if (verdict.kind === "peer") {
          skipped.push(`${specifier} (${mode}) needs the peer dependency ${verdict.peer}.`)
        } else {
          problems.push(`${specifier} (${mode}) failed: ${verdict.reason}`)
        }
      }
      for (const { specifier, require, json } of entryPoints(manifest)) {
        const load = json
          ? 'await import(process.argv.at(-1), { with: { type: "json" } })'
          : "await import(process.argv.at(-1))"
        attempt(specifier, "import", ["--input-type=module", "-e", load, specifier])
        if (require) {
          attempt(specifier, "require", ["-e", "require(process.argv.at(-1))", specifier])
        }
      }
      finish({
        state: problems.length === 0 ? "verified" : "problem",
        checked: entryPoints(manifest).length,
        problems,
        skipped,
      })
    }
  }
}
