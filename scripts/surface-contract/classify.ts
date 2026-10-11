/**
 * What a package promises its users besides its TypeScript types, and how a change to it is
 * classified for SemVer: the `--help` text and exit code of each CLI, the JSON Schemas it exports,
 * and the inputs and outputs of its GitHub Action. `ApiContract` covers the TypeScript API; this
 * covers the rest of the surface a consumer can depend on (see checks/surface-contract.ts).
 *
 * The classification is conservative on purpose. A change is `compatible` only when it cannot
 * break a consumer who relied on the old surface: something optional was added, a documentation
 * string changed, a constraint was relaxed in a way that only widens what is accepted. Anything else
 * is `breaking`, so the cost of a wrong guess is a bump that is larger than necessary, never a
 * breaking change published as a patch.
 */

/** A CLI as a user sees it: what `--help` printed and how the process exited. */
export interface CliSurface {
  readonly exitCode: number | null
  readonly help: string
}

/** A composite or JavaScript GitHub Action's public interface. */
export interface ActionSurface {
  readonly inputs: Readonly<
    Record<string, { readonly required: boolean; readonly default: string | null }>
  >
  readonly outputs: readonly string[]
}

/** Everything a package exposes besides its TypeScript API. */
export interface Surface {
  readonly cli: Readonly<Record<string, CliSurface>>
  /** Parsed JSON Schema documents, keyed by the `package.json` `exports` subpath they are served at. */
  readonly schemas: Readonly<Record<string, unknown>>
  readonly action: ActionSurface | null
}

/** One difference between the released surface and the current one. */
export interface SurfaceChange {
  readonly id: string
  readonly kind: string
  readonly impact: "breaking" | "compatible"
  /** Whether the change adds to the surface, which needs a `minor` once the package is 1.0.0 or later. */
  readonly widens: boolean
  readonly explanation: string
}

/** Keywords that only describe a schema; changing them cannot change what validates. */
const DOC_KEYS = new Set(["description", "title", "$comment", "examples", "default"])
/** Keywords whose children are names chosen by the schema's author, not keywords. */
const NAME_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
])

const isScalar = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean"].includes(typeof value)

/**
 * Flattens a JSON Schema into `pointer -> JSON text` entries so two versions can be compared leaf by
 * leaf. Arrays of scalars (`required`, `enum`, `type: [...]`) become sets, one `pointer#member` entry
 * each, so reordering them is not a change. Documentation keywords are kept apart.
 * @param schema - A parsed JSON Schema.
 * @returns The structural entries and the documentation entries.
 */
export function flattenSchema(schema: unknown): {
  structure: Record<string, string>
  docs: Record<string, string>
} {
  const structure: Record<string, string> = {}
  const docs: Record<string, string> = {}
  const walk = (node: unknown, pointer: string, parentKey: string): void => {
    if (isScalar(node)) {
      structure[pointer] = JSON.stringify(node)
    } else if (Array.isArray(node)) {
      if (node.length === 0) structure[pointer] = "[]"
      else if (node.every(isScalar)) {
        for (const member of node) structure[`${pointer}#${String(member)}`] = ""
      } else node.forEach((item, index) => walk(item, `${pointer}/${String(index)}`, parentKey))
    } else {
      for (const [key, child] of Object.entries(node as object).sort(([x], [y]) =>
        x.localeCompare(y),
      )) {
        if (DOC_KEYS.has(key) && !NAME_MAP_KEYS.has(parentKey))
          docs[`${pointer}/${key}`] = JSON.stringify(child)
        else walk(child, `${pointer}/${key}`, key)
      }
    }
  }
  walk(schema, "", "")
  return { structure, docs }
}

const FLAG = /(?<![\w-])--[A-Za-z][A-Za-z0-9-]*/g
const flagsOf = (help: string): Set<string> => new Set(help.match(FLAG) ?? [])

