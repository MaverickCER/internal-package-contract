import { spawnSync } from "node:child_process"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  COMMANDS,
  commandHelp,
  helpText,
  nearest,
  unknownCommand,
  wantsHelp,
} from "../scripts/contract-help.mjs"

const bin = path.resolve(import.meta.dirname, "../bin/contract.mjs")

describe("wantsHelp", () => {
  it("is true for --help or -h anywhere, and for nothing else", () => {
    expect(wantsHelp(["--help"])).toBe(true)
    expect(wantsHelp(["--checks", "a", "-h"])).toBe(true)
    expect(wantsHelp(["--checks", "a"])).toBe(false)
    expect(wantsHelp([])).toBe(false)
  })
  it("does not take the value of an init option for a request for help", () => {
    expect(wantsHelp(["init", "--name", "demo", "--description", "-h"])).toBe(false)
    expect(wantsHelp(["init", "--owner", "--help"])).toBe(false)
    expect(wantsHelp(["init", "--name", "-h"])).toBe(false)
    expect(wantsHelp(["init", "--force", "-h"])).toBe(true)
    expect(wantsHelp(["init", "--name=demo", "--help"])).toBe(true)
    expect(wantsHelp(["--checks", "-h"])).toBe(true)
    expect(wantsHelp(["sync", "--name", "-h"])).toBe(true)
  })
})

describe("helpText", () => {
  it("documents every subcommand and flag the dispatcher accepts", () => {
    const text = helpText()
    for (const word of [
      "init",
      "doctor",
      "exceptions",
      "sync-benchmark-guides",
      "update-baseline",
      "install-hooks",
      "site",
      "sync",
      "add",
      "new",
      "generate",
      "promote",
      "upgrade",
      "--changed",
      "--json",
      "--logs",
      "--checks",
      "--skip",
      "--strict",
      "--no-strict",
      "--help",
    ]) {
      expect(text).toContain(word)
    }
    expect(text.startsWith("Usage: internal-package-contract")).toBe(true)
    expect(text.endsWith("\n")).toBe(true)
  })
})

describe("bin/contract.mjs --help", () => {
  it("prints the usage and exits 0 without running any check, from any directory", () => {
    const result = spawnSync(process.execPath, [bin, "--help"], {
      cwd: path.dirname(bin),
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(helpText())
    expect(result.stderr).toBe("")
  })
  it("answers -h after a subcommand with that command's own page, without running it", () => {
    const result = spawnSync(process.execPath, [bin, "init", "-h"], {
      cwd: path.dirname(bin),
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(commandHelp("init"))
    expect(result.stdout.startsWith("Usage: internal-package-contract init")).toBe(true)
  })
  it("answers --help after an option with the overview", () => {
    const result = spawnSync(process.execPath, [bin, "--checks", "Lint", "--help"], {
      cwd: path.dirname(bin),
      encoding: "utf8",
      timeout: 20_000,
    })
    expect(result.stdout).toBe(helpText())
  })
})

describe("the command table", () => {
  it("groups every command, and lists each exactly once in the overview", () => {
    const text = helpText()
    for (const group of ["Start:", "Daily:", "Maintain:"]) expect(text).toContain(`\n${group}\n`)
    for (const command of COMMANDS) {
      expect(text.split("\n").filter((line) => line.startsWith(`  ${command.name} `))).toHaveLength(
        1,
      )
    }
    expect(new Set(COMMANDS.map((command) => command.name)).size).toBe(COMMANDS.length)
  })
  it("gives each command a page with its usage, what it does and its options", () => {
    for (const command of COMMANDS) {
      const page = commandHelp(command.name)
      expect(page?.startsWith(`Usage: internal-package-contract ${command.usage}\n\n`)).toBe(true)
      expect(page).toContain(command.details)
      for (const [option, text] of command.options ?? []) {
        expect(page).toContain(option)
        expect(page).toContain(text)
      }
      expect(page?.endsWith("\n")).toBe(true)
    }
    expect(commandHelp("init")).toContain("\nOptions:\n")
    expect(commandHelp("doctor")).not.toContain("Options:")
  })
  it("has no page for something that is not a command", () => {
    expect(commandHelp("nope")).toBeUndefined()
    expect(commandHelp(undefined)).toBeUndefined()
  })
})

describe("unknownCommand", () => {
  it("says nothing for a command, an option, or no arguments", () => {
    for (const argv of [
      [],
      ["doctor"],
      ["init", "--name", "x"],
      ["--checks", "Lint"],
      ["--json"],
    ]) {
      expect(unknownCommand(argv)).toBeUndefined()
    }
  })

  it("rejects a word that is neither, and suggests the nearest command when one is close", () => {
    expect(unknownCommand(["doctr"])).toContain('"doctr" is not a command. Did you mean `doctor`?')
    expect(unknownCommand(["upgarde"])).toContain("Did you mean `upgrade`?")
  })

  it("does not guess when nothing is close", () => {
    expect(unknownCommand(["zzzzzzzzzz"])).toBe(
      'internal-package-contract: "zzzzzzzzzz" is not a command. Run `internal-package-contract --help` to see them.\n',
    )
  })

  it("treats the run itself, which has no name to type, as no command and never suggests it", () => {
    const message = unknownCommand(["(none)"]) ?? ""
    expect(message).toContain('"(none)" is not a command.')
    expect(message).not.toContain("`(none)`")
    expect(unknownCommand(["(non"]) ?? "").not.toContain("`(none)`")
  })
})

describe("the entry point on a mistyped command", () => {
  it("stops at once with exit code 1 instead of starting the contract", () => {
    const result = spawnSync("node", [bin, "doctr"], { encoding: "utf8", timeout: 20_000 })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Did you mean `doctor`?")
    expect(result.stdout).toBe("")
  })
})

describe("nearest", () => {
  it("returns the closest name within three edits, ignoring case, and nothing otherwise", () => {
    expect(nearest("LINT", ["Format", "Lint"])).toBe("Lint")
    expect(nearest("Lnt", ["Lint"])).toBe("Lint")
    expect(nearest("abcdefgh", ["Lint"])).toBeUndefined()
    expect(nearest("x", [])).toBeUndefined()
    expect(nearest("abcd", ["abcdefg"])).toBe("abcdefg")
    expect(nearest("abcd", ["abcdefgh"])).toBeUndefined()
    expect(nearest("kitten", ["sitting"])).toBe("sitting")
  })
})

describe("the entry point on a mistyped check", () => {
  it("fails in one line, before building anything", () => {
    const result = spawnSync("node", [bin, "--checks", "Lnt"], {
      encoding: "utf8",
      timeout: 60_000,
      cwd: import.meta.dirname,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown check "Lnt". Did you mean Lint?')
    expect(result.stderr).not.toContain("    at ")
  })
})
