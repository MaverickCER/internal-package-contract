import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The release flow is what turns a merge into a version and a tag, so its shape is pinned here.
 *
 * Two facts it has to keep true:
 * - `changesets/action` is pinned to a real release, named exactly. The step outputs the flow reads
 *   (`pullRequestNumber`) exist only from v1.4.0; an older pin leaves them empty, so every step gated on
 *   them is silently skipped (the pin was once v1.0.0 behind a `# v1` comment).
 * - A person merges every release PR. Nothing in the flow merges one.
 */
const root = path.resolve(import.meta.dirname, "..")
const workflows = ["release.yml", "release-npm-changesets.yml"].map((name) => ({
  name,
  text: readFileSync(path.join(root, ".github/workflows", name), "utf8"),
}))

const PIN = /changesets\/action@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)\b/g

function atLeast(version: string, minimum: [number, number]): boolean {
  const [major = 0, minor = 0] = version.slice(1).split(".").map(Number)
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1])
}

describe("release workflows", () => {
  it("pin changesets/action to an exactly named release that sets the outputs the flow reads", () => {
    for (const { name, text } of workflows) {
      const uses = text.match(/changesets\/action@\S+.*/g) ?? []
      expect(uses, `${name} should use changesets/action once`).toHaveLength(1)
      const pins = [...text.matchAll(PIN)]
      expect(
        pins,
        `${name}: pin changesets/action by SHA with its exact tag, e.g. '# v1.9.0'`,
      ).toHaveLength(1)
      expect(
        atLeast(pins[0]?.[2] ?? "v0.0.0", [1, 4]),
        `${name}: pullRequestNumber needs >= v1.4.0`,
      ).toBe(true)
    }
  })

  it("use the same changesets/action commit in both workflows", () => {
    const pins = workflows.map(({ text }) =>
      [...text.matchAll(PIN)].map((match) => `${match[1]} ${match[2]}`),
    )
    expect(new Set(pins.flat()).size).toBe(1)
  })

  it("never merge a release PR", () => {
    for (const { name, text } of workflows) {
      expect(text, `${name} must not merge a release PR; a person does`).not.toMatch(/gh pr merge/)
    }
  })

  it("publish only from the default branch, and only a tarball the build job made", () => {
    const text = workflows.find((w) => w.name === "release-npm-changesets.yml")?.text ?? ""
    expect(text).toContain(
      "if: needs.build.outputs.should-publish == 'true' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    )
    expect(text).toContain('npm publish "$1" --provenance --access public --ignore-scripts')
  })

  it("tags and then creates a GitHub Release for the repository's own release, only when a new tag was made", () => {
    const text = workflows.find((w) => w.name === "release.yml")?.text ?? ""
    const tag = text.indexOf("- name: Tag the released version")
    const release = text.indexOf("- name: Create the GitHub Release")
    expect(tag).toBeGreaterThan(-1)
    expect(release).toBeGreaterThan(tag)
    const step = text.slice(release)
    expect(step).toContain("if: steps.tag.outputs.new-tag != ''")
    // A Release problem must not turn a tagged release red.
    expect(step).toContain("continue-on-error: true")
    expect(step).toContain('gh release create "$TAG" --verify-tag')
    // Re-running a release must not fail on a Release that already exists.
    expect(step).toContain('gh release view "$TAG"')
    expect(step).toContain("--generate-notes")
    expect(step).toContain("CHANGELOG.md")
  })

  it("keep the publishing identity out of every job but publish", () => {
    const text = workflows.find((w) => w.name === "release-npm-changesets.yml")?.text ?? ""
    const jobs = text.split(/\n {2}(?=[a-z-]+:\n {4}(?:needs|runs-on|if):)/)
    const withToken = jobs.filter((job) => /id-token:\s*write/.test(job))
    expect(withToken).toHaveLength(1)
    expect(withToken[0]).toMatch(/^publish:/)
  })

  it("creates a GitHub Release for the new tag from the published tarball's CHANGELOG, in the publish job only", () => {
    const text = workflows.find((w) => w.name === "release-npm-changesets.yml")?.text ?? ""
    const step = text.slice(text.indexOf("- name: Create the GitHub Release"))
    const body = step.slice(0, step.indexOf("\n      # Publishing succeeded"))

    // After the tag exists, and before the verification, which stays the last step of the job. The step
    // cannot fail the job, so a Release problem never skips the npm verification.
    expect(text.indexOf("- name: Create the GitHub Release")).toBeGreaterThan(
      text.indexOf("- name: Tag the release"),
    )
    expect(text.indexOf("- name: Create the GitHub Release")).toBeLessThan(
      text.indexOf("- name: Verify what npm now serves"),
    )
    expect(body).toContain("continue-on-error: true")
    expect(body).toContain('gh release create "v$VERSION" --verify-tag')
    // Notes come out of the tarball as data; nothing from it is executed.
    expect(body).toContain("tar -xzOf")
    expect(body).not.toMatch(/\bnode\b|\bnpm\b|\bnpx\b/)
    // Re-running a release must not fail on a Release that already exists.
    expect(body).toContain('gh release view "v$VERSION"')
    // A package without a CHANGELOG still gets notes.
    expect(body).toContain("--generate-notes")
    // Only the publish job holds a write token; the step must sit in it.
    const jobs = text.split(/\n {2}(?=[a-z-]+:\n {4}(?:needs|runs-on|if):)/)
    expect(jobs.filter((job) => job.includes("Create the GitHub Release"))).toHaveLength(1)
    expect(jobs.find((job) => job.includes("Create the GitHub Release"))).toContain(
      "id-token: write",
    )
  })

  it("ask the registry afterwards for the published version and its provenance", () => {
    const text = workflows.find((w) => w.name === "release-npm-changesets.yml")?.text ?? ""
    expect(text).toContain("name: ${{ steps.info.outputs.name }}")
    expect(text).toContain('echo "name=$NAME"\n            echo "version=$VERSION"')
    expect(text).toContain("- name: Verify what npm now serves")
    // Before the tarball is packed, so an unanswered prompt cannot reach the publish job.
    const prompts = text.indexOf("- name: Check that no prompt is left unanswered")
    expect(prompts).toBeGreaterThan(text.indexOf("- name: Verify\n"))
    expect(prompts).toBeLessThan(text.indexOf("- name: Pack the tarball to publish"))
    expect(text).toContain('IPC_RELEASE: "1"')
    expect(text).toContain("run: npx internal-package-contract --checks PromptBlocks")
    expect(text).toContain('npm view "$NAME@$VERSION" version')
    expect(text).toContain('npm view "$NAME@$VERSION" dist.attestations --json')
    // Bypasses npm's own cache, which can hold the package document from before the publish.
    expect(text).toContain(
      'npm view "$NAME@$VERSION" version --prefer-online --fetch-timeout=20000 --fetch-retries=0',
    )
    // A deadline, not an attempt count: a hanging query cannot stretch the wait past ten minutes.
    expect(text).toContain("deadline=$((SECONDS + 600))")
    expect(text).toContain('while [ "$SECONDS" -lt "$deadline" ]; do')
    // The verification is the last thing the publish job does.
    expect(
      text
        .trimEnd()
        .endsWith('echo "$NAME@$VERSION is served by npm with a provenance attestation."'),
    ).toBe(true)
  })

  it("imports the exact tarball in a clean project before it is uploaded for publishing", () => {
    const text = workflows.find((w) => w.name === "release-npm-changesets.yml")?.text ?? ""
    const gate = text.indexOf("- name: Install the tarball into a clean project and import it")
    expect(gate).toBeGreaterThan(text.indexOf("npm pack --ignore-scripts --pack-destination"))
    expect(gate).toBeLessThan(text.indexOf("name: release-tarball"))
    expect(text).toContain(
      'node node_modules/internal-package-contract/scripts/check-packed-consumer.mjs --strict --tarball "$1"',
    )
  })
})
