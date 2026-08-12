// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "./IProgrammableUniversalLaunchKernelV1.sol";

/// @notice Closed typed ABI for the configurable-identity Hookemon atomic launcher review candidate.
/// @dev Only `tokenName` and `tokenSymbol` are dynamic. Both remain typed and bounded; there is no arbitrary bytes
///      payload. The exact constructor encoding is 1,440-1,472 bytes at source 55fd47ce / tree 2667ff1b.
interface IProgrammableExactHookemonNormalCreateProfileV1 is IProgrammableRuntimeBindingV1 {
    enum TokenIdentityPolicyV1 {
        None,
        PlatformSelectedBounded
    }

    struct LaunchConfigV1 {
        address poolManager;
        address positionManager;
        address usdc;
        address tokenMessengerV2;
        address messageTransmitterV2;
        address fundingWallet;
        address approvedMultisig;
        address executor;
        address artifactAuthorizer;
        bytes32 solanaUsdcAta;
        bytes32 solanaUsdcMint;
        bytes32 solanaReturnAuthority;
        bytes32 solanaTokenMessenger;
        uint32 solanaDomain;
        uint16 outboundProtocolFeeCapBps;
        uint256 outboundForwardFeeCapMicroUsdc;
        uint64 scheduleAnchor;
        bytes32 tokenSalt;
        bytes32 hookSalt;
        uint8 launcherMode;
        address distributorFactory;
        address outboundBridgeFactory;
        address returnAdapterFactory;
        address cycleVaultFactory;
        address treasuryVestingFactory;
        address positionTimelockFactory;
        uint24 poolFee;
        int24 tickSpacing;
        int24 tickLower;
        int24 tickUpper;
        uint160 initialSqrtPriceX96;
        uint256 liquidityUsdcAmount;
        uint256 cycleBootstrapUsdcAmount;
        uint256 positionRoundingDust;
        uint64 positionUnlockAt;
        uint128 expectedPositionLiquidity;
        string tokenName;
        string tokenSymbol;
    }

    /// @dev Exclusive roles, in order: launcher, token, hook, distributor, outbound bridge, return adapter,
    ///      cycle vault, treasury vesting and position timelock.
    struct ExclusiveComponentsV1 {
        address[9] accounts;
        bytes32[9] runtimeCodeHashes;
    }

    /// @dev Shared roles, in order: hook factory, child registry, six fixed child factories and the six child
    ///      creation-code chunks (one per factory in the exact reviewed graph).
    struct SharedComponentsV1 {
        address[14] accounts;
        bytes32[14] runtimeCodeHashes;
    }

    struct ExactHookemonPlanV1 {
        uint16 schemaVersion;
        address applicantWallet;
        bytes32 sourceLaunchId;
        uint64 githubRepositoryId;
        bytes32 repositoryKey;
        address repositoryLineageRegistry;
        bytes32 presentationBindingHash;
        bytes32 tokenNameHash;
        bytes32 tokenSymbolHash;
        bytes32 completeInitCodeHash;
        bytes32 poolManagerRuntimeCodeHash;
        bytes32 canonicalPoolId;
        uint256 expectedPositionTokenId;
        bytes32 expectedLaunchConfigHash;
        bytes32 expectedLaunchId;
        bytes32 expectedLaunchHash;
        LaunchConfigV1 config;
        ExclusiveComponentsV1 exclusive;
        SharedComponentsV1 shared;
        bytes32 expectedArchitectureStateHash;
        bytes32 expectedPoolStateHash;
        bytes32 expectedRevenueStateHash;
    }

    struct PlanCommitmentsV1 {
        bytes32 planHash;
        bytes32 componentGraphHash;
        bytes32 componentSetHash;
        bytes32 componentRuntimeSetHash;
        bytes32 configurationHash;
        bytes32 valueFlowHash;
    }

    struct LaunchTransportV1 {
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 currentness;
        bytes currentnessSignature;
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 walletIntent;
        bytes walletSignature;
    }

    function launchExactHookemonV1(
        bytes32 grantDigest,
        ExactHookemonPlanV1 calldata plan,
        LaunchTransportV1 calldata transport
    ) external returns (bytes32 receiptCoreHash);

    function predictedLauncherV1() external view returns (address launcher);

    function tokenIdentityPolicyV1() external pure returns (TokenIdentityPolicyV1 policy);

    function tokenIdentityConstraintsHashV1() external pure returns (bytes32 constraintsHash);

    function computeExactHookemonPlanCommitmentsV1(ExactHookemonPlanV1 calldata plan)
        external
        pure
        returns (PlanCommitmentsV1 memory commitments);

    function exactHookemonReservationsV1(ExactHookemonPlanV1 calldata plan)
        external
        view
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations);

    function computeExactHookemonPreflightHashV1(ExactHookemonPlanV1 calldata plan)
        external
        view
        returns (bytes32 profilePreflightReadbackHash);
}

interface IProgrammableExactHookemonLauncherCodeStoreV1 is IProgrammableRuntimeBindingV1 {
    function creationCodeHashV1() external view returns (bytes32);

    function creationCodeLengthV1() external view returns (uint256);

    function partV1(uint256 index) external view returns (address account, bytes32 runtimeCodeHash, uint256 dataLength);

    function readCreationCodeV1() external view returns (bytes memory creationCode);
}

interface IProgrammableExactHookemonPostconditionVerifierV1 is IProgrammableRuntimeBindingV1 {
    function tokenIdentityConstraintsHashV1() external pure returns (bytes32 constraintsHash);

    function validateTokenIdentityV1(string calldata tokenName, string calldata tokenSymbol)
        external
        pure
        returns (bytes32 tokenNameHash, bytes32 tokenSymbolHash);

    function expectedLauncherRuntimeCodeHashV1() external view returns (bytes32);

    function expectedArchitectureStateHashV1() external view returns (bytes32);

    function expectedPoolStateHashV1() external view returns (bytes32);

    function expectedRevenueStateHashV1() external view returns (bytes32);

    function expectedTokenNameHashV1() external view returns (bytes32);

    function expectedTokenSymbolHashV1() external view returns (bytes32);

    function verifierModulesV1()
        external
        view
        returns (
            address architectureModule,
            bytes32 architectureModuleRuntimeCodeHash,
            bytes32 architectureModuleBindingHash,
            address economicModule,
            bytes32 economicModuleRuntimeCodeHash,
            bytes32 economicModuleBindingHash
        );

    function verifyExactHookemonPostconditionsV1(address launcher)
        external
        view
        returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash);
}
