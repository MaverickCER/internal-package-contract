// The `add check <Name>` recipe: turns on an optional check (see checks/optional.ts) by naming it in
// package.json under "internal-package-contract", with the settings a check needs written out so they can be
// read and changed. Pure: it takes the file's text and returns the new text, or what is wrong.

import { OPTIONAL_SETTINGS } from "./optional-settings.mjs"

/**
 * @param {object} input
 * @param {string} input.name - the check to turn on.
 * @param {string | undefined} input.packageJson - package.json's text.
 * @returns {{ problems: string[], text?: string, already?: boolean }}
 */
export function planAddCheck({ name, packageJson }) {
  if (!Object.hasOwn(OPTIONAL_SETTINGS, name)) {
    return {
      problems: [
        `unknown check: ${name}. Available: ${Object.keys(OPTIONAL_SETTINGS).join(", ")}.`,
      ],
    }
  }
  if (packageJson === undefined) return { problems: ["package.json does not exist here."] }
  let manifest
  try {
    manifest = JSON.parse(packageJson)
  } catch {
    return { problems: ["package.json is not valid JSON."] }
  }
  const own = manifest["internal-package-contract"] ?? {}
  if (typeof own !== "object" || Array.isArray(own)) {
    return { problems: ['"internal-package-contract" in package.json must be an object.'] }
  }
  if (own.checks !== undefined && !Array.isArray(own.checks)) {
    return { problems: ['"internal-package-contract"."checks" must be a list of check names.'] }
  }
  const checks = own.checks ?? []
  if (checks.includes(name)) return { problems: [], text: packageJson, already: true }
  const settings = OPTIONAL_SETTINGS[name]
  const next = {
    ...own,
    checks: [...checks, name].sort(),
    ...Object.fromEntries(Object.entries(settings).filter(([key]) => own[key] === undefined)),
  }
  const indent = /^([ \t]+)"/m.exec(packageJson)?.[1] ?? "  "
  return {
    problems: [],
    text: `${JSON.stringify({ ...manifest, "internal-package-contract": next }, null, indent)}${packageJson.endsWith("\n") ? "\n" : ""}`,
  }
}