function classifyCli(name: string, before: CliSurface, after: CliSurface): SurfaceChange[] {
  const changes: SurfaceChange[] = []
  const id = `cli:${name}`
  if (before.exitCode !== after.exitCode) {
    changes.push({
      id,
      kind: "cli-exit-code-changed",
      impact: "breaking",
      widens: false,
      explanation: `\`${name} --help\` exited ${String(before.exitCode)}, now ${String(after.exitCode)}.`,
    })
  }
  const was = flagsOf(before.help)
  const now = flagsOf(after.help)
  for (const flag of [...was].filter((f) => !now.has(f))) {
    changes.push({
      id: `${id}:${flag}`,
      kind: "cli-flag-removed",
      impact: "breaking",
      widens: false,
      explanation: `\`${name}\` no longer documents ${flag}.`,
    })
  }
  for (const flag of [...now].filter((f) => !was.has(f))) {
    changes.push({
      id: `${id}:${flag}`,
      kind: "cli-flag-added",
      impact: "compatible",
      widens: true,
      explanation: `\`${name}\` now documents ${flag}.`,
    })
  }
  const flagChanged = changes.some((c) => c.kind.startsWith("cli-flag"))
  if (before.help !== after.help && !flagChanged) {
    changes.push({
      id,
      kind: "cli-help-changed",
      impact: "compatible",
      widens: false,
      explanation: `The \`${name} --help\` text changed.`,
    })
  }
  return changes
}

/** Pointers that end at a named property, shortest first: `/properties/a`, `/properties/a/properties/b`. */
function propertyRoots(pointer: string): string[] {
  const roots: string[] = []
  pointer.replace(/\/properties\/[^/#]+/g, (match, offset: number) => {
    roots.push(pointer.slice(0, offset + match.length))
    return match
  })
  return roots
}

function classifySchema(key: string, before: unknown, after: unknown): SurfaceChange[] {
  const a = flattenSchema(before)
  const b = flattenSchema(after)
  const changes: SurfaceChange[] = []
  const id = (pointer: string): string => `schema:${key}:${pointer}`
  const reported = new Set<string>()
  const add = (
    pointer: string,
    kind: string,
    impact: "breaking" | "compatible",
    widens: boolean,
    explanation: string,
  ): void => {
    if (reported.has(`${kind}|${pointer}`)) return
    reported.add(`${kind}|${pointer}`)
    changes.push({ id: id(pointer), kind, impact, widens, explanation })
  }
  const startsWith = (map: Record<string, string>, root: string): boolean =>
    Object.keys(map).some((p) => p === root || p.startsWith(`${root}/`))
  for (const pointer of [
    ...new Set([...Object.keys(a.structure), ...Object.keys(b.structure)]),
  ].sort()) {
    const was = a.structure[pointer]
    const now = b.structure[pointer]
    if (was === now) continue
    const hash = pointer.indexOf("#")
    // Only read for a set member, where `hash` is the position of its `#`: the keyword it belongs to.
    const setKey = pointer.slice(pointer.lastIndexOf("/", hash) + 1, hash)
    if (was !== undefined && now !== undefined) {
      add(
        pointer,
        "schema-changed",
        "breaking",
        false,
        `${pointer} changed from ${was} to ${now} in ${key}.`,
      )
    } else if (now !== undefined) {
      const root = propertyRoots(pointer).find((r) => !startsWith(a.structure, r))
      if (hash !== -1) {
        const required = setKey === "required"
        add(
          pointer,
          required ? "schema-required-added" : "schema-set-member-added",
          "breaking",
          false,
          `${pointer} now lists ${pointer.slice(hash + 1)} in ${key}.`,
        )
      } else if (root !== undefined) {
        add(
          root,
          "schema-property-added",
          "compatible",
          true,
          `${root} is a new property in ${key}.`,
        )
      } else
        add(
          pointer,
          "schema-constraint-added",
          "breaking",
          false,
          `${pointer} is a new constraint in ${key}.`,
        )
    } else {
      const root = propertyRoots(pointer).find((r) => !startsWith(b.structure, r))
      if (hash !== -1) {
        const required = setKey === "required"
        add(
          pointer,
          required ? "schema-required-removed" : "schema-set-member-removed",
          required ? "compatible" : "breaking",
          false,
          `${pointer} no longer lists ${pointer.slice(hash + 1)} in ${key}.`,
        )
      } else if (root !== undefined) {
        add(root, "schema-property-removed", "breaking", false, `${root} was removed from ${key}.`)
      } else
        add(
          pointer,
          "schema-constraint-removed",
          "breaking",
          false,
          `${pointer} was removed from ${key}.`,
        )
    }
  }
  if (JSON.stringify(a.docs) !== JSON.stringify(b.docs)) {
    changes.push({
      id: `schema:${key}`,
      kind: "schema-docs-changed",
      impact: "compatible",
      widens: false,
      explanation: `Descriptions or examples in ${key} changed.`,
    })
  }
  return changes
}

