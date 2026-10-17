// What this package's own workflows and code read from the environment, written down once: what each is for, who
// owns it, how to get a new one, and when it expires. `internal-package-contract env` reads this file (it never runs
// it) and writes docs/ENVIRONMENT.md.
//
// What the standard itself needs (the tokens its checks and workflows use, and its tool settings) is described once,
// by the standard, and is included in docs/ENVIRONMENT.md without being repeated here. Do not write those again: a
// second copy is one that can disagree. Write only what is particular to this package, for example:
//
//   import { createEnv, documentEnv } from "internal-package-contract/env-cap"
//
//   const settings = { MY_SERVICE_TOKEN: { default: "", validator: (value: string) => value.length > 0 } }
//   export const settingsEnv = createEnv(settings, { name: "settings" })
//
//   documentEnv(settings, {
//     category: "Service",
//     variables: {
//       MY_SERVICE_TOKEN: {
//         description: "Lets the deploy step call the service.",
//         refreshInstructions: "Create a token in the service's settings and replace the repository secret.",
//         sensitivity: "secret",
//         expiresAt: "2027-01-01",
//       },
//     },
//   })
//
// To track when one of the standard's own credentials expires, or who owns it in this package, name it again with
// only what is yours: everything else about it still comes from the standard, so there is nothing to keep in step.
//
//   const accept = (): true => true
//   const credentials = { PIN_SYNC_TOKEN: { default: "", validator: accept } }
//   export const credentialsEnv = createEnv(credentials, { name: "credentials" })
//   documentEnv(credentials, { variables: { PIN_SYNC_TOKEN: { expiresAt: "2027-01-01", owner: "me" } } })
//
// A package with nothing of its own can leave this file as it is, or delete it.
export {}
