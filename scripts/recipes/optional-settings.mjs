// What `add check <Name>` writes next to the name, per check: the settings the check reads, with the defaults
// written out so a package can see them and change them.

import { DEFAULT_CONFIG } from "../ambient/scan.mjs"

/** Optional checks and the package.json settings each one reads, under "internal-package-contract". */
export const OPTIONAL_SETTINGS = {
  AgentSkill: {},
  AmbientCapabilities: { ambientCapabilities: DEFAULT_CONFIG },
}
