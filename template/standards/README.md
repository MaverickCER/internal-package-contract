# Vendored standards schemas

<!-- Managed by internal-package-contract (template/standards/README.md). Change it there and run `internal-package-contract sync`. -->

The official schemas a package's tests validate its standard-format output against, so a test proves the output is
valid against the standard itself rather than against a shape written in this repository. They are used only by
tests and are not shipped. Each file is byte for byte as published at the URL below, which names a release, not a
moving branch; its SHA-256 is pinned so an edit or a reformat fails internal-package-contract's own tests and the
`ManagedFiles` check. A package carries only the schemas it enrols (`internal-package-contract sync --add <name>`),
so not every file below is present in every package. Keep `test/fixtures/standards/*.json` in `.prettierignore`.

| File                                         | Standard                                                         | Source                                                                                           | SHA-256                                                            |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `sarif-schema-2.1.0.json`                    | OASIS SARIF 2.1.0 (JSON Schema draft-04)                         | https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json       | `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e` |
| `oscal_assessment-results_schema-1.1.2.json` | NIST OSCAL 1.1.2 assessment-results model (JSON Schema draft-07) | https://github.com/usnistgov/OSCAL/releases/download/v1.1.2/oscal_assessment-results_schema.json | `d033da70154cf6625ae46a746199e88e58f2928b1387dfac051d381b92f41b0d` |
| `bom-1.6.schema.json`                        | CycloneDX 1.6 (JSON Schema draft-07)                             | https://raw.githubusercontent.com/CycloneDX/specification/1.6.2/schema/bom-1.6.schema.json       | `18f57f7482593bad9f21b4feed09084640cbeff419d62ad5090c5ceccca5b37d` |
| `spdx.schema.json`                           | SPDX licence ids, referenced by the CycloneDX schema             | https://raw.githubusercontent.com/CycloneDX/specification/1.6.2/schema/spdx.schema.json          | `c41917196639055e9f9670811bac23ef777732144f3ff5a2f39686f61580dbe6` |
| `jsf-0.82.schema.json`                       | JSON Signature Format 0.82, referenced by the CycloneDX schema   | https://raw.githubusercontent.com/CycloneDX/specification/1.6.2/schema/jsf-0.82.schema.json      | `8bae002c25e723db7ee1f26afde680ae1a2b1a8f6b4b4b0fd65dc3becb090aae` |

OASIS publishes the SARIF schema under its OASIS Open licensing. NIST publishes OSCAL as a U.S. Government work, not
subject to copyright in the United States. CycloneDX publishes its schemas under the Apache License 2.0.
