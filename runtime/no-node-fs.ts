// `@typescript-eslint/utils` is an optional peer of every package that carries this rule; its `eslint-utils`
// subpath keeps the loaded surface small, and the main entry is only needed for the node-type enum.
import { RuleCreator } from "@typescript-eslint/utils/eslint-utils"
import { AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils"
import { matchesAllowList } from "./glob.js"

/** What differs between the packages that carry the rule: where its documentation lives and what to read. */
export interface NoNodeFsWording {
  /** @returns the documentation URL for a rule of this plugin. */
  readonly docsUrl: (ruleName: string) => string
  /** What the message cites for the reasoning, for example `ADR 0040`. */
  readonly adr: string
  /** Where the message says the allow-list escape hatch is described, for example `the README's ESLint section`. */
  readonly guide: string
}

export interface RuleOptions {
  /** Glob-array of files this rule doesn't apply to -- a project's own
   *  executable entry points (a CLI, a script) that legitimately construct
   *  the concrete filesystem adapter. Empty by default -- populate it
   *  explicitly; the rule never guesses at what counts as an executable
   *  capability boundary. */
  allow?: string[]
}

/** `"node:fs"`, `"fs"`, and their `/promises` subpaths -- every specifier that resolves to Node's filesystem module. */
const FS_SPECIFIER = /^(node:)?fs(\/promises)?$/

/** The specifier string if it names Node's filesystem module, else `undefined`. */
function fsSpecifier(source: unknown): string | undefined {
  const text = String(source)
  return FS_SPECIFIER.test(text) ? text : undefined
}

/**
 * Flags any `import`, re-export (`export ... from`, `export * from`), `require`, TypeScript
 * `import x = require()` or dynamic `import()` of `node:fs` in library code, so a library surface acquires its filesystem capability from the
 * caller instead of reaching for `node:fs` itself (the same discipline
 * `repo-contract`'s ADR-0011 established for `child_process`/`process.env`).
 * The wording passed in names the package's own documentation and decision record.
 *
 * @remarks
 * Nothing is exempt by default. A package's own config allows its CLI folder, for example `src/cli/**`
 * (the executable capability boundary that builds the `node:fs/promises`
 * adapter); a consuming project sets its own `allow` for its own entry
 * points.
 */
export function createNoNodeFs(wording: NoNodeFsWording) {
  const createRule = RuleCreator(wording.docsUrl)
  return createRule<[RuleOptions], "noNodeFs">({
    name: "no-node-fs",
    meta: {
      type: "problem",
      docs: {
        description:
          "Disallow importing node:fs in library code; accept a filesystem capability from the caller instead.",
      },
      schema: [
        {
          type: "object",
          properties: { allow: { type: "array", items: { type: "string" } } },
          additionalProperties: false,
        },
      ],
      messages: {
        noNodeFs: `Importing '{{specifier}}' makes this a filesystem-acquiring surface. Accept a filesystem capability as an argument instead, and let an executable entry point construct the node:fs adapter (see ${wording.adr} / ${wording.guide} for the allow-list escape hatch).`,
      },
    },
    defaultOptions: [{ allow: [] }],
    create(context, [options]) {
      // `RuleCreator` merges `defaultOptions` onto the configured options, so `allow` is always set.
      if (matchesAllowList(options.allow as readonly string[], context.filename, context.cwd))
        return {}

      const reportSource = (node: TSESTree.Node, source: TSESTree.Literal | null): void => {
        // A declaration with no source (`export { x }`, `export const x = 1`) re-exports nothing.
        const specifier = source === null ? undefined : fsSpecifier(source.value)
        if (specifier !== undefined) {
          context.report({ node, messageId: "noNodeFs", data: { specifier } })
        }
      }

      return {
        ImportDeclaration(node) {
          reportSource(node, node.source)
        },
        // A re-export reaches the module as surely as an import does.
        ExportNamedDeclaration(node) {
          reportSource(node, node.source)
        },
        ExportAllDeclaration(node) {
          reportSource(node, node.source)
        },
        // TypeScript's `import fs = require("node:fs")`; `import x = A.B` names no module.
        TSImportEqualsDeclaration(node) {
          if (node.moduleReference.type === AST_NODE_TYPES.TSExternalModuleReference) {
            reportSource(node, node.moduleReference.expression)
          }
        },
        ImportExpression(node) {
          // A source that is not a literal (an identifier, a template) has no `value`, so it never matches.
          const specifier = fsSpecifier((node.source as TSESTree.Literal).value)
          if (specifier !== undefined) {
            context.report({ node, messageId: "noNodeFs", data: { specifier } })
          }
        },
        CallExpression(node) {
          // Only an `Identifier` callee has a `name`; any other callee reads `undefined` and is not `require`.
          if (
            (node.callee as TSESTree.Identifier).name !== "require" ||
            node.arguments[0]?.type !== AST_NODE_TYPES.Literal
          ) {
            return
          }
          const specifier = fsSpecifier(node.arguments[0].value)
          if (specifier !== undefined) {
            context.report({ node, messageId: "noNodeFs", data: { specifier } })
          }
        },
      }
    },
  })
}
