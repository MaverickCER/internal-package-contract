/**
 * How a change to a package's non-TypeScript surface is judged for SemVer. That surface is the `--help`
 * text and exit code of each CLI and of each command it lists, and the JSON Schemas it exports. It is
 * also the inputs and outputs of its GitHub Action and of each reusable workflow it hosts, and the
 * Markdown headings its generators write. `ApiContract` covers the types; `SurfaceContract`
 * (checks/surface-contract.ts) covers this.
 *
 * Breaking: a removed CLI, command, flag, schema, reusable workflow, generated-document heading, or
 * action or workflow input, secret or output, a changed exit code, a
 * new required input or a changed input default, and any schema constraint that accepts less. Compatible: an addition, a schema
 * constraint relaxed to accept more, a documentation keyword, and a change to help prose that leaves
 * every command and flag in place. A rename reads as a removal plus an addition, so it is breaking.
 *
 * Limit: help prose is read for commands and flags only. A behaviour change behind unchanged help,
 * such as a flag that now means something else, is invisible here.
 */

/** One command's help as a user sees it: what `--help` printed and how the process exited. */
export interface CommandSurface {
  readonly exitCode: number | null
  readonly help: string
}

/**
 * A CLI as a user sees it: its top-level help, and the help of each command that help lists.
 * `commands` is absent in a baseline taken before commands were collected; such a baseline is
 * compared on the top-level help only, until `update-baseline` records the commands.
 */
export interface CliSurface extends CommandSurface {
  readonly commands?: Readonly<Record<string, CommandSurface>>
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
  /**
   * The `on.workflow_call` interface of each reusable workflow under `.github/workflows/`, keyed by file
   * name. A workflow's secrets are inputs named `secrets.<name>`. Absent in a baseline taken before
   * reusable workflows were collected.
   */
  readonly workflows?: Readonly<Record<string, ActionSurface>>
  /**
   * The Markdown headings the package's generators write (package.json
   * `internal-package-contract.surfaceRenderers`). Absent when the package lists none, or in a baseline
   * taken before headings were collected.
   */
  readonly documents?: readonly string[]
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
  const walk = (node: unknown, pointer = "", parentKey?: string): void => {
    if (isScalar(node)) {
      structure[pointer] = JSON.stringify(node)
    } else if (Array.isArray(node)) {
      if (node.length === 0) structure[pointer] = "[]"
      else if (node.every(isScalar)) {
        for (const member of node) structure[`${pointer}#${JSON.stringify(member)}`] = ""
      } else node.forEach((item, index) => walk(item, `${pointer}/${String(index)}`, parentKey))
    } else {
      for (const [key, child] of Object.entries(node as object).sort(([x], [y]) =>
        x.localeCompare(y),
      )) {
        if (DOC_KEYS.has(key) && !NAME_MAP_KEYS.has(parentKey as string))
          docs[`${pointer}/${key}`] = JSON.stringify(child)
        else walk(child, `${pointer}/${key}`, key)
      }
    }
  }
  walk(schema)
  return { structure, docs }
}

const FLAG = /(?<![\w-])--[A-Za-z][A-Za-z0-9-]*/g
const flagsOf = (help: string): Set<string> => new Set([...help.matchAll(FLAG)].map((m) => m[0]))

