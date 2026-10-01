import { beforeEach, describe, expect, it, vi } from "vitest"
import { resolveOwnerRepo } from "../scripts/github-repo.mjs"
import { isCiEnvironment, socketGuidance } from "../checks/socket-guidance.js"
import type { SocketProblem } from "../checks/socket-guidance.js"

vi.mock("../scripts/github-repo.mjs", () => ({ resolveOwnerRepo: vi.fn() }))

const REPO = { owner: "MaverickCER", repo: "data-cap" }
const SECRETS = "https://github.com/MaverickCER/data-cap/settings/secrets/actions"

describe("isCiEnvironment()", () => {
  it("is true for a truthy CI value or GitHub Actions", () => {
    expect(isCiEnvironment({ CI: "true" })).toBe(true)
    expect(isCiEnvironment({ CI: "1" })).toBe(true)
    expect(isCiEnvironment({ GITHUB_ACTIONS: "true" })).toBe(true)
    expect(isCiEnvironment({ CI: "false", GITHUB_ACTIONS: "true" })).toBe(true)
  })
  it("is false for empty, false, 0, unset or non-true GITHUB_ACTIONS", () => {
    expect(isCiEnvironment({})).toBe(false)
    expect(isCiEnvironment({ CI: "" })).toBe(false)
    expect(isCiEnvironment({ CI: "false" })).toBe(false)
    expect(isCiEnvironment({ CI: "0" })).toBe(false)
    expect(isCiEnvironment({ GITHUB_ACTIONS: "false" })).toBe(false)
  })
})

const mockedResolve = vi.mocked(resolveOwnerRepo)

describe("socketGuidance()", () => {
  beforeEach(() => mockedResolve.mockReset())

  const local = (problem: SocketProblem) => socketGuidance(problem, {}, REPO)
  const ci = (problem: SocketProblem) => socketGuidance(problem, { CI: "true" }, REPO)

  it("local, not signed in: exact sign-in steps", () => {
    expect(local("not-authenticated")).toBe(
      [
        "Socket scan could not run: you are not signed in to Socket on this machine.",
        "  1. Sign in: `socket login` (opens your browser).",
        "  2. Confirm with `socket config list` that `apiToken` is set and `defaultOrg` is your organization.",
        "  3. Re-run `npm run contract`.",
        "This check never passes without a scan.",
      ].join("\n"),
    )
  })

  it("CI, no token: exact secret setup steps with a direct link to this repo's secrets page", () => {
    expect(ci("not-authenticated")).toBe(
      [
        "Socket scan could not run: no Socket API token is available to this CI run.",
        "  1. Create a Socket API token at socket.dev (Settings > API Tokens) with the `packages:list` permission.",
        `  2. Add it to GitHub as a repository secret named SOCKET_SECURITY_API_KEY: ${SECRETS} (Settings > Secrets and variables > Actions > New repository secret). For several repositories, add it once as an organization secret instead.`,
        "  3. Make sure the workflow step that runs the contract maps it: `env:` / `SOCKET_SECURITY_API_KEY: ${{ secrets.SOCKET_SECURITY_API_KEY }}`.",
        "This check never passes without a scan.",
      ].join("\n"),
    )
  })

  it("local, CLI missing: install then sign in", () => {
    const text = local("cli-not-installed")
    expect(text).toContain("the `socket` CLI is not installed")
    expect(text).toContain("1. Install it: `npm install --global @socketsecurity/cli`.")
    expect(text).toContain("2. Sign in: `socket login`")
    expect(text).not.toContain("SOCKET_SECURITY_API_KEY")
  })

  it("CI, CLI missing: install in the workflow, then the secret steps", () => {
    const text = ci("cli-not-installed")
    expect(text).toContain("1. Install it in the workflow before the contract step:")
    expect(text).toContain(SECRETS)
    expect(text).not.toContain("socket login")
  })

  it("token rejected differs between CI and local", () => {
    expect(local("token-rejected")).toContain(
      "1. Sign in again: `socket logout` then `socket login`.",
    )
    expect(local("token-rejected")).toContain("SOCKET_CLI_API_TOKEN")
    expect(ci("token-rejected")).toContain("Replace the SOCKET_SECURITY_API_KEY secret")
    expect(ci("token-rejected")).toContain(SECRETS)
    expect(ci("token-rejected")).not.toContain("socket logout")
  })

  it("network and rate limiting give environment-appropriate hints", () => {
    expect(local("network-unreachable")).toContain("this check has no offline mode")
    expect(ci("network-unreachable")).toContain("api.socket.dev")
    expect(local("rate-limited")).toContain("Wait a few minutes")
    expect(ci("rate-limited")).toContain("quota units")
  })

  it("resolves the repository from origin when none is passed, and falls back to a placeholder", () => {
    mockedResolve.mockReturnValue({ owner: "o", repo: "r" })
    expect(socketGuidance("not-authenticated", { CI: "true" })).toContain(
      "https://github.com/o/r/settings/secrets/actions",
    )
    mockedResolve.mockReturnValue(undefined)
    expect(socketGuidance("not-authenticated", { CI: "true" })).toContain(
      "https://github.com/<owner>/<repo>/settings/secrets/actions",
    )
  })
})
