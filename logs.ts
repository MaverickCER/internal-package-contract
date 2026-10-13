/**
 * The hooks that keep one log per check as a contract runs, re-exported from `repo-contract` so a package that
 * wires its own run (`runRepoContract(config, { onEvidence, onVerdict })`) takes them from here and does not
 * have to install `repo-contract` just for them:
 *
 * ```ts
 * import { runRepoContract } from "repo-contract"
 * import {
 *   onEvidenceSaveToRepoContractLogs,
 *   onVerdictPrependRepoContractLogs,
 * } from "internal-package-contract/logs"
 *
 * await runRepoContract(config, {
 *   onEvidence: onEvidenceSaveToRepoContractLogs(),
 *   onVerdict: onVerdictPrependRepoContractLogs(),
 * })
 * ```
 *
 * The raw output of each check is saved the moment its evidence exists, and its verdict is prepended to the top
 * of the same file the moment its policy returns it. `internal-package-contract` itself runs the contract this way.
 */
export {
  onEvidenceSaveToRepoContractLogs,
  onVerdictPrependRepoContractLogs,
  REPO_CONTRACT_LOG_DIRECTORY,
  REPO_CONTRACT_LOG_EVIDENCE_MARKER,
  repoContractLogs,
} from "repo-contract/helpers"
export type {
  RepoContractLogMode,
  RepoContractLogs,
  RepoContractLogsFileSystem,
  RepoContractLogsOptions,
} from "repo-contract/helpers"
