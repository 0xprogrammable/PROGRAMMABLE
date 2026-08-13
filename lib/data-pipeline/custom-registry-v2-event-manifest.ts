import { parseAbi, type Abi } from "viem";

export const CUSTOM_REGISTRY_V2_EVENT_SIGNATURES = Object.freeze([
  "CustomLaunchApprovalAuthorizedV2(bytes32 indexed approvalId, bytes32 indexed descriptorHash, uint64 validAfterBlock, uint64 expiresAtBlock, bytes32 approvalEvidenceHash, uint64 transitionSequence)",
  "CustomLaunchRegisteredV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, address indexed primaryContract, bytes32 approvalId, bytes32 approvalEvidenceHash, bytes32 registrationEvidenceHash, uint64 observedAtBlock, uint64 transitionSequence)",
  "CustomLaunchDescriptorCommittedV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, address indexed primaryContract, address launchWallet, bytes32 primaryRuntimeCodeHash, bytes32 componentSetHash, bytes32 projectCommitment, uint8 marketMode, uint16 protocolFeeBps)",
  "CustomLaunchDescriptorEvidenceCommittedV2(bytes32 indexed launchId, bytes32 indexed sourceArtifactHash, bytes32 indexed configurationHash, bytes32 launchPlanHash)",
  "CustomLaunchFinalizedV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, bytes32 indexed finalityEvidenceHash, uint64 observedAtBlock, bytes32 observedBlockHash, uint64 confirmedHeadBlock, bytes32 confirmedHeadBlockHash, uint64 finalizedAtBlock, uint64 transitionSequence)",
  "CustomLaunchRevokedV2(bytes32 indexed launchId, bytes32 indexed descriptorHash, bytes32 indexed revocationEvidenceHash, bytes32 reasonHash, uint64 revokedAtBlock, uint64 transitionSequence)",
] as const);

/** Event-only ABI used by the generation 2 projector before its deployment. */
export const CUSTOM_REGISTRY_V2_EVENT_ABI: Abi = Object.freeze(
  parseAbi(CUSTOM_REGISTRY_V2_EVENT_SIGNATURES.map(
    (signature) => `event ${signature}`,
  )),
);
