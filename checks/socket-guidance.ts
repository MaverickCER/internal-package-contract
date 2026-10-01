/**
 * The exact steps a contributor needs when the Socket scan cannot run, chosen at the moment of
 * failure from two facts: WHERE the contract is running (CI vs a developer machine) and WHY Socket
 * could not be reached. Printing every possible remedy would bury the one that applies.
 */
import { resolveOwnerRepo } from "../scripts/github-repo.mjs"

/** Why the Socket scan could not produce a result. */
export type SocketProblem =
  | "cli-not-installed"
  | "not-authenticated"
  | "token-rejected"
  | "network-unreachable"
  | "rate-limited"

/** Whether `env` describes a CI run (`CI` set to a truthy value, or GitHub Actions). */
export function isCiEnvironment(env: Readonly<Record<string, string | undefined>>): boolean {
  const ci = env["CI"]
  return (
    (ci !== undefined && ci !== "" && ci !== "false" && ci !== "0") ||
    env["GITHUB_ACTIONS"] === "true"
  )
}

const TOKEN_STEPS = [
  "Create a Socket API token at socket.dev (Settings > API Tokens) with the `packages:list` permission.",
]

function ciSecretSteps(secretsUrl: string): readonly string[] {
  return [
    ...TOKEN_STEPS,
    `Add it to GitHub as a repository secret named SOCKET_SECURITY_API_KEY: ${secretsUrl} (Settings > Secrets and variables > Actions > New repository secret). For several repositories, add it once as an organization secret instead.`,
    "Make sure the workflow step that runs the contract maps it: `env:` / `SOCKET_SECURITY_API_KEY: ${{ secrets.SOCKET_SECURITY_API_KEY }}`.",
  ]
}

/**
 * @param problem - why Socket could not be used.
 * @param env - the environment to inspect for CI (`process.env`).
 * @param repo - the repository's GitHub owner/name, for a direct secrets link; resolved from `origin` when omitted.
 * @returns a rationale block: a one-line cause followed by numbered, environment-specific steps.
 */
export function socketGuidance(
  problem: SocketProblem,
  env: Readonly<Record<string, string | undefined>>,
  repo: { readonly owner: string; readonly repo: string } | undefined = resolveOwnerRepo(),
): string {
  const ci = isCiEnvironment(env)
  const secretsUrl = repo
    ? `https://github.com/${repo.owner}/${repo.repo}/settings/secrets/actions`
    : "https://github.com/<owner>/<repo>/settings/secrets/actions"

  let steps: readonly string[]
  let cause: string
  switch (problem) {
    case "cli-not-installed":
      cause = "the `socket` CLI is not installed"
      steps = ci
        ? [
            "Install it in the workflow before the contract step: `npm install --global @socketsecurity/cli` (or keep `@socketsecurity/cli` in devDependencies and run through `npx`).",
            ...ciSecretSteps(secretsUrl),
          ]
        : [
            "Install it: `npm install --global @socketsecurity/cli`.",
            "Sign in: `socket login` (opens your browser), then confirm with `socket config list` that `apiToken` is set.",
            "Re-run `npm run contract`.",
          ]
      break
    case "not-authenticated":
      cause = ci
        ? "no Socket API token is available to this CI run"
        : "you are not signed in to Socket on this machine"
      steps = ci
        ? ciSecretSteps(secretsUrl)
        : [
            "Sign in: `socket login` (opens your browser).",
            "Confirm with `socket config list` that `apiToken` is set and `defaultOrg` is your organization.",
            "Re-run `npm run contract`.",
          ]
      break
    case "token-rejected":
      cause = "Socket rejected the API token as invalid, expired or revoked"
      steps = ci
        ? [
            "Create a new Socket API token (socket.dev > Settings > API Tokens, `packages:list` permission).",
            `Replace the SOCKET_SECURITY_API_KEY secret with it: ${secretsUrl}`,
          ]
        : [
            "Sign in again: `socket logout` then `socket login`.",
            "If SOCKET_SECURITY_API_KEY or SOCKET_CLI_API_TOKEN is exported in your shell, unset it or replace it with a valid token.",
            "Re-run `npm run contract`.",
          ]
      break
    case "network-unreachable":
      cause = "the Socket API could not be reached"
      steps = [
        "Check your network connection, proxy and VPN, then re-run the contract.",
        ci
          ? "If this repeats in CI, check Socket's status page and that the runner may reach api.socket.dev."
          : "If you are offline, run the contract again once you are back online -- this check has no offline mode.",
      ]
      break
    case "rate-limited":
      cause = "Socket rate-limited or exhausted the quota of this API token"
      steps = [
        "Wait a few minutes and re-run the contract.",
        "If it keeps happening, check the token's quota in the Socket dashboard; a package score request costs quota units.",
      ]
      break
  }

  return [
    `Socket scan could not run: ${cause}.`,
    ...steps.map((step, index) => `  ${String(index + 1)}. ${step}`),
    "This check never passes without a scan.",
  ].join("\n")
}
