// The one ESLint rule the baseline (`eslint.config.mjs`) carries itself: a library's source opens no
// network connection. Every capability a package needs is supplied by its caller, never taken from the
// environment, and the network is the capability a reviewer most wants to see absent. This rule is the
// gate that promise stands on, next to the tarball scan. A hit fails the `Lint` check.
//
// A rule of its own rather than a `no-restricted-imports` entry, because flat config keeps one options
// object per rule per file: a consumer's own `no-restricted-imports` block would replace the baseline's
// entry, and the ban would be gone with no error anywhere. A rule under its own name cannot be displaced
// that way; a consumer can only turn it off, which is visible.
//
// What it reports, in a file it applies to:
// - importing, re-exporting, `require()`-ing or `import()`-ing a module whose purpose is a connection:
//   Node's `http`, `https`, `http2`, `net`, `tls`, `dns` and `dgram` (with or without `node:`, any
//   subpath), `undici` and `ws`. A type-only import or export brings no capability and is allowed.
// - a reference to a network global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator`),
//   bare or through `globalThis`, `window`, `self` or `global`. A local binding of the same name is not
//   the global and is not reported.
//
// Where it applies is the baseline's decision (`src/**`), so a package's executable boundary (`bin/`, a
// CLI) is outside it unless the package adds that path. A feature test such as `typeof fetch ===
// "function"` is a reference too; a package that needs one says why in an `eslint-disable` comment,
// which `Suppressions` then keeps visible.

/** Modules whose purpose is a network connection, by the name a specifier starts with. */
export const NETWORK_MODULES = Object.freeze([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dns",
  "dgram",
  "undici",
  "ws",
])

/** Globals that open a connection, or (`navigator`) carry the ones that do. */
export const NETWORK_GLOBALS = Object.freeze([
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
])

/** The objects a global can be reached through without naming it bare. */
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"])

/**
 * @param {string} specifier - an import specifier.
 * @returns {string} the module it names, without the `node:` scheme or a subpath: `node:dns/promises` is `dns`.
 */
export function moduleOf(specifier) {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier
  return bare.slice(0, bare.indexOf("/") === -1 ? bare.length : bare.indexOf("/"))
}

/** @type {import("eslint").Rule.RuleModule} */
export const noNetwork = {
  meta: {
    type: "problem",
    docs: {
      description:
        "library source opens no network connection: no network module is imported and no network global is used",
    },
    schema: [],
    messages: {
      module:
        "`{{name}}` opens a network connection, and library source never does: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
      global:
        "`{{name}}` is a network global, and library source never uses one: accept the capability from the caller, or keep this in the executable boundary this rule does not cover.",
    },
  },
  create(context) {
    /**
     * @param {import("eslint").Rule.Node} node - what to report.
     * @param {"module" | "global"} messageId - which message.
     * @param {string} name - what was named.
     */
    const report = (node, messageId, name) => {
      context.report({ node, messageId, data: { name } })
    }
    /**
     * Reports the node when it is a string literal naming a network module; a dynamic specifier (an identifier,
     * a template) has no `value` and is not judged.
     * @param {import("eslint").Rule.Node & { value?: unknown }} node - a specifier node.
     */
    const checkSpecifier = (node) => {
      if (typeof node.value === "string" && NETWORK_MODULES.includes(moduleOf(node.value))) {
        report(node, "module", node.value)
      }
    }
    return {
      ImportDeclaration(node) {
        if (node.importKind !== "type") checkSpecifier(node.source)
      },
      ExportNamedDeclaration(node) {
        // ESLint's AST carries `source: null` for a local export list.
        if (node.source !== null && node.exportKind !== "type") {
          checkSpecifier(node.source)
        }
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type") checkSpecifier(node.source)
      },
      ImportExpression(node) {
        checkSpecifier(node.source)
      },
      CallExpression(node) {
        // Only an identifier has a `name`, so a member call (`x.require(...)`) is not `require`.
        const [argument] = node.arguments
        if (node.callee.name === "require" && argument !== undefined) checkSpecifier(argument)
      },
      MemberExpression(node) {
        // A non-computed property is an identifier with a `name`; so is the object when it is bare.
        if (node.computed) return
        if (GLOBAL_OBJECTS.has(node.object.name) && NETWORK_GLOBALS.includes(node.property.name)) {
          report(node, "global", `${node.object.name}.${node.property.name}`)
        }
      },
      "Program:exit"() {
        // A global ESLint was told about (`languageOptions.globals`) resolves to a variable of the global scope;
        // one it was not told about is left unresolved, in `through`. A library reaching for either is the finding.
        const scope = /** @type {import("eslint").Scope.Scope} */ (
          context.sourceCode.scopeManager.globalScope
        )
        for (const name of NETWORK_GLOBALS) {
          const declared = scope.set.get(name)?.references ?? []
          const undeclared = scope.through.filter((reference) => reference.identifier.name === name)
          for (const reference of [...declared, ...undeclared]) {
            report(reference.identifier, "global", name)
          }
        }
      },
    }
  },
}