function classifyAction(before: ActionSurface, after: ActionSurface): SurfaceChange[] {
  const changes: SurfaceChange[] = []
  const push = (
    id: string,
    kind: string,
    impact: "breaking" | "compatible",
    widens: boolean,
    explanation: string,
  ): void => {
    changes.push({ id, kind, impact, widens, explanation })
  }
  for (const name of Object.keys(before.inputs)) {
    const was = before.inputs[name]!
    const now = after.inputs[name]
    const id = `action:input:${name}`
    if (now === undefined)
      push(id, "action-input-removed", "breaking", false, `Action input ${name} was removed.`)
    else {
      if (!was.required && now.required)
        push(
          id,
          "action-input-required",
          "breaking",
          false,
          `Action input ${name} is now required.`,
        )
      if (was.required && !now.required)
        push(
          id,
          "action-input-optional",
          "compatible",
          false,
          `Action input ${name} is now optional.`,
        )
      if (was.default !== now.default)
        push(
          id,
          "action-input-default-changed",
          "breaking",
          false,
          `Action input ${name} has a different default.`,
        )
    }
  }
  for (const name of Object.keys(after.inputs).filter((n) => !(n in before.inputs))) {
    const required = after.inputs[name]!.required
    push(
      `action:input:${name}`,
      "action-input-added",
      required ? "breaking" : "compatible",
      !required,
      `Action input ${name} was added${required ? " and is required" : ""}.`,
    )
  }
  for (const name of before.outputs.filter((n) => !after.outputs.includes(n))) {
    push(
      `action:output:${name}`,
      "action-output-removed",
      "breaking",
      false,
      `Action output ${name} was removed.`,
    )
  }
  for (const name of after.outputs.filter((n) => !before.outputs.includes(n))) {
    push(
      `action:output:${name}`,
      "action-output-added",
      "compatible",
      true,
      `Action output ${name} was added.`,
    )
  }
  return changes
}

/**
 * @param baseline - The surface of the last release.
 * @param current - The surface now.
 * @returns Every difference, sorted by id; empty when nothing a consumer can see changed.
 */
export function classifySurface(baseline: Surface, current: Surface): SurfaceChange[] {
  const changes: SurfaceChange[] = []
  const whole = (id: string, kind: string, present: boolean, what: string): void => {
    changes.push({
      id,
      kind,
      impact: present ? "compatible" : "breaking",
      widens: present,
      explanation: `${what} was ${present ? "added" : "removed"}.`,
    })
  }
  for (const name of new Set([...Object.keys(baseline.cli), ...Object.keys(current.cli)])) {
    const was = baseline.cli[name]
    const now = current.cli[name]
    if (was && now) changes.push(...classifyCli(name, was, now))
    else
      whole(
        `cli:${name}`,
        now ? "cli-added" : "cli-removed",
        now !== undefined,
        `The \`${name}\` command`,
      )
  }
  for (const key of new Set([...Object.keys(baseline.schemas), ...Object.keys(current.schemas)])) {
    const present = key in current.schemas
    if (key in baseline.schemas && present)
      changes.push(...classifySchema(key, baseline.schemas[key], current.schemas[key]))
    else
      whole(
        `schema:${key}`,
        present ? "schema-added" : "schema-removed",
        present,
        `The schema served at ${key}`,
      )
  }
  if (baseline.action && current.action)
    changes.push(...classifyAction(baseline.action, current.action))
  else if (baseline.action || current.action)
    whole(
      "action",
      current.action ? "action-added" : "action-removed",
      current.action !== null,
      "The GitHub Action",
    )
  return changes.sort((x, y) => x.id.localeCompare(y.id))
}
