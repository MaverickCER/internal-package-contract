// What `add check <Name>` writes next to the name, per check: the settings the check reads. The
// defaults are written out so a package can see them and change them.

import { DEFAULT_CONFIG } from "../ambient/scan.mjs"

/** Optional checks and the package.json settings each one reads, under "internal-package-contract". */
export const OPTIONAL_SETTINGS = {
  AgentSkill: {},
  AmbientCapabilities: { ambientCapabilities: DEFAULT_CONFIG },
  Sbom: {},
}

/**
 * Checks that were optional and are now in the standard set, each with what `add check` says about it.
 * A package that still lists one under "checks" loses nothing: the listing is ignored.
 */
export const RETIRED_CHECKS = {
  QuickStart:
    'QuickStart is in the standard set now, so there is nothing to turn on. A "checks" entry naming it is ignored; delete it when convenient.',
}
