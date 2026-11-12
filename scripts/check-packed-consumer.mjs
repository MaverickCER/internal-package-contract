#!/usr/bin/env node
// Entry point for the `PackedConsumer` check (see checks/packed-consumer.ts). Takes the packed tarball,
// installs it into an empty project under the temporary directory, and imports every entry point the way
// a consumer would, `require`-ing the ones whose export map promises CommonJS. It also lists every file
// package.json promises that the tarball lacks (scripts/packed-consumer/plan.mjs). Prints one JSON
// envelope; the policy decides the verdict.
//
//   node check-packed-consumer.mjs [--tarball <file.tgz>] [--strict]
//
// Without `--tarball` it packs the package in the working directory with install scripts off. A private
// package is `exempt`, and a package with no entry point is `none`. An entry that fails only because a
// declared peer dependency is absent is listed as skipped, not as a problem. An install that fails is
// `install-failed`, which the policy records as the `PackedConsumer:install` degradation.
//
// With `--strict`, a `problem` or `install-failed` state is also a non-zero exit. The shared release
// workflow runs it that way on the tarball it is about to publish, so a broken package stops there.

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
  // Under --strict (the release build job) a tarball that cannot even be installed is as much a
  // failure as one whose entry points break; only `exempt` and `none` and a clean `ok` exit 0.
  process.exitCode =
    strict && (report.state === "problem" || report.state === "install-failed") ? 1 : 0
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
