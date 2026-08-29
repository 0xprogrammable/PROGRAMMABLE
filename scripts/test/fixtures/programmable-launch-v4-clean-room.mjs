import {
  validAdmissionReceiptV4,
  validExternalContractEvidenceReceiptV4,
  validExactWalletTransaction,
  validPreparedArtifactV4,
  validSimulationReceiptV4,
  validV4Capabilities,
  validV4Preflight,
  validV4Request,
  validV4Resource,
  v4RequestBytes,
} from "../../../packages/launch/test/fixtures/v4.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

export function validCleanRoomTranscript() {
  const request = validV4Request({
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-not-initialized",
      targetIds: [],
    },
  });
  const requestBytes = v4RequestBytes(request);
  const capabilities = validV4Capabilities();
  const preflight = validV4Preflight(request, requestBytes);
  const base = validV4Resource(request, requestBytes);
  const transaction = validExactWalletTransaction({
    from: request.launchWallet,
    valueWei: "0",
    commitments: base.commitments,
  });
  const withArtifact = {
    ...base,
    status: "wallet_action_required",
    walletTransactionPreimageHash: transaction.transactionPreimageHash,
    walletTransaction: transaction,
    preparedArtifact: validPreparedArtifactV4(base.commitments),
    updatedAt: "2026-08-30T01:00:00.000Z",
  };
  const resource = {
    ...withArtifact,
    admissionReceipt: validAdmissionReceiptV4(withArtifact),
    externalContractEvidenceReceipt: validExternalContractEvidenceReceiptV4(withArtifact),
    simulationReceipt: validSimulationReceiptV4(withArtifact),
  };
  const local = {
    schemaVersion: request.schemaVersion,
    chainId: request.chainId,
    caip2: request.caip2,
    chainDeploymentId: request.chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest: request.chainDeploymentDescriptorDigest,
    profile: request.profile,
    graphBundleHash: digest("1"),
    unboundGraphBundleHash: digest("2"),
    projectMetadataHash: digest("3"),
    verificationBundleHash: digest("4"),
    sourceBuildCommitment: digest("5"),
    launchIntentHash: digest("6"),
    exactSourceIncluded: true,
    predictions: [],
    requestSha256: preflight.rawRequestSha256,
    byteLength: requestBytes.length,
    reproducedFromConfig: true,
  };
  const remote = {
    ...local,
    remoteValidation: true,
    apiVersion: "v4",
    capabilitiesHttpStatus: 200,
    preflightHttpStatus: 200,
    capabilities,
    preflight,
    disposition: preflight.disposition,
    launchEligibility: preflight.launchEligibility,
    evidenceTier: preflight.evidenceTier,
    hardBlockFindingCodes: [],
    needsEvidenceFindingCodes: [],
    warningFindingCodes: [],
    remediations: [],
  };
  const submitResult = {
    idempotencyKey: `programmable-v4-clean-room-${"7".repeat(64)}`,
    requestSha256: local.requestSha256,
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    journalPath: "/private/transient/state.json",
    httpStatus: 201,
    retryAfter: null,
    resource,
  };
  const status = {
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    httpStatus: 200,
    stopped: true,
    terminal: false,
    reviewPending: false,
    reviewActionRequired: false,
    walletHandoffReady: true,
    walletHandoffStage: "router-transaction-required",
    resource,
  };
  return structuredClone({
    prepared: validPreparedHandoff(),
    request,
    local,
    remote,
    firstSubmit: structuredClone(submitResult),
    replaySubmit: structuredClone(submitResult),
    status,
    observedAt: "2026-08-30T01:01:00.000Z",
    apiKey: "TEST_CREDENTIAL_SENTINEL_NEVER_RECORD",
  });
}

export function validPreparedHandoff() {
  return {
    schemaVersion: "programmable.launch-v4-clean-room-prepared.v1",
    release: {
      repository: "programmablehq/PROGRAMMABLE",
      tag: "programmable-launch-v4.0.0",
      version: "4.0.0",
      source: {
        ref: "refs/heads/production",
        commitSha: "1".repeat(40),
        treeSha: "2".repeat(40),
      },
      machineContractBinding: {
        schemaVersion: "programmable.launch-cli-v4-release-binding.v1",
        path: "docs/operations/releases/custom-launch-v4/cli-release-binding.json",
        sha256: digest("3"),
      },
      assets: [
        ["programmable-launch-4.0.0.cdx.json", "4"],
        ["programmable-launch-4.0.0.release.json", "5"],
        ["programmable-launch-4.0.0.tgz", "6"],
        ["programmable-launch-4.0.0.tgz.sha256", "7"],
      ].map(([name, character]) => ({ name, bytes: 100, sha256: digest(character) })),
      attestation: {
        verified: true,
        signerWorkflow:
          "programmablehq/PROGRAMMABLE/.github/workflows/release-programmable-launch.yml",
        sourceRef: "refs/heads/production",
        sourceDigest: "1".repeat(40),
      },
    },
    bindings: {
      installTreeSha256: digest("8"),
      projectTreeSha256: digest("9"),
      configSha256: digest("a"),
      launchSha256: digest("b"),
      receiptSha256: digest("c"),
      localValidationSha256: digest("d"),
    },
  };
}
