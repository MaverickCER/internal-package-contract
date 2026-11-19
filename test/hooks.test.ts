import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const hooks = path.resolve(import.meta.dirname, "../hooks")
const read = (name: string): string => readFileSync(path.join(hooks, name), "utf8")

/**
 * Runs a hook with `npm` and `node` replaced by stubs that print their arguments, from a directory outside any
 * repository, so the hook's own command line is what is observed.
 */
const commandOf = (hook: string, env: Record<string, string> = {}): string => {
  const stubs = mkdtempSync(path.join(tmpdir(), "ipc-hook-stubs-"))
  // pre-commit sets IPC_HOOK_FULL=1 before it runs the contract, and so these tests. Only `env` may set it here.
  const inherited = { ...process.env }
  delete inherited["IPC_HOOK_FULL"]
  try {
    for (const name of ["npm", "node"]) {
      writeFileSync(path.join(stubs, name), `#!/bin/sh\necho "${name} $*"\n`)
      chmodSync(path.join(stubs, name), 0o755)
    }
    const result = spawnSync("sh", [path.join(hooks, hook)], {
      cwd: stubs,
      encoding: "utf8",
      env: {
        ...inherited,
        ...env,
        PATH: `${stubs}${path.delimiter}${process.env["PATH"] ?? ""}`,
      },
    })
    return result.stdout.trim()
  } finally {
    rmSync(stubs, { recursive: true, force: true })
  }
}

describe("bundled git hooks", () => {
  it("hands a commit to pre-push with IPC_HOOK_FULL=1, and names no checks of its own", () => {
    const hook = read("pre-commit")
    expect(hook).toMatch(/IPC_HOOK_FULL=1 exec "\$DIR\/pre-push"/)
    expect(hook).not.toMatch(/--skip|--checks/)
  })
  it.skipIf(process.platform === "win32")(
    "runs the contract the change can reach before a commit, slow analyses included",
    () => {
      expect(commandOf("pre-commit")).toMatch(/ --scope affected$/)
    },
  )
  it.skipIf(process.platform === "win32")(
    "runs everything but the slow analyses before a push, and the affected scope only when asked",
    () => {
      expect(commandOf("pre-push")).toMatch(/ --skip Coverage,Crap,Mutation$/)
      expect(commandOf("pre-push", { IPC_HOOK_FULL: "1" })).toMatch(/ --scope affected$/)
      expect(commandOf("pre-push", { IPC_HOOK_FULL: "true" })).toMatch(
        / --skip Coverage,Crap,Mutation$/,
      )
    },
  )
  it("lets the shared runner replace the skip list with the affected scope only when asked for the full contract", () => {
    const push = read("pre-push")
    expect(push).toContain('[ "${IPC_HOOK_FULL:-}" = "1" ]')
    expect(push.match(/--skip Coverage,Crap,Mutation/g)).toHaveLength(1)
    expect(push).toContain('SKIP="--skip Coverage,Crap,Mutation"')
    expect(push).toContain('SKIP="--scope affected"')
  })
  it("skip only the slow analyses, which CI runs", () => {
    expect(read("pre-push")).toContain('SKIP="--skip Coverage,Crap,Mutation"')
    expect(read("pre-push")).not.toMatch(/SKIP="[^"\n]*(Lint|Format|Tests|SecuritySocket)/)
  })
  it("hands the contract no repository location, so its tests' own repositories are not the one being committed", () => {
    const push = read("pre-push")
    expect(push).toContain("unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE")
    // Before anything that runs the contract.
    expect(push.indexOf("unset GIT_INDEX_FILE")).toBeLessThan(push.indexOf("exec npm"))
    expect(push.indexOf("unset GIT_INDEX_FILE")).toBeLessThan(push.indexOf('exec node "$DIR'))
  })
  it.skipIf(process.platform === "win32")("are executable", () => {
    for (const name of ["pre-commit", "pre-push", "commit-msg"]) {
      expect(statSync(path.join(hooks, name)).mode & 0o111, name).not.toBe(0)
    }
  })
})