function classifyCommand(
  name: string,
  before: CommandSurface,
  after: CommandSurface,
): SurfaceChange[] {
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

function classifyCli(name: string, before: CliSurface, after: CliSurface): SurfaceChange[] {
  const changes = classifyCommand(name, before, after)
  // A baseline from before commands were collected has nothing to compare them with.
  if (before.commands === undefined) return changes
  const was = before.commands
  const now = after.commands ?? {}
  // `classifySurface` sorts every change by id, so the command order here never shows.
  for (const command of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const full = `${name} ${command}`
    const old = was[command]
    const current = now[command]
    if (old !== undefined && current !== undefined)
      changes.push(...classifyCommand(full, old, current))
    else {
      const added = current !== undefined
      changes.push({
        id: `cli:${full}`,
        kind: added ? "cli-command-added" : "cli-command-removed",
        impact: added ? "compatible" : "breaking",
        widens: added,
        explanation: `\`${full}\` was ${added ? "added" : "removed"}.`,
      })
    }
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
  for (const pointer of new Set([...Object.keys(a.structure), ...Object.keys(b.structure)])) {
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

/** How a change to an Action or to a reusable workflow is named: its id prefix, kind prefix and noun. */
interface InterfaceLabel {
  readonly id: string
  readonly kind: string
  readonly noun: string
}
const ACTION_LABEL: InterfaceLabel = { id: "action", kind: "action", noun: "Action" }

function classifyAction(
  before: ActionSurface,
  after: ActionSurface,
  label: InterfaceLabel = ACTION_LABEL,
): SurfaceChange[] {
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
    const id = `${label.id}:input:${name}`
    if (now === undefined)
      push(
        id,
        `${label.kind}-input-removed`,
        "breaking",
        false,
        `${label.noun} input ${name} was removed.`,
      )
    else {
      if (!was.required && now.required)
        push(
          id,
          `${label.kind}-input-required`,
          "breaking",
          false,
          `${label.noun} input ${name} is now required.`,
        )
      if (was.required && !now.required)
        push(
          id,
          `${label.kind}-input-optional`,
          "compatible",
          false,
          `${label.noun} input ${name} is now optional.`,
        )
      if (was.default !== now.default)
        push(
          id,
          `${label.kind}-input-default-changed`,
          "breaking",
          false,
          `${label.noun} input ${name} has a different default.`,
        )
    }
  }
  for (const name of Object.keys(after.inputs).filter((n) => !(n in before.inputs))) {
    const required = after.inputs[name]!.required
    push(
      `${label.id}:input:${name}`,
      `${label.kind}-input-added`,
      required ? "breaking" : "compatible",
      !required,
      `${label.noun} input ${name} was added${required ? " and is required" : ""}.`,
    )
  }
  for (const name of before.outputs.filter((n) => !after.outputs.includes(n))) {
    push(
      `${label.id}:output:${name}`,
      `${label.kind}-output-removed`,
      "breaking",
      false,
      `${label.noun} output ${name} was removed.`,
    )
  }
  for (const name of after.outputs.filter((n) => !before.outputs.includes(n))) {
    push(
      `${label.id}:output:${name}`,
      `${label.kind}-output-added`,
      "compatible",
      true,
      `${label.noun} output ${name} was added.`,
    )
  }
  return changes
}

/** Reusable workflows, judged like an Action. A baseline taken before they were collected compares nothing. */
function classifyWorkflows(baseline: Surface, current: Surface): SurfaceChange[] {
  if (baseline.workflows === undefined) return []
  const changes: SurfaceChange[] = []
  const now = current.workflows ?? {}
  for (const file of new Set([...Object.keys(baseline.workflows), ...Object.keys(now)])) {
    const was = baseline.workflows[file]
    const is = now[file]
    if (was !== undefined && is !== undefined) {
      changes.push(
        ...classifyAction(was, is, {
          id: `workflow:${file}`,
          kind: "workflow",
          noun: `Workflow ${file}`,
        }),
      )
    } else {
      const added = is !== undefined
      changes.push({
        id: `workflow:${file}`,
        kind: added ? "workflow-added" : "workflow-removed",
        impact: added ? "compatible" : "breaking",
        widens: added,
        explanation: `The reusable workflow ${file} was ${added ? "added" : "removed"}.`,
      })
    }
  }
  return changes
}

/**
 * Generated-document headings. A heading readers navigate by, or a tool parses, is part of the output
 * format. A baseline taken before headings were collected compares nothing. A package that stops listing
 * renderers reads as removing every heading.
 */
function classifyDocuments(baseline: Surface, current: Surface): SurfaceChange[] {
  const was = baseline.documents
  // Dropping `surfaceRenderers` stops collecting headings; that reads as every heading removed, so it
  // cannot switch the diff off quietly.
  const now = current.documents ?? []
  if (was === undefined) return []
  return [
    ...was
      .filter((heading) => !now.includes(heading))
      .map((heading) => ({
        id: `document:${heading}`,
        kind: "document-heading-removed",
        impact: "breaking" as const,
        widens: false,
        explanation: `Generated documents no longer contain the heading "${heading}".`,
      })),
    ...now
      .filter((heading) => !was.includes(heading))
      .map((heading) => ({
        id: `document:${heading}`,
        kind: "document-heading-added",
        impact: "compatible" as const,
        widens: true,
        explanation: `Generated documents gained the heading "${heading}".`,
      })),
  ]
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
  changes.push(...classifyWorkflows(baseline, current), ...classifyDocuments(baseline, current))
  return changes.sort((x, y) => x.id.localeCompare(y.id))
}
