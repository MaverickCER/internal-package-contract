// What a published package may acquire on its own. A library that takes its filesystem, its way to start a
// process and its environment from the caller (so a consumer can see, and replace, what it touches) must not
// import them itself, and a tool like socket.dev flags every package that does. A package says which of these
// it must never reach, and which entry points (its `bin`, an export such as `./node`) are the exception, and
// this reads the tarball npm would publish to check that, since the tarball is what a consumer receives and a
// source-level lint rule cannot see what a bundler pulled in.
//
// Textual defense in depth, not a proof: it catches a literal reintroduction (a stray `require("child_process")`,
// a `process.env` reference, a forbidden dependency) and cannot prove the absence of every possible evasion.

/** What each capability looks like in shipped code. */
export const CAPABILITIES = Object.freeze({
  child_process: Object.freeze({
    needles: [
      "node:child_process",
      'require("child_process")',
      "require('child_process')",
      'import("child_process")',
      "import('child_process')",
      'from "child_process"',
      "from 'child_process'",
    ],
  }),
  fs: Object.freeze({
    needles: [
      "node:fs",
      'require("fs/promises")',
      "require('fs/promises')",
      'require("fs")',
      "require('fs')",
      'import("fs")',
      "import('fs')",
      'from "fs"',
      "from 'fs'",
    ],
  }),
  env: Object.freeze({ pattern: /\bprocess\.env\b/ }),
})

/** What a check that is switched on without saying more forbids: everything, except that a `bin` may touch files. */
export const DEFAULT_CONFIG = Object.freeze({
  child_process: [],
  env: [],
  fs: ["bin"],
  forbiddenDependencies: [],
})

const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs"])
/** A file larger than this is an asset, never a source bundle. */
const LARGEST_SOURCE = 8 * 1024 * 1024

/**
 * @param {unknown} raw - what the package wrote under `"ambientCapabilities"`, if anything.
 * @returns {{ config: { child_process?: string[], fs?: string[], env?: string[], forbiddenDependencies: string[] }, problems: string[] }}
 *   what to enforce, and what is wrong with the way it was written. Nothing written means the defaults.
 */
export function normalizeConfig(raw) {
  if (raw === undefined) return { config: structuredClone(DEFAULT_CONFIG), problems: [] }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      config: { forbiddenDependencies: [] },
      problems: ['"ambientCapabilities" must be an object.'],
    }
  }
  const known = new Set([...Object.keys(CAPABILITIES), "forbiddenDependencies"])
  const problems = []
  const config = { forbiddenDependencies: [] }
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key)) {
      problems.push(`"ambientCapabilities.${key}" is not one of ${[...known].join(", ")}.`)
    } else if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      problems.push(
        `"ambientCapabilities.${key}" must be a list of strings: ${key === "forbiddenDependencies" ? "dependency names" : 'the entry points ("bin", "./node") that may use it'}.`,
      )
    } else {
      config[key] = value
    }
  }
  return { config, problems }
}

/**
 * @param {unknown} entry - one `package.json#exports` entry, however it is shaped.
 * @returns {string | undefined} the file the `import` condition (else `default`) points to.
 */
function exportTarget(entry) {
  if (typeof entry === "string") return entry
  if (entry !== null && typeof entry === "object") {
    return exportTarget(entry.import ?? entry.default)
  }
  return undefined
}

/**
 * @param {string} file - a path as `package.json` writes it.
 * @returns {string[]} that file's path as the tarball lists it, and the files that always travel with it: its
 *   source map, and (tsup writes both) its CommonJS sibling and that sibling's map.
 */
function withCompanions(file) {
  const plain = file.replace(/^\.\//, "")
  const sibling = plain.replace(/\.js$/, ".cjs")
  return [plain, `${plain}.map`, sibling, `${sibling}.map`]
}

/**
 * @param {{ bin?: unknown, exports?: Record<string, unknown> }} manifest - the packed `package.json`.
 * @param {readonly string[]} entries - `"bin"` or an export key such as `"./node"`.
 * @returns {Set<string>} the tarball paths of those entry points. Derived from the manifest, never from a glob, so
 *   a stray module next to one gets no free pass.
 */
export function exemptFiles(manifest, entries) {
  const exempt = new Set()
  for (const entry of entries) {
    const targets =
      entry === "bin"
        ? typeof manifest.bin === "string"
          ? [manifest.bin]
          : Object.values(manifest.bin ?? {})
        : [exportTarget(manifest.exports?.[entry])]
    for (const target of targets) {
      if (typeof target === "string") for (const file of withCompanions(target)) exempt.add(file)
    }
  }
  return exempt
}

/**
 * @param {string} text - a file's text.
 * @param {"child_process" | "fs" | "env"} capability
 * @returns {string | undefined} what in it reaches the capability, or `undefined`.
 */
function reaches(text, capability) {
  const found = CAPABILITIES[capability]
  if ("pattern" in found) return found.pattern.exec(text)?.[0]
  return found.needles.find((needle) => text.includes(needle))
}

/**
 * @param {object} input
 * @param {{ name: string, content: Buffer }[]} input.files - the tarball's files.
 * @param {{ bin?: unknown, exports?: Record<string, unknown>, dependencies?: Record<string, string>, bundleDependencies?: string[] }} input.manifest
 * @param {{ child_process?: string[], fs?: string[], env?: string[], forbiddenDependencies?: string[] }} input.config
 * @returns {{ violations: { file: string, capability: string, hit: string }[], exempt: Record<string, string[]>, checked: number }}
 */
export function scanFiles({ files, manifest, config }) {
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder name matches no path in the tarball.
  const bundled = (manifest.bundleDependencies ?? []).map((name) => `node_modules/${name}/`)
  const forbidden = Object.keys(CAPABILITIES).filter(
    (capability) => config[capability] !== undefined,
  )
  const exempt = Object.fromEntries(
    forbidden.map((capability) => [capability, exemptFiles(manifest, config[capability])]),
  )
  const violations = []
  let checked = 0
  for (const { name, content } of files) {
    if (bundled.some((root) => name.startsWith(root))) continue
    if (!CODE_EXTENSIONS.has(name.slice(name.lastIndexOf(".")))) continue
    if (content.length > LARGEST_SOURCE) continue
    checked += 1
    const text = content.toString("utf8")
    for (const capability of forbidden) {
      if (exempt[capability].has(name)) continue
      const hit = reaches(text, capability)
      if (hit !== undefined) violations.push({ file: name, capability, hit })
    }
  }
  // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder name is not a dependency.
  for (const name of config.forbiddenDependencies ?? []) {
    if (manifest.dependencies?.[name] !== undefined) {
      violations.push({ file: "package.json", capability: "dependencies", hit: name })
    }
  }
  return {
    violations,
    exempt: Object.fromEntries(
      forbidden.map((capability) => [capability, [...exempt[capability]].sort()]),
    ),
    checked,
  }
}
