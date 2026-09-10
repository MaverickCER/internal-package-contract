/**
 * Baseline dependency-cruiser rules for a publishable TypeScript package -- the
 * default the `Architecture` check uses when a consumer has no
 * `.dependency-cruiser.cjs` of its own.
 *
 * A consumer that wants to add package-specific boundary rules extends this:
 *
 *   const baseline = require("internal-package-contract/config/dependency-cruiser")
 *   module.exports = {
 *     ...baseline,
 *     forbidden: [...baseline.forbidden, { name: "...", ... }],
 *   }
 *
 * Only `no-circular` is `error` (the `Architecture` policy blocks on
 * error-severity findings); everything else is `warn` -- surfaced, not blocking,
 * until a consumer promotes it.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This dependency is part of a circular RUNTIME relationship (`import type` edges are " +
        "excluded -- they are erased at compile time and cannot cause an initialization cycle). " +
        "Use dependency inversion, or move the shared code into a leaf module both sides import.",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "This module is not reachable from any entry point - it is likely dead. Use it, remove " +
        "it, or (if it is a config/tooling file) add it to this rule's pathNot.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]*[.](js|cjs|mjs|ts|cts|mts|json)$",
          "[.]d[.](ts|cts|mts)$",
          "(^|/)tsconfig[^/]*[.]json$",
          "(^|/)[^/]*[.]config[.](js|cjs|mjs|ts|cts|mts|json)$",
        ],
      },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      comment: "Depends on a deprecated Node core module. Find a supported alternative.",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: ["^(?:punycode|domain|constants|sys|_linklist|_stream_wrap)$"],
      },
    },
    {
      name: "not-to-deprecated",
      severity: "warn",
      comment:
        "Depends on a deprecated npm package. Upgrade or replace it - deprecated code is a risk.",
      from: {},
      to: { dependencyTypes: ["deprecated"] },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment:
        "Depends on an npm package that is not in package.json. Add it to dependencies (or " +
        "devDependencies) so installs are reproducible and the published package is honest.",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Imports a module that cannot be resolved. Fix the path or install the dependency.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-duplicate-dep-types",
      severity: "warn",
      comment:
        "This module is imported both as a devDependency and as a (production) dependency. Pick one.",
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "not-to-test",
      severity: "error",
      comment: "Production source must not import test code.",
      from: { pathNot: "[.](?:spec|test)[.](?:js|mjs|cjs|ts|cts|mts|jsx|tsx)$" },
      to: { path: "(^|/)(?:test|tests|__tests__|__mocks__)/" },
    },
    {
      name: "not-to-dev-dep",
      severity: "error",
      comment:
        "Production source must not import a devDependency - it would be missing from a " +
        "consumer's install. Move the package to dependencies, or the importing file out of src/.",
      from: {
        path: "^src/",
        pathNot: "[.](?:spec|test|d)[.](?:js|mjs|cjs|ts|cts|mts|jsx|tsx)$",
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: ["node_modules/@types/"],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^|/)(?:node_modules|dist|coverage|reports|examples|benchmark|benchmarks|\\.stryker-tmp)/",
    },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts", ".json"],
    },
  },
}
