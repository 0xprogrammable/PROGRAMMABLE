import { objectAt, resolvedText } from "./submission-analysis-helpers.mjs";
import {
  requireDetailedText,
  requirePresent
} from "./settlement-policy-core.mjs";

export function analyzeSubmissionCrossChainIdentity(context) {
  const { submission, add, gate, crossChain } = context;
  if (crossChain.used === true) {
    const crossChainPath = "$.capabilities.crossChain";
    const source = objectAt(crossChain, "source");
    const sourceNetwork = objectAt(source, "network");
    const sourceSender = objectAt(source, "authenticatedSender");
    const destination = objectAt(crossChain, "destination");
    const destinationNetwork = objectAt(destination, "network");
    const destinationReceiver = objectAt(destination, "receiver");
    const message = objectAt(crossChain, "message");
    const domainBindings = objectAt(message, "domainBindings");
    const finality = objectAt(crossChain, "finality");
    const ordering = objectAt(crossChain, "ordering");
    const staleness = objectAt(crossChain, "staleness");
    const fallback = objectAt(crossChain, "fallback");
    const quarantine = objectAt(crossChain, "quarantine");

    requirePresent(crossChain.direction, `${crossChainPath}.direction`, "CROSS_CHAIN_POLICY_INCOMPLETE", "Declare whether the launch-chain endpoint sends, receives, or uses a separately reviewed bidirectional route.", add);
    requirePresent(crossChain.localBridgeDependencyId, `${crossChainPath}.localBridgeDependencyId`, "CROSS_CHAIN_POLICY_INCOMPLETE", "Reference the exact pinned bridge contract on the launch chain.", add);
    requirePresent(crossChain.localBridgeAddress, `${crossChainPath}.localBridgeAddress`, "CROSS_CHAIN_POLICY_INCOMPLETE", "Bind the exact nonzero bridge contract address on the launch chain.", add);

    for (const field of ["namespace", "reference"]) {
      requirePresent(sourceNetwork[field], `${crossChainPath}.source.network.${field}`, "CROSS_CHAIN_SOURCE_POLICY_INCOMPLETE", "Bind the source network with one canonical namespace and reference.", add);
    }
    for (const field of ["encoding", "value"]) {
      requirePresent(sourceSender[field], `${crossChainPath}.source.authenticatedSender.${field}`, "CROSS_CHAIN_SOURCE_POLICY_INCOMPLETE", "Bind the exact authenticated source sender and its canonical encoding.", add);
    }
    requirePresent(source.domain, `${crossChainPath}.source.domain`, "CROSS_CHAIN_SOURCE_POLICY_INCOMPLETE", "Bind the exact bridge source domain identifier.", add);
    if (
      sourceNetwork.namespace === "eip155" &&
      resolvedText(sourceNetwork.reference) &&
      !/^[1-9][0-9]*$/.test(sourceNetwork.reference)
    ) {
      add("blocker", "CROSS_CHAIN_SOURCE_NETWORK_INVALID", `${crossChainPath}.source.network.reference`, "An eip155 source reference must be a canonical positive decimal chain id.", "Use the exact EIP-155 chain id without signs, prefixes or leading zeroes.");
    }
    if (
      destinationNetwork.namespace === "eip155" &&
      resolvedText(destinationNetwork.reference) &&
      !/^[1-9][0-9]*$/.test(destinationNetwork.reference)
    ) {
      add("blocker", "CROSS_CHAIN_DESTINATION_NETWORK_INVALID", `${crossChainPath}.destination.network.reference`, "An eip155 destination reference must be a canonical positive decimal chain id.", "Use the exact EIP-155 chain id without signs, prefixes or leading zeroes.");
    }
    const participantEncodingPatterns = {
      "evm-address": /^0x[a-fA-F0-9]{40}$/,
      bytes32: /^0x[a-fA-F0-9]{64}$/,
      base58: /^[1-9A-HJ-NP-Za-km-z]{3,128}$/,
      bech32: /^[a-z0-9]{8,200}$/,
      "bridge-native": /^\S{3,200}$/u
    };
    const validateParticipant = ({ identity, identityPath, label, codePrefix, gateId }) => {
      for (const field of ["encoding", "value"]) {
        requirePresent(identity[field], `${identityPath}.${field}`, `${codePrefix}_POLICY_INCOMPLETE`, `Bind the exact ${label} and its canonical encoding.`, add);
      }
      if (
        resolvedText(identity.encoding)
        && resolvedText(identity.value)
        && !participantEncodingPatterns[identity.encoding]?.test(identity.value)
      ) {
        add("blocker", `${codePrefix}_ENCODING_INVALID`, `${identityPath}.value`, `The ${label} does not match its declared encoding.`, `Use the exact bridge-authenticated ${label} in its canonical encoding.`);
      }
      if (identity.encoding === "bridge-native") {
        if (!resolvedText(identity.canonicalizationRule) || identity.canonicalizationRule.trim().length < 12) {
          add("blocker", `${codePrefix}_CANONICALIZATION_MISSING`, `${identityPath}.canonicalizationRule`, `The bridge-native ${label} has no exact canonicalization and derivation rule.`, "Define the bridge version, decoded fields, byte order, normalization and collision-free encoded form.");
        }
        gate(gateId, "candidate", `The model uses a bridge-native ${label} encoding.`);
      } else if (resolvedText(identity.canonicalizationRule)) {
        add("blocker", `${codePrefix}_CANONICALIZATION_CONFLICT`, `${identityPath}.canonicalizationRule`, `A canonical ${label} encoding declares an unrelated custom normalization rule.`, "Leave the custom rule null or select bridge-native and document the exact derivation.");
      }
      if (["evm-address", "bytes32"].includes(identity.encoding) && /^0x0+$/i.test(identity.value ?? "")) {
        add("blocker", "CROSS_CHAIN_ZERO_IDENTITY", `${identityPath}.value`, `The ${label} cannot be an all-zero identifier.`, `Bind the exact nonzero ${label} supplied by the reviewed bridge.`);
      }
    };
    validateParticipant({
      identity: sourceSender,
      identityPath: `${crossChainPath}.source.authenticatedSender`,
      label: "source sender",
      codePrefix: "CROSS_CHAIN_SOURCE_SENDER",
      gateId: "custom-cross-chain-source-identity-review"
    });

    for (const field of ["namespace", "reference"]) {
      requirePresent(destinationNetwork[field], `${crossChainPath}.destination.network.${field}`, "CROSS_CHAIN_DESTINATION_POLICY_INCOMPLETE", "Bind the destination network with one canonical namespace and reference.", add);
    }
    requirePresent(destination.domain, `${crossChainPath}.destination.domain`, "CROSS_CHAIN_DESTINATION_POLICY_INCOMPLETE", "Bind the exact bridge destination domain identifier.", add);
    validateParticipant({
      identity: destinationReceiver,
      identityPath: `${crossChainPath}.destination.receiver`,
      label: "destination receiver",
      codePrefix: "CROSS_CHAIN_DESTINATION_RECEIVER",
      gateId: "custom-cross-chain-destination-identity-review"
    });

    const allDependencies = [
      ...(submission.dependencies?.onchain ?? []),
      ...(submission.dependencies?.offchain ?? [])
    ];
    const validatePinnedCrossChainDependency = ({
      dependencyId,
      dependencyPath,
      expectedAddress,
      expectedAddressPath,
      unboundCode,
      notOnchainCode,
      unpinnedCode,
      addressMismatchCode,
      role
    }) => {
      if (!resolvedText(dependencyId)) return;
      const matchingDependencies = allDependencies.filter((dependency) => dependency?.id === dependencyId);
      const matchingOnchainDependencies = (submission.dependencies?.onchain ?? []).filter((dependency) => dependency?.id === dependencyId);
      if (matchingDependencies.length !== 1) {
        add("blocker", unboundCode, dependencyPath, `The ${role} dependency id must resolve to exactly one declared dependency.`, "Reference one unique dependency id and remove duplicate records.");
        return;
      }
      if (matchingOnchainDependencies.length !== 1) {
        add("blocker", notOnchainCode, dependencyPath, `The referenced ${role} record is not an onchain deployment.`, `Declare the exact ${role} contract in dependencies.onchain with pinned source and runtime evidence.`);
        return;
      }
      const dependency = matchingOnchainDependencies[0];
      const sourcePinned =
        ["pinned-source", "verified-explorer-source"].includes(dependency.sourceProvenance) &&
        resolvedText(dependency.repository) &&
        resolvedText(dependency.revision);
      const deploymentPinned =
        resolvedText(dependency.chainAddress) &&
        resolvedText(dependency.runtimeHash);
      if (!sourcePinned || !deploymentPinned) {
        add("blocker", unpinnedCode, dependencyPath, `The ${role} dependency lacks one immutable source commit and deployed runtime identity.`, "Pin the exact source commit, destination address and runtime hash.");
      }
      if (
        resolvedText(dependency.chainAddress) &&
        resolvedText(expectedAddress) &&
        dependency.chainAddress.toLowerCase() !== expectedAddress.toLowerCase()
      ) {
        add("blocker", addressMismatchCode, expectedAddressPath, `The declared ${role} address differs from its pinned onchain dependency.`, `Use the exact ${role} address from the reviewed deployment record.`);
      }
    };

    validatePinnedCrossChainDependency({
      dependencyId: crossChain.localBridgeDependencyId,
      dependencyPath: `${crossChainPath}.localBridgeDependencyId`,
      expectedAddress: crossChain.localBridgeAddress,
      expectedAddressPath: `${crossChainPath}.localBridgeAddress`,
      unboundCode: "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNBOUND",
      notOnchainCode: "CROSS_CHAIN_BRIDGE_DEPENDENCY_NOT_ONCHAIN",
      unpinnedCode: "CROSS_CHAIN_BRIDGE_DEPENDENCY_UNPINNED",
      addressMismatchCode: "CROSS_CHAIN_BRIDGE_CALLER_MISMATCH",
      role: "launch-chain bridge contract"
    });

    const sourceNetworkIdentity = resolvedText(sourceNetwork.namespace) && resolvedText(sourceNetwork.reference)
      ? `${sourceNetwork.namespace}:${sourceNetwork.reference}`
      : null;
    const destinationNetworkIdentity = resolvedText(destinationNetwork.namespace) && resolvedText(destinationNetwork.reference)
      ? `${destinationNetwork.namespace}:${destinationNetwork.reference}`
      : null;
    const launchNetworkIdentity = Number.isInteger(submission.target?.chainId)
      ? `eip155:${submission.target.chainId}`
      : null;
    if (sourceNetworkIdentity !== null && sourceNetworkIdentity === destinationNetworkIdentity) {
      add("blocker", "CROSS_CHAIN_SOURCE_DESTINATION_CONFLICT", `${crossChainPath}.source.network`, "The source and destination network identities are identical.", "Bind the two actual network identities for this route.");
    }
    if (crossChain.direction === "inbound-to-launch-chain" && destinationNetworkIdentity !== launchNetworkIdentity) {
      add("blocker", "CROSS_CHAIN_LOCAL_ENDPOINT_MISMATCH", `${crossChainPath}.destination.network`, "An inbound route does not terminate on the declared launch chain.", "Set the destination network to the exact launch-chain CAIP-2 identity.");
    }
    if (crossChain.direction === "outbound-from-launch-chain" && sourceNetworkIdentity !== launchNetworkIdentity) {
      add("blocker", "CROSS_CHAIN_LOCAL_ENDPOINT_MISMATCH", `${crossChainPath}.source.network`, "An outbound route does not originate on the declared launch chain.", "Set the source network to the exact launch-chain CAIP-2 identity.");
    }
    if (crossChain.direction === "bidirectional-reviewed") {
      if (sourceNetworkIdentity !== launchNetworkIdentity && destinationNetworkIdentity !== launchNetworkIdentity) {
        add("blocker", "CROSS_CHAIN_LOCAL_ENDPOINT_MISMATCH", `${crossChainPath}.direction`, "A bidirectional route does not bind either endpoint to the declared launch chain.", "Bind one endpoint to the launch chain and model both directional paths explicitly in source, tests and threat model.");
      }
      gate("bidirectional-cross-chain-architecture-review", "candidate", "Bidirectional cross-chain behavior requires separate per-direction authentication, replay, ordering, failure and liveness review.");
    }
    if (/^0x0{40}$/i.test(crossChain.localBridgeAddress ?? "")) {
      add("blocker", "CROSS_CHAIN_ZERO_ADDRESS", `${crossChainPath}.localBridgeAddress`, "The launch-chain bridge contract cannot be the zero address.", "Bind the exact nonzero address from the pinned bridge dependency.");
    }

    for (const field of ["identifierDerivation", "nonceDerivation", "payloadHashRule", "idempotencyKeyRule", "idempotencyStorage"]) {
      requireDetailedText(message[field], `${crossChainPath}.message.${field}`, "CROSS_CHAIN_MESSAGE_POLICY_INCOMPLETE", add);
    }
    for (const field of ["nonceScope", "duplicateBehavior"]) {
      requirePresent(message[field], `${crossChainPath}.message.${field}`, "CROSS_CHAIN_MESSAGE_POLICY_INCOMPLETE", "Define the exact nonce scope and duplicate-message behavior.", add);
    }
    if (message.nonceScope === "custom-reviewed") {
      if (!resolvedText(message.customNonceRule) || message.customNonceRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_CUSTOM_NONCE_RULE_MISSING", `${crossChainPath}.message.customNonceRule`, "The custom nonce scope has no exact derivation and collision boundary.", "Define the canonical nonce inputs, encoding, scope, reset behavior and collision resistance.");
      }
      gate("custom-cross-chain-nonce-review", "candidate", "The model uses a custom-reviewed cross-chain nonce scope.");
    } else if (resolvedText(message.customNonceRule)) {
      add("blocker", "CROSS_CHAIN_CUSTOM_NONCE_RULE_CONFLICT", `${crossChainPath}.message.customNonceRule`, "A standard nonce scope declares a custom nonce rule.", "Leave the custom rule null or select custom-reviewed and request the dedicated review.");
    }
    if (message.atomicConsumption !== true) {
      add("blocker", "CROSS_CHAIN_REPLAY_NOT_ATOMIC", `${crossChainPath}.message.atomicConsumption`, "The message idempotency key is not checked and consumed atomically with the destination action.", "Check and consume the exact key before any value or external call can be committed.");
    }
    for (const field of [
      "localBridgeDependencyId",
      "sourceNetwork",
      "sourceDomain",
      "sourceSender",
      "destinationNetwork",
      "destinationDomain",
      "destinationReceiver",
      "modelId",
      "poolId",
      "action",
      "payloadHash",
      "timestampOrExpiry",
      "messageId",
      "nonce"
    ]) {
      if (domainBindings[field] !== true) {
        add("blocker", "CROSS_CHAIN_DOMAIN_BINDING_INCOMPLETE", `${crossChainPath}.message.domainBindings.${field}`, "The message is not bound to every identity, execution domain and payload component required for replay safety.", "Authenticate and hash this field into the accepted message or idempotency boundary.");
      }
    }

    for (const field of ["mode", "minimumSourceConfirmations", "challengePeriodSeconds", "reorgBehavior"]) {
      requirePresent(finality[field], `${crossChainPath}.finality.${field}`, "CROSS_CHAIN_FINALITY_POLICY_INCOMPLETE", "Define the source-finality threshold, challenge window and reorg behavior.", add);
    }
    requireDetailedText(finality.attestationRule, `${crossChainPath}.finality.attestationRule`, "CROSS_CHAIN_FINALITY_POLICY_INCOMPLETE", add);
    if (finality.mode === "source-finalized" && (!Number.isInteger(finality.minimumSourceConfirmations) || finality.minimumSourceConfirmations < 1)) {
      add("blocker", "CROSS_CHAIN_FINALITY_CONFIRMATIONS_INVALID", `${crossChainPath}.finality.minimumSourceConfirmations`, "A source-finalized route needs a positive confirmation threshold.", "Set the reviewed source-chain confirmation threshold and test a reorg below it.");
    }
    if (finality.mode === "optimistic-challenge-window" && (!Number.isInteger(finality.challengePeriodSeconds) || finality.challengePeriodSeconds < 1)) {
      add("blocker", "CROSS_CHAIN_FINALITY_WINDOW_INVALID", `${crossChainPath}.finality.challengePeriodSeconds`, "An optimistic route needs a positive challenge period before execution.", "Set the reviewed challenge period and reject messages until it ends.");
    }
    if (finality.mode === "custom-reviewed") {
      if (!resolvedText(finality.customFinalityRule) || finality.customFinalityRule.trim().length < 12) {
        add("blocker", "CROSS_CHAIN_CUSTOM_FINALITY_RULE_MISSING", `${crossChainPath}.finality.customFinalityRule`, "The custom finality mode has no exact acceptance and reorg rule.", "Define the authenticated evidence, acceptance threshold, wait period, reorg boundary and failure behavior.");
      }
      gate("custom-cross-chain-finality-review", "candidate", "The model uses a custom-reviewed source-finality rule.");
    } else if (resolvedText(finality.customFinalityRule)) {
      add("blocker", "CROSS_CHAIN_CUSTOM_FINALITY_RULE_CONFLICT", `${crossChainPath}.finality.customFinalityRule`, "A standard finality mode declares a custom finality rule.", "Leave the custom rule null or select custom-reviewed and request the dedicated review.");
    }

  }
}
