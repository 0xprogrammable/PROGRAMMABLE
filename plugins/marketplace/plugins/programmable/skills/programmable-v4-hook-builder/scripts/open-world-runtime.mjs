import { installOpenWorldLocalCommands } from "./open-world-local-commands.mjs";
import { installOpenWorldApplicationCommand } from "./open-world-application-command.mjs";
import { installOpenWorldPrepareRevisionCommand } from "./open-world-prepare-revision-command.mjs";
import { installOpenWorldGitHubCommandEntry } from "./open-world-github-command-entry.mjs";
import { installOpenWorldLocalSourceVerification } from "./open-world-local-source-verification.mjs";
import { installOpenWorldApplicationPackage } from "./open-world-application-package.mjs";
import { installOpenWorldGitHubTransportPlan } from "./open-world-github-transport-plan.mjs";
import { installOpenWorldRemoteSourceVerification } from "./open-world-remote-source-verification.mjs";
import { installOpenWorldRemoteV2Policy } from "./open-world-remote-v2-policy.mjs";
import { installOpenWorldPrepareRevisionDiscovery } from "./open-world-prepare-revision-discovery.mjs";
import { installOpenWorldGitHubMutationExecution } from "./open-world-github-mutation-execution.mjs";
import { installOpenWorldGitHubMutationPrimitives } from "./open-world-github-mutation-primitives.mjs";
import { installOpenWorldGitHubReceiptStore } from "./open-world-github-receipt-store.mjs";
import { installOpenWorldGitHubReceiptReconcile } from "./open-world-github-receipt-reconcile.mjs";
import { installOpenWorldGitHubStatusHistory } from "./open-world-github-status-history.mjs";
import { installOpenWorldGitHubTransportUtilities } from "./open-world-github-transport-utilities.mjs";
import { installOpenWorldFilesystemGitUtilities } from "./open-world-filesystem-git-utilities.mjs";
import { installOpenWorldSnapshotSourceUtilities } from "./open-world-snapshot-source-utilities.mjs";
import { installOpenWorldSourceClosureVerification } from "./open-world-source-closure-verification.mjs";
import { installOpenWorldApplicationAssembly } from "./open-world-application-assembly.mjs";
import { installOpenWorldMaterialization } from "./open-world-materialization.mjs";
import { installOpenWorldReportingUtilities } from "./open-world-reporting-utilities.mjs";

const installers = Object.freeze([
  installOpenWorldLocalCommands,
  installOpenWorldApplicationCommand,
  installOpenWorldPrepareRevisionCommand,
  installOpenWorldGitHubCommandEntry,
  installOpenWorldLocalSourceVerification,
  installOpenWorldApplicationPackage,
  installOpenWorldGitHubTransportPlan,
  installOpenWorldRemoteSourceVerification,
  installOpenWorldRemoteV2Policy,
  installOpenWorldPrepareRevisionDiscovery,
  installOpenWorldGitHubMutationExecution,
  installOpenWorldGitHubMutationPrimitives,
  installOpenWorldGitHubReceiptStore,
  installOpenWorldGitHubReceiptReconcile,
  installOpenWorldGitHubStatusHistory,
  installOpenWorldGitHubTransportUtilities,
  installOpenWorldFilesystemGitUtilities,
  installOpenWorldSnapshotSourceUtilities,
  installOpenWorldSourceClosureVerification,
  installOpenWorldApplicationAssembly,
  installOpenWorldMaterialization,
  installOpenWorldReportingUtilities
]);

export function createOpenWorldRuntime() {
  const runtime = Object.create(null);
  for (const install of installers) install(runtime);
  return runtime;
}
