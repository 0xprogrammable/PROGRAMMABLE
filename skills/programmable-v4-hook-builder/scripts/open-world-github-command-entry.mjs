import { CliFailure, SHA256_PATTERN, canonicalJson, createGhTransport, fs, path } from "./open-world-shared.mjs";

export function installOpenWorldGitHubCommandEntry(runtime) {
  const acquireApplicationV3MutationReceiptLock = (...args) => runtime.acquireApplicationV3MutationReceiptLock(...args);
  const applicationRequiresLocalManifestReplay = (...args) => runtime.applicationRequiresLocalManifestReplay(...args);
  const executeConfirmedApplicationV3GitHubTransport = (...args) => runtime.executeConfirmedApplicationV3GitHubTransport(...args);
  const inspectApplicationV3MutationReceiptLock = (...args) => runtime.inspectApplicationV3MutationReceiptLock(...args);
  const loadApplicationV3MutationReceipt = (...args) => runtime.loadApplicationV3MutationReceipt(...args);
  const loadApplicationV3TransportPackage = (...args) => runtime.loadApplicationV3TransportPackage(...args);
  const planApplicationV3GitHubTransport = (...args) => runtime.planApplicationV3GitHubTransport(...args);
  const publicGitHubMutationLedger = (...args) => runtime.publicGitHubMutationLedger(...args);
  const readApplicationV3GitHubStatus = (...args) => runtime.readApplicationV3GitHubStatus(...args);
  const reconcileApplicationV3MutationReceipt = (...args) => runtime.reconcileApplicationV3MutationReceipt(...args);
  const releaseApplicationV3MutationReceiptLock = (...args) => runtime.releaseApplicationV3MutationReceiptLock(...args);
  const resolveApplicationV3MutationReceiptPath = (...args) => runtime.resolveApplicationV3MutationReceiptPath(...args);
  const throwGitHubTransportIntegrationHold = (...args) => runtime.throwGitHubTransportIntegrationHold(...args);
  const verifyApplicationV3LocalTransportSources = (...args) => runtime.verifyApplicationV3LocalTransportSources(...args);

  async function executeGitHubTransport(operation, options, positionals) {
    if (operation === "update" && options.pullRequest === null) {
      throw new CliFailure("USAGE_ERROR", "update requires --pull-request <number>");
    }
    if (options.dryRun && options.confirmExternalWrite !== null) {
      throw new CliFailure("USAGE_ERROR", "--dry-run and --confirm-external-write are mutually exclusive");
    }
    if (options.resume && options.mutationReceipt === null) {
      throw new CliFailure("USAGE_ERROR", "--resume requires --mutation-receipt <absolute-json>");
    }
    const applicationPackage = loadApplicationV3TransportPackage(positionals[0]);
    const sourceRoots = Array.isArray(options.sourceRoots) ? options.sourceRoots : [];
    if (applicationRequiresLocalManifestReplay(applicationPackage.application) && sourceRoots.length === 0) {
      throwGitHubTransportIntegrationHold("manifest transport requires exact --source-root mappings for a fresh local verifier replay before any GitHub request");
    }
    const localSourceReplay = sourceRoots.length > 0
      ? await verifyApplicationV3LocalTransportSources({ applicationPackage, sourceRootValues: sourceRoots })
      : null;
    const transport = createGhTransport();
    const receiptPath = options.mutationReceipt === null
      ? null
      : resolveApplicationV3MutationReceiptPath(options.mutationReceipt, applicationPackage.root);
    const receiptLock = receiptPath !== null && options.confirmExternalWrite !== null
      ? acquireApplicationV3MutationReceiptLock(receiptPath)
      : null;
    try {
    if (receiptPath !== null && fs.existsSync(receiptPath)) {
      if (!options.resume) {
        throw new CliFailure("MUTATION_RECEIPT_EXISTS", "an existing mutation receipt may only be inspected or continued with --resume", { exitCode: 1 });
      }
      const receipt = loadApplicationV3MutationReceipt(receiptPath, {
        operation,
        applicationPackage,
        pullRequestNumber: options.pullRequest,
        localSourceReplay
      });
      if (
        options.confirmExternalWrite !== null
        && (
          !SHA256_PATTERN.test(options.confirmExternalWrite)
          || options.confirmExternalWrite !== receipt.confirmationDigest
        )
      ) {
        throw new CliFailure(
          "EXTERNAL_WRITE_CONFIRMATION_REQUIRED",
          "resuming requires the exact original confirmation digest bound by the mutation receipt",
          { exitCode: 1, details: { currentConfirmationDigest: receipt.confirmationDigest } }
        );
      }
      const reconciled = await reconcileApplicationV3MutationReceipt({
        receipt,
        receiptPath,
        applicationPackage,
        transport,
        localSourceReplay,
        persist: options.confirmExternalWrite !== null,
        receiptLock
      });
      if (options.confirmExternalWrite === null) return reconciled.result;
      if (!reconciled.resumable) {
        throw new CliFailure("MUTATION_RECEIPT_RECONCILIATION_REQUIRED", "the mutation receipt contains an outcome that cannot be resumed without maintainer reconciliation", {
          exitCode: 1,
          details: { mutationLedger: publicGitHubMutationLedger(reconciled.journal) }
        });
      }
      return await executeConfirmedApplicationV3GitHubTransport({
        operation,
        applicationPackage,
        transport,
        plan: receipt.plan,
        localSourceReplay,
        receiptPath,
        receiptLock,
        existingJournal: reconciled.journal
      });
    }
    if (options.resume) {
      throw new CliFailure("MUTATION_RECEIPT_NOT_FOUND", "--resume requires an existing exact mutation receipt", {
        exitCode: 1,
        details: {
          executionLock: inspectApplicationV3MutationReceiptLock(receiptPath)
        }
      });
    }
    const plan = await planApplicationV3GitHubTransport({
      operation,
      applicationPackage,
      transport,
      pullRequestNumber: options.pullRequest,
      localSourceReplay
    });
    if (options.confirmExternalWrite === null) {
      return {
        ...plan,
        mutationReceipt: {
          requiredForExecution: true,
          suppliedPath: receiptPath,
          crashRecovery: "atomic-replace-fsync-file-and-parent-directory"
        }
      };
    }
    if (
      !SHA256_PATTERN.test(options.confirmExternalWrite)
      || options.confirmExternalWrite !== plan.confirmationDigest
    ) {
      throw new CliFailure(
        "EXTERNAL_WRITE_CONFIRMATION_REQUIRED",
        "the exact freshly recomputed GitHub write plan must be authorized with its current confirmation digest",
        { exitCode: 1, details: { currentConfirmationDigest: plan.confirmationDigest } }
      );
    }
    const refreshedLocalSourceReplay = sourceRoots.length > 0
      ? await verifyApplicationV3LocalTransportSources({ applicationPackage, sourceRootValues: sourceRoots })
      : null;
    if (canonicalJson(refreshedLocalSourceReplay) !== canonicalJson(localSourceReplay)) {
      throw new CliFailure("APPLICATION_SOURCE_CHANGED", "the exact local source replay changed after confirmation and before the first external write", { exitCode: 1 });
    }
    if (receiptPath === null) {
      throw new CliFailure(
        "MUTATION_RECEIPT_REQUIRED",
        "confirmed Application V3 GitHub writes require --mutation-receipt at one new absolute local JSON path",
        { exitCode: 2 }
      );
    }
    return await executeConfirmedApplicationV3GitHubTransport({
      operation,
      applicationPackage,
      transport,
      plan,
      localSourceReplay: refreshedLocalSourceReplay,
      receiptPath,
      receiptLock
    });
    } finally {
      if (receiptLock !== null) releaseApplicationV3MutationReceiptLock(receiptLock);
    }
  }

  async function executeGitHubStatus(options, positionals) {
    if (options.pullRequest === null) {
      throw new CliFailure("USAGE_ERROR", "status requires --pull-request <number>");
    }
    const applicationPackage = loadApplicationV3TransportPackage(positionals[0]);
    const sourceRoots = Array.isArray(options.sourceRoots) ? options.sourceRoots : [];
    const localSourceReplay = sourceRoots.length > 0
      ? await verifyApplicationV3LocalTransportSources({ applicationPackage, sourceRootValues: sourceRoots })
      : null;
    return readApplicationV3GitHubStatus({
      applicationPackage,
      transport: createGhTransport(),
      pullRequestNumber: options.pullRequest,
      localSourceReplay
    });
  }

  Object.assign(runtime, {
    executeGitHubTransport,
    executeGitHubStatus
  });
}
