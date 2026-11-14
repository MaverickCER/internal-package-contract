/**
 * Each baseline a branch changed without a release. `env` supplies `GITHUB_BASE_REF`, `GITHUB_HEAD_REF`,
 * `GITHUB_EVENT_PATH` and `GITHUB_REPOSITORY`. A version change on a `changeset-release/*` branch excuses
 * the edits, unless the event payload is a pull request whose head is in another repository.
 */
export function baselinesEditedWithoutRelease(input: {
  cwd: string
  version: string
  baselines: { path: string; versionFile: string; current: string | undefined }[]
  env?: Readonly<Record<string, string | undefined>>
}): { compared: boolean; edited: string[] }
