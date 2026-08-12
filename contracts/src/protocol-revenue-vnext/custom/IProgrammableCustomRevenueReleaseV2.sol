// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolRevenueSourceConfigV1 } from "../IProgrammableProtocolFeeSourceV1.sol";

/// @notice Exact core-registry surface consumed by the future-Custom release bridge.
interface IProtocolRevenueSourceRegistryCustomRegistrarV1 {
    function CHAIN_ID() external view returns (uint256);
    function MIN_ACTIVATION_DELAY_BLOCKS() external view returns (uint64);
    function CLAIM_SELECTOR() external view returns (bytes4);
    function SOURCE_INTERFACE_ID() external view returns (bytes4);
    function rewardWallet() external view returns (address);

    function computeSourceId(ProtocolRevenueSourceConfigV1 calldata config) external view returns (bytes32);
    function proposeSource(ProtocolRevenueSourceConfigV1 calldata config) external returns (bytes32 proposalHash);

    function sourceState(bytes32 sourceId)
        external
        view
        returns (ProtocolRevenueSourceConfigV1 memory config, bool registered, bool quarantined);

    function isExecutable(bytes32 sourceId) external view returns (bool);
}

/// @notice Required fee-rate view for a future Custom native fee source.
interface IProgrammableCustomFeeSourceV2 {
    function programmableFeeBps(address asset) external view returns (uint16 feeBps);
}

/// @notice Closed predeployment approval state required from the future production Custom Registry V2.
struct CustomRevenueApprovalStateV2 {
    bytes32 launchId;
    address launchWallet;
    bytes32 launchClassId;
    bytes32 approvalBindingHash;
    bytes32 registrationBindingHash;
    address approvedFactory;
    bytes32 approvedFactoryRuntimeCodeHash;
    address create2Deployer;
    bytes32 create2DeployerRuntimeCodeHash;
    bytes32 create2Salt;
    bytes32 creationCodeHash;
    bytes32 templateCommitment;
    address source;
    bytes32 sourceRuntimeCodeHash;
    address asset;
    bytes4 claimSelector;
    bytes4 standardInterfaceId;
    address recipient;
    uint16 programmableFeeBps;
    uint64 activationBlock;
    uint64 validAfterBlock;
    uint64 expiresAtBlock;
    bytes32 evidenceHash;
    bool consumed;
}

enum CustomRevenueLaunchStatusV2 {
    None,
    Observed,
    Finalized,
    Revoked
}

/// @notice Finalized executable-revenue record required from the future production Custom Registry V2.
/// @dev `observedAtBlock` must be the exact Launch Stamp block. V2 is responsible for canonical-block/finality
///      verification before it changes `status` to `Finalized`.
struct CustomRevenueLaunchStateV2 {
    CustomRevenueLaunchStatusV2 status;
    uint64 observedAtBlock;
    uint64 finalizedAtBlock;
    bytes32 approvalId;
    bytes32 launchClassId;
    bytes32 approvalBindingHash;
    bytes32 registrationBindingHash;
    bytes32 finalityEvidenceHash;
    address launchWallet;
    address approvedFactory;
    bytes32 approvedFactoryRuntimeCodeHash;
    address create2Deployer;
    bytes32 create2DeployerRuntimeCodeHash;
    bytes32 create2Salt;
    bytes32 creationCodeHash;
    bytes32 templateCommitment;
    address sourceRegistry;
    bytes32 sourceRegistryRuntimeCodeHash;
    bytes32 sourceId;
    address source;
    bytes32 sourceRuntimeCodeHash;
    address asset;
    bytes4 claimSelector;
    bytes4 standardInterfaceId;
    address recipient;
    uint16 programmableFeeBps;
    uint64 activationBlock;
    uint64 sourceActivatedAtBlock;
    bytes32 sourceActivatedAtBlockHash;
    bytes32 sourceActivationTransactionHash;
    uint32 sourceActivationTransactionIndex;
    uint32 sourceActivationLogIndex;
    uint256 sourceActivatedTotalClaimedBaseline;
    address launchStampRouter;
    bytes32 launchStampRouterRuntimeCodeHash;
    bytes32 launchStampHash;
    uint64 launchStampBlockNumber;
    bytes32 launchStampBlockHash;
}

/// @notice Revenue-specific read contract that production Custom Registry V2 must expose.
/// @dev Registry V1 has no equivalent executable binding and is intentionally incompatible with this interface.
interface IProgrammableCustomRevenueRegistryV2 {
    function CHAIN_ID() external view returns (uint256);
    function REGISTRY_GENERATION() external view returns (uint64);
    function MINIMUM_FINALITY_BLOCKS() external view returns (uint64);

    function approvalState(bytes32 approvalId) external view returns (CustomRevenueApprovalStateV2 memory state);
    function revenueLaunch(bytes32 launchId) external view returns (CustomRevenueLaunchStateV2 memory state);
}

/// @notice Frozen Launch Stamp Router V1 record shape used by production discovery.
struct ProgrammableLaunchStampRecordV1 {
    uint8 kind;
    address launchWallet;
    address token;
    address hook;
    address poolManager;
    bytes32 poolId;
    bytes32 poolKeyHash;
    bytes32 componentSetHash;
    bytes32 routePayloadHash;
    address routeLauncher;
    bytes32 routeLauncherRuntimeCodeHash;
    bytes32 expectedResultHash;
    bytes32 permitDigest;
    bytes32 stampHash;
}

interface IProgrammableLaunchStampRouterV1 {
    function CHAIN_ID() external view returns (uint256);
    function launchStamp(bytes32 launchId) external view returns (ProgrammableLaunchStampRecordV1 memory record);
    function launchIdByComponent(address component) external view returns (bytes32 launchId);
    function componentRuntimeCodeHash(address component) external view returns (bytes32 runtimeCodeHash);
    function stampProof(address component) external view returns (bytes32 launchId, bytes32 stampHash);
}
