// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "./IProgrammableUniversalLaunchKernelV1.sol";
import {
    IProgrammableExactHookemonLauncherCodeStoreV1,
    IProgrammableExactHookemonNormalCreateProfileV1,
    IProgrammableExactHookemonPostconditionVerifierV1
} from "./IProgrammableExactHookemonNormalCreateProfileV1.sol";
import { IProgrammableGithubRepositoryLineageRegistryV1 } from "./IProgrammableGithubRepositoryLineageRegistryV1.sol";

interface IExactHookemonApprovalAssetV1 {
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IExactHookemonLineageRegistryAuthorizationV1 {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @notice Shared implementation for the one-shot Hookemon atomic NORMAL_CREATE profile and its test harness.
/// @dev There is no arbitrary target, selector, calldata, initcode, value-forwarding, delegatecall or sweep surface.
///      The only created initcode is reconstructed from the immutable two-part store and the bounded typed
///      Hookemon constructor tuple. Kernel begin, CREATE, exact postflight and Kernel finalize share one transaction.
abstract contract ProgrammableExactHookemonNormalCreateProfileBaseV1 is
    IProgrammableExactHookemonNormalCreateProfileV1
{
    uint16 internal constant PLAN_SCHEMA_VERSION = 1;
    uint256 internal constant MINIMUM_CONSTRUCTOR_ARGUMENT_BYTES = 1440;
    uint256 internal constant MAXIMUM_CONSTRUCTOR_ARGUMENT_BYTES = 1472;
    uint256 internal constant MAXIMUM_INITCODE_BYTES = 49_152;
    uint64 internal constant EXPECTED_CREATE_NONCE = 1;
    bytes20 internal constant SOURCE_COMMIT_ID = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 internal constant SOURCE_TREE_ID = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes32 public constant REVIEWED_LAUNCHER_CREATION_CODE_HASH =
        0xc2314bf561f2304acb421eefb441e3a908542629cc6fd910896cbc48dbd1664e;
    uint256 public constant REVIEWED_LAUNCHER_CREATION_CODE_LENGTH = 45_393;
    uint64 internal constant GITHUB_REPOSITORY_ID = 1_324_982_531;
    bytes32 internal constant SOURCE_REPOSITORY_KEY =
        keccak256(abi.encode("programmable.github.repository.v1", GITHUB_REPOSITORY_ID));
    bytes32 internal constant REPOSITORY_LINEAGE_CONSUMER_ROLE =
        keccak256("programmable.github-repository-lineage.consumer.v1");
    uint24 internal constant LP_FEE_PIPS = 3000;
    bytes32 public constant TOKEN_IDENTITY_POLICY_HASH = keccak256("platform_selected_bounded_identity_v1");
    bytes32 internal constant TOKEN_IDENTITY_CONSTRAINTS_HASH =
        0xbaa83b5dc37144910dc459fa3d6f6dfded2b4ef536f5f1a952b2e521c81f7160;

    bytes32 public constant REVENUE_POLICY_HASH = keccak256(
        "HookemonInclusiveQuoteFeeV1(totalHundredthsOfBip=30000,projectHundredthsOfBip=29000,programmableHundredthsOfBip=1000,programmableFeeOwner=0x4957f49620AFf3Adbbe8195a4f633E49cc93376c,lpFeePips=3000,lpFeeSeparate=true,externalAdditiveFee=false)"
    );
    bytes32 public constant PLAN_TYPEHASH = keccak256(
        "ExactHookemonNormalCreatePlanV1(bytes32 sourceIdentityHash,bytes32 actionHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 configurationHash,bytes32 expectedStateHash,bytes32 valueFlowHash)"
    );
    bytes32 private constant PLAN_SOURCE_IDENTITY_TYPEHASH = keccak256(
        "ExactHookemonPlanSourceIdentityV1(uint16 schemaVersion,address applicantWallet,bytes32 sourceLaunchId,uint64 githubRepositoryId,bytes32 repositoryKey,address repositoryLineageRegistry,bytes32 presentationBindingHash)"
    );
    bytes32 private constant ACTION_TYPEHASH = keccak256(
        "ExactHookemonNormalCreateActionV1(address launcher,bytes32 completeInitCodeHash,bytes32 launcherRuntimeCodeHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 canonicalPoolId,uint256 expectedPositionTokenId,bytes32 expectedLaunchConfigHash,bytes32 expectedLaunchId,bytes32 expectedLaunchHash)"
    );
    bytes32 private constant EXCLUSIVE_COMPONENT_TYPEHASH =
        keccak256("ExactHookemonExclusiveComponentV1(uint8 role,address account,bytes32 runtimeCodeHash)");
    bytes32 private constant SHARED_COMPONENT_TYPEHASH =
        keccak256("ExactHookemonSharedComponentV1(uint8 role,address account,bytes32 runtimeCodeHash)");
    bytes32 private constant GRAPH_TYPEHASH = keccak256(
        "ExactHookemonGraphV1(bytes32 exclusiveHead,bytes32 sharedHead,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 canonicalPoolId)"
    );
    bytes32 private constant CONFIGURATION_TYPEHASH = keccak256(
        "ExactHookemonConfigurationV1(uint64 githubRepositoryId,bytes32 repositoryKey,address repositoryLineageRegistry,bytes32 presentationBindingHash,bytes32 tokenNameHash,bytes32 tokenSymbolHash,bytes32 launchConfigHash,bytes32 completeInitCodeHash,bytes32 expectedLaunchConfigHash,bytes32 expectedLaunchId,bytes32 expectedLaunchHash)"
    );
    bytes32 private constant EXPECTED_STATE_TYPEHASH = keccak256(
        "ExactHookemonExpectedStateV1(bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash)"
    );
    bytes32 private constant VALUE_FLOW_TYPEHASH = keccak256(
        "ExactHookemonValueFlowV1(address fundingWallet,address usdc,address launcher,uint256 liquidityUsdcAmount,uint256 cycleBootstrapUsdcAmount,uint256 exactApproval,uint256 nativeValue)"
    );
    bytes32 private constant EXACT_CONTRACT_BINDING_TYPEHASH = keccak256(
        "ExactHookemonContractBindingV1(bytes20 sourceCommit,bytes20 sourceTree,uint64 githubRepositoryId,bytes32 repositoryKey,bytes32 launcherCreationCodeHash,uint256 launcherCreationCodeLength,uint256 minimumConstructorArgumentBytes,uint256 maximumConstructorArgumentBytes,uint64 createNonce,bytes32 tokenIdentityPolicyHash,bytes32 tokenIdentityConstraintsHash)"
    );
    bytes32 private constant PROFILE_DEPENDENCY_BINDING_TYPEHASH = keccak256(
        "ExactHookemonProfileDependencyBindingV1(address kernel,bytes32 kernelRuntimeCodeHash,address codeStore,bytes32 codeStoreRuntimeCodeHash,bytes32 codeStoreBindingHash,address verifier,bytes32 verifierRuntimeCodeHash,bytes32 verifierBindingHash,bytes32 verifierModuleSetHash,address repositoryLineageRegistry,bytes32 repositoryLineageRegistryRuntimeCodeHash)"
    );
    bytes32 private constant VERIFIER_MODULE_SET_TYPEHASH = keccak256(
        "ExactHookemonVerifierModuleSetV1(address architectureModule,bytes32 architectureModuleRuntimeCodeHash,bytes32 architectureModuleBindingHash,address economicModule,bytes32 economicModuleRuntimeCodeHash,bytes32 economicModuleBindingHash)"
    );
    bytes32 private constant PROFILE_RUNTIME_BINDING_TYPEHASH = keccak256(
        "ExactHookemonProfileRuntimeBindingV1(uint256 chainId,address profile,bytes32 profileKey,bytes32 dependencyBindingHash,bytes32 exactContractBindingHash,bytes32 revenuePolicyHash,bytes32 actionTypeHash)"
    );
    bytes32 private constant SHARED_RESERVATION_IDENTITY_TYPEHASH =
        keccak256("ExactHookemonSharedReservationIdentityV1(uint8 role,address account,bytes32 runtimeCodeHash)");
    bytes32 private constant PROVIDER_RESULT_TYPEHASH = keccak256(
        "ExactHookemonProviderResultV1(bytes32 executionKey,address profile,uint64 createNonce,address launcher,bytes32 completeInitCodeHash,bytes32 launcherRuntimeCodeHash)"
    );
    bytes32 private constant POSTCONDITION_TYPEHASH = keccak256(
        "ExactHookemonPostconditionV1(address launcher,bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash)"
    );
    bytes32 private constant DEPLOYMENT_LINEAGE_TYPEHASH = keccak256(
        "ExactHookemonNormalCreateLineageV1(address deployer,uint64 nonce,address launcher,bytes32 completeInitCodeHash)"
    );
    bytes32 private constant PROFILE_PREFLIGHT_TYPEHASH = keccak256(
        "ExactHookemonProfilePreflightV1(address profile,address launcher,bytes32 planHash,bytes32 configurationHash,bytes32 exclusiveHead,bytes32 sharedHead,address poolManager,bytes32 poolManagerRuntimeCodeHash,address approvalAsset,uint256 exactApproval,bytes32 codeStoreBindingHash,bytes32 verifierBindingHash)"
    );

    IProgrammableUniversalLaunchKernelV1 public immutable KERNEL;
    bytes32 public immutable KERNEL_RUNTIME_CODEHASH;
    IProgrammableExactHookemonLauncherCodeStoreV1 public immutable CODE_STORE;
    bytes32 public immutable CODE_STORE_RUNTIME_CODEHASH;
    bytes32 public immutable CODE_STORE_BINDING_HASH;
    IProgrammableExactHookemonPostconditionVerifierV1 public immutable POSTCONDITION_VERIFIER;
    bytes32 public immutable POSTCONDITION_VERIFIER_RUNTIME_CODEHASH;
    bytes32 public immutable VERIFIER_BINDING_HASH;
    address public immutable ARCHITECTURE_VERIFIER_MODULE;
    bytes32 public immutable ARCHITECTURE_VERIFIER_MODULE_RUNTIME_CODEHASH;
    bytes32 public immutable ARCHITECTURE_VERIFIER_MODULE_BINDING_HASH;
    address public immutable ECONOMIC_VERIFIER_MODULE;
    bytes32 public immutable ECONOMIC_VERIFIER_MODULE_RUNTIME_CODEHASH;
    bytes32 public immutable ECONOMIC_VERIFIER_MODULE_BINDING_HASH;
    IProgrammableGithubRepositoryLineageRegistryV1 public immutable REPOSITORY_LINEAGE_REGISTRY;
    bytes32 public immutable REPOSITORY_LINEAGE_REGISTRY_RUNTIME_CODEHASH;
    bytes32 public immutable PROFILE_KEY;
    bytes32 public immutable EXACT_CONTRACT_BINDING_HASH;
    bytes32 public immutable PROVIDER_BINDING_HASH;
    uint32 public immutable VERIFIER_GAS_LIMIT;

    uint8 private _executionState;
    address public launched;

    struct ExecutionCorrelationV1 {
        bytes32 grantDigest;
        bytes32 stampLaunchId;
        bytes32 executionKey;
        bytes32 reservationSetHash;
        uint256 balanceBefore;
    }

    struct VerifierModulesV1 {
        address architectureModule;
        bytes32 architectureRuntimeCodeHash;
        bytes32 architectureBindingHash;
        address economicModule;
        bytes32 economicRuntimeCodeHash;
        bytes32 economicBindingHash;
    }

    struct DeploymentConfigV1 {
        IProgrammableUniversalLaunchKernelV1 kernel;
        bytes32 kernelRuntimeCodeHash;
        IProgrammableExactHookemonLauncherCodeStoreV1 codeStore;
        bytes32 codeStoreRuntimeCodeHash;
        bytes32 codeStoreBindingHash;
        IProgrammableExactHookemonPostconditionVerifierV1 postconditionVerifier;
        bytes32 postconditionVerifierRuntimeCodeHash;
        bytes32 verifierBindingHash;
        IProgrammableGithubRepositoryLineageRegistryV1 repositoryLineageRegistry;
        bytes32 repositoryLineageRegistryRuntimeCodeHash;
        bytes32 profileKey;
        uint32 verifierGasLimit;
    }

    error InvalidField(uint256 field);
    error RuntimeCodeHashDrift(address account);
    error UnauthorizedApplicant();
    error ReentrantOrConsumed();
    error ComponentCollision(address account);
    error CodeReconstructionMismatch();
    error CreateFailed();
    error VerifierCallFailed();
    error VerifierReturnMalformed();
    error PostconditionMismatch();
    error UnexpectedValueFlow();

    event ExactHookemonLaunchFinalized(
        bytes32 indexed grantDigest, bytes32 indexed stampLaunchId, bytes32 indexed receiptCoreHash, address launcher
    );

    constructor(
        DeploymentConfigV1 memory deployment,
        bytes32 expectedLauncherCreationCodeHash,
        uint256 expectedLauncherCreationCodeLength
    ) {
        if (
            address(deployment.kernel) == address(0) || address(deployment.codeStore) == address(0)
                || address(deployment.postconditionVerifier) == address(0) || deployment.profileKey == bytes32(0)
                || address(deployment.repositoryLineageRegistry) == address(0)
                || deployment.codeStoreBindingHash == bytes32(0) || deployment.verifierBindingHash == bytes32(0)
                || deployment.verifierGasLimit < 300_000
        ) revert InvalidField(1);
        if (deployment.postconditionVerifier.tokenIdentityConstraintsHashV1() != TOKEN_IDENTITY_CONSTRAINTS_HASH) {
            revert InvalidField(1);
        }
        _requireRuntime(address(deployment.kernel), deployment.kernelRuntimeCodeHash);
        _requireRuntime(address(deployment.codeStore), deployment.codeStoreRuntimeCodeHash);
        _requireRuntime(address(deployment.postconditionVerifier), deployment.postconditionVerifierRuntimeCodeHash);
        _requireRuntime(
            address(deployment.repositoryLineageRegistry), deployment.repositoryLineageRegistryRuntimeCodeHash
        );
        if (deployment.repositoryLineageRegistry.computeRepositoryKey(GITHUB_REPOSITORY_ID) != SOURCE_REPOSITORY_KEY) {
            revert InvalidField(1);
        }
        deployment.kernel
            .assertClosedRuntimeBindingV1(
                address(deployment.codeStore),
                deployment.codeStoreRuntimeCodeHash,
                deployment.codeStoreBindingHash,
                true
            );
        deployment.kernel
            .assertClosedRuntimeBindingV1(
                address(deployment.postconditionVerifier),
                deployment.postconditionVerifierRuntimeCodeHash,
                deployment.verifierBindingHash,
                true
            );
        VerifierModulesV1 memory modules;
        (
            modules.architectureModule,
            modules.architectureRuntimeCodeHash,
            modules.architectureBindingHash,
            modules.economicModule,
            modules.economicRuntimeCodeHash,
            modules.economicBindingHash
        ) = deployment.postconditionVerifier.verifierModulesV1();
        deployment.kernel
            .assertClosedRuntimeBindingV1(
                modules.architectureModule, modules.architectureRuntimeCodeHash, modules.architectureBindingHash, true
            );
        deployment.kernel
            .assertClosedRuntimeBindingV1(
                modules.economicModule, modules.economicRuntimeCodeHash, modules.economicBindingHash, true
            );

        bytes32 creationCodeHash = deployment.codeStore.creationCodeHashV1();
        uint256 creationCodeLength = deployment.codeStore.creationCodeLengthV1();
        if (
            expectedLauncherCreationCodeHash == bytes32(0) || expectedLauncherCreationCodeLength == 0
                || creationCodeHash != expectedLauncherCreationCodeHash
                || creationCodeLength != expectedLauncherCreationCodeLength
                || creationCodeLength + MAXIMUM_CONSTRUCTOR_ARGUMENT_BYTES > MAXIMUM_INITCODE_BYTES
        ) revert InvalidField(2);
        bytes32 exactBindingHash = keccak256(
            abi.encode(
                EXACT_CONTRACT_BINDING_TYPEHASH,
                SOURCE_COMMIT_ID,
                SOURCE_TREE_ID,
                GITHUB_REPOSITORY_ID,
                SOURCE_REPOSITORY_KEY,
                creationCodeHash,
                creationCodeLength,
                MINIMUM_CONSTRUCTOR_ARGUMENT_BYTES,
                MAXIMUM_CONSTRUCTOR_ARGUMENT_BYTES,
                EXPECTED_CREATE_NONCE,
                TOKEN_IDENTITY_POLICY_HASH,
                TOKEN_IDENTITY_CONSTRAINTS_HASH
            )
        );
        bytes32 verifierModuleSetHash = keccak256(
            abi.encode(
                VERIFIER_MODULE_SET_TYPEHASH,
                modules.architectureModule,
                modules.architectureRuntimeCodeHash,
                modules.architectureBindingHash,
                modules.economicModule,
                modules.economicRuntimeCodeHash,
                modules.economicBindingHash
            )
        );
        bytes32 dependencyBindingHash = _deploymentBindingHash(deployment, verifierModuleSetHash);
        bytes32 providerBindingHash = keccak256(
            abi.encode(
                PROFILE_RUNTIME_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                deployment.profileKey,
                dependencyBindingHash,
                exactBindingHash,
                REVENUE_POLICY_HASH,
                PLAN_TYPEHASH
            )
        );

        KERNEL = deployment.kernel;
        KERNEL_RUNTIME_CODEHASH = deployment.kernelRuntimeCodeHash;
        CODE_STORE = deployment.codeStore;
        CODE_STORE_RUNTIME_CODEHASH = deployment.codeStoreRuntimeCodeHash;
        CODE_STORE_BINDING_HASH = deployment.codeStoreBindingHash;
        POSTCONDITION_VERIFIER = deployment.postconditionVerifier;
        POSTCONDITION_VERIFIER_RUNTIME_CODEHASH = deployment.postconditionVerifierRuntimeCodeHash;
        VERIFIER_BINDING_HASH = deployment.verifierBindingHash;
        ARCHITECTURE_VERIFIER_MODULE = modules.architectureModule;
        ARCHITECTURE_VERIFIER_MODULE_RUNTIME_CODEHASH = modules.architectureRuntimeCodeHash;
        ARCHITECTURE_VERIFIER_MODULE_BINDING_HASH = modules.architectureBindingHash;
        ECONOMIC_VERIFIER_MODULE = modules.economicModule;
        ECONOMIC_VERIFIER_MODULE_RUNTIME_CODEHASH = modules.economicRuntimeCodeHash;
        ECONOMIC_VERIFIER_MODULE_BINDING_HASH = modules.economicBindingHash;
        REPOSITORY_LINEAGE_REGISTRY = deployment.repositoryLineageRegistry;
        REPOSITORY_LINEAGE_REGISTRY_RUNTIME_CODEHASH = deployment.repositoryLineageRegistryRuntimeCodeHash;
        PROFILE_KEY = deployment.profileKey;
        EXACT_CONTRACT_BINDING_HASH = exactBindingHash;
        PROVIDER_BINDING_HASH = providerBindingHash;
        VERIFIER_GAS_LIMIT = deployment.verifierGasLimit;
    }

    function _deploymentBindingHash(DeploymentConfigV1 memory deployment, bytes32 verifierModuleSetHash)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PROFILE_DEPENDENCY_BINDING_TYPEHASH,
                address(deployment.kernel),
                deployment.kernelRuntimeCodeHash,
                address(deployment.codeStore),
                deployment.codeStoreRuntimeCodeHash,
                deployment.codeStoreBindingHash,
                address(deployment.postconditionVerifier),
                deployment.postconditionVerifierRuntimeCodeHash,
                deployment.verifierBindingHash,
                verifierModuleSetHash,
                address(deployment.repositoryLineageRegistry),
                deployment.repositoryLineageRegistryRuntimeCodeHash
            )
        );
    }

    function launchExactHookemonV1(
        bytes32 grantDigest,
        ExactHookemonPlanV1 calldata plan,
        LaunchTransportV1 calldata transport
    ) external returns (bytes32 receiptCoreHash) {
        if (_executionState != 0) revert ReentrantOrConsumed();
        _requireBoundDependencies();
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = KERNEL.launchGrantV1(grantDigest);
        if (
            msg.sender != grant.applicantWallet || msg.sender != plan.applicantWallet
                || msg.sender != plan.config.fundingWallet
        ) revert UnauthorizedApplicant();

        PlanCommitmentsV1 memory commitments = _validatePlan(grantDigest, plan, grant);
        bytes32 profilePreflightHash = _profilePreflightHash(plan);
        if (
            transport.currentness.profilePreflightReadbackHash == bytes32(0)
                || transport.currentness.profilePreflightReadbackHash != profilePreflightHash
        ) revert PostconditionMismatch();
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations = _buildReservations(plan);
        bytes32 reservationSetHash = KERNEL.computeReservationSetHashV1(reservations);
        uint256 balanceBefore = address(this).balance;

        _executionState = 1;
        IProgrammableUniversalLaunchKernelV1.ProfileExecutionEnvelopeV1 memory envelope =
            IProgrammableUniversalLaunchKernelV1.ProfileExecutionEnvelopeV1({
                currentness: transport.currentness,
                currentnessSignature: transport.currentnessSignature,
                walletIntent: transport.walletIntent,
                walletSignature: transport.walletSignature,
                reservations: reservations
            });
        bytes32 executionKey = KERNEL.beginProfileExecutionV1(grantDigest, envelope);
        ExecutionCorrelationV1 memory correlation = ExecutionCorrelationV1({
            grantDigest: grantDigest,
            stampLaunchId: grant.stampLaunchId,
            executionKey: executionKey,
            reservationSetHash: reservationSetHash,
            balanceBefore: balanceBefore
        });
        address launcher;
        (receiptCoreHash, launcher) = _executeVerifyFinalize(plan, commitments, correlation);
        launched = launcher;
        _executionState = 2;
        emit ExactHookemonLaunchFinalized(grantDigest, grant.stampLaunchId, receiptCoreHash, launcher);
    }

    function predictedLauncherV1() public view returns (address launcher) {
        launcher = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), hex"01")))));
    }

    function tokenIdentityPolicyV1() external pure returns (TokenIdentityPolicyV1 policy) {
        return TokenIdentityPolicyV1.PlatformSelectedBounded;
    }

    function tokenIdentityConstraintsHashV1() external pure returns (bytes32 constraintsHash) {
        return TOKEN_IDENTITY_CONSTRAINTS_HASH;
    }

    function computeExactHookemonPlanCommitmentsV1(ExactHookemonPlanV1 calldata plan)
        external
        pure
        returns (PlanCommitmentsV1 memory commitments)
    {
        return _planCommitments(plan);
    }

    function exactHookemonReservationsV1(ExactHookemonPlanV1 calldata plan)
        external
        view
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations)
    {
        return _buildReservations(plan);
    }

    function computeExactHookemonPreflightHashV1(ExactHookemonPlanV1 calldata plan)
        external
        view
        returns (bytes32 profilePreflightReadbackHash)
    {
        return _profilePreflightHash(plan);
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        return PROVIDER_BINDING_HASH;
    }

    function _validatePlan(
        bytes32 grantDigest,
        ExactHookemonPlanV1 calldata plan,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant
    ) private view returns (PlanCommitmentsV1 memory commitments) {
        address predicted = predictedLauncherV1();
        if (
            grantDigest == bytes32(0) || plan.schemaVersion != PLAN_SCHEMA_VERSION || plan.sourceLaunchId == bytes32(0)
                || plan.sourceLaunchId != grant.sourceLaunchId || grant.sourceCommit != SOURCE_COMMIT_ID
                || grant.sourceTree != SOURCE_TREE_ID || plan.githubRepositoryId != GITHUB_REPOSITORY_ID
                || plan.repositoryKey != SOURCE_REPOSITORY_KEY || grant.sourceRepoHash != plan.repositoryKey
                || plan.repositoryLineageRegistry != address(REPOSITORY_LINEAGE_REGISTRY)
                || plan.presentationBindingHash == bytes32(0) || plan.tokenNameHash == bytes32(0)
                || plan.tokenSymbolHash == bytes32(0) || plan.exclusive.accounts[0] != predicted
                || plan.completeInitCodeHash == bytes32(0) || plan.canonicalPoolId == bytes32(0)
                || plan.poolManagerRuntimeCodeHash == bytes32(0) || plan.expectedPositionTokenId == 0
                || plan.expectedLaunchConfigHash == bytes32(0) || plan.expectedLaunchId == bytes32(0)
                || plan.expectedLaunchHash == bytes32(0) || plan.expectedArchitectureStateHash == bytes32(0)
                || plan.expectedPoolStateHash == bytes32(0) || plan.expectedRevenueStateHash == bytes32(0)
        ) revert InvalidField(3);
        _validateConfiguration(plan);
        _validateComponents(plan);
        commitments = _planCommitments(plan);
        if (
            commitments.planHash != grant.planHash || commitments.componentGraphHash != grant.componentGraphHash
                || commitments.componentRuntimeSetHash != grant.componentRuntimeSetHash
                || commitments.configurationHash != grant.configurationHash
                || grant.exactContractBindingHash != EXACT_CONTRACT_BINDING_HASH
                || grant.providerBindingHash != PROVIDER_BINDING_HASH || grant.revenueBindingHash != REVENUE_POLICY_HASH
        ) revert InvalidField(4);
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            KERNEL.profileDescriptorV1(PROFILE_KEY);
        if (
            grant.profileKey != PROFILE_KEY || descriptor.module != address(this)
                || descriptor.moduleRuntimeCodeHash != address(this).codehash
                || descriptor.actionTypeHash != PLAN_TYPEHASH
                || descriptor.exactContractBindingHash != EXACT_CONTRACT_BINDING_HASH
                || descriptor.providerBindingHash != PROVIDER_BINDING_HASH
                || descriptor.revenuePolicyHash != REVENUE_POLICY_HASH
                || descriptor.capabilitySemantics != IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute
        ) revert InvalidField(5);
        _requireVerifierPlanBinding(plan);
        _validatePrestate(plan);
    }

    function _validateConfiguration(ExactHookemonPlanV1 calldata plan) private view {
        LaunchConfigV1 calldata config = plan.config;
        (bytes32 tokenNameHash, bytes32 tokenSymbolHash) =
            POSTCONDITION_VERIFIER.validateTokenIdentityV1(config.tokenName, config.tokenSymbol);
        if (
            plan.tokenNameHash != tokenNameHash || plan.tokenSymbolHash != tokenSymbolHash
                || config.poolManager == address(0) || config.positionManager == address(0) || config.usdc == address(0)
                || config.tokenMessengerV2 == address(0) || config.messageTransmitterV2 == address(0)
                || config.fundingWallet == address(0) || config.approvedMultisig == address(0)
                || config.executor == address(0) || config.artifactAuthorizer == address(0)
                || config.solanaUsdcAta == bytes32(0) || config.solanaUsdcMint == bytes32(0)
                || config.solanaReturnAuthority == bytes32(0) || config.solanaTokenMessenger == bytes32(0)
                || config.solanaDomain != 5 || config.outboundProtocolFeeCapBps != 1
                || config.outboundForwardFeeCapMicroUsdc != 2_000_000 || config.scheduleAnchor == 0
                || config.positionUnlockAt != config.scheduleAnchor + 2 * 365 days || config.launcherMode != 2
                || config.poolFee != LP_FEE_PIPS || config.tickSpacing != 60 || config.tickLower != -887_220
                || config.tickUpper != 887_220 || config.initialSqrtPriceX96 == 0 || config.liquidityUsdcAmount == 0
                || config.cycleBootstrapUsdcAmount == 0 || config.expectedPositionLiquidity == 0
                || plan.shared.accounts[0] == address(0) || plan.shared.accounts[1] == address(0)
                || config.distributorFactory != plan.shared.accounts[2]
                || config.outboundBridgeFactory != plan.shared.accounts[3]
                || config.returnAdapterFactory != plan.shared.accounts[4]
                || config.cycleVaultFactory != plan.shared.accounts[5]
                || config.treasuryVestingFactory != plan.shared.accounts[6]
                || config.positionTimelockFactory != plan.shared.accounts[7]
        ) revert InvalidField(6);
    }

    function _validateComponents(ExactHookemonPlanV1 calldata plan) private pure {
        for (uint256 i; i < 9; ++i) {
            if (plan.exclusive.accounts[i] == address(0) || plan.exclusive.runtimeCodeHashes[i] == bytes32(0)) {
                revert InvalidField(7);
            }
            for (uint256 j; j < i; ++j) {
                if (plan.exclusive.accounts[j] == plan.exclusive.accounts[i]) revert InvalidField(8);
            }
        }
        for (uint256 i; i < 14; ++i) {
            if (plan.shared.accounts[i] == address(0) || plan.shared.runtimeCodeHashes[i] == bytes32(0)) {
                revert InvalidField(9);
            }
            for (uint256 j; j < 9; ++j) {
                if (plan.exclusive.accounts[j] == plan.shared.accounts[i]) revert InvalidField(10);
            }
            for (uint256 j; j < i; ++j) {
                if (plan.shared.accounts[j] == plan.shared.accounts[i]) revert InvalidField(11);
            }
        }
    }

    function _validatePrestate(ExactHookemonPlanV1 calldata plan) private view {
        for (uint256 i; i < 9; ++i) {
            if (plan.exclusive.accounts[i].code.length != 0) revert ComponentCollision(plan.exclusive.accounts[i]);
        }
        for (uint256 i; i < 14; ++i) {
            _requireRuntime(plan.shared.accounts[i], plan.shared.runtimeCodeHashes[i]);
        }
        _requireRuntime(plan.config.poolManager, plan.poolManagerRuntimeCodeHash);
        IProgrammableGithubRepositoryLineageRegistryV1.RepositoryConsumptionV1 memory repositoryConsumption =
            REPOSITORY_LINEAGE_REGISTRY.consumption(plan.repositoryKey);
        if (
            repositoryConsumption.launchId != bytes32(0)
                || !IExactHookemonLineageRegistryAuthorizationV1(address(REPOSITORY_LINEAGE_REGISTRY))
                    .hasRole(REPOSITORY_LINEAGE_CONSUMER_ROLE, address(this))
        ) revert InvalidField(12);
        uint256 exactApproval = plan.config.liquidityUsdcAmount + plan.config.cycleBootstrapUsdcAmount;
        if (
            IExactHookemonApprovalAssetV1(plan.config.usdc).allowance(plan.applicantWallet, predictedLauncherV1())
                != exactApproval
        ) revert UnexpectedValueFlow();
    }

    function _createExactLauncher(ExactHookemonPlanV1 calldata plan) private returns (address launcher) {
        _requireBoundDependencies();
        bytes memory creationCode = CODE_STORE.readCreationCodeV1();
        if (
            creationCode.length != CODE_STORE.creationCodeLengthV1()
                || keccak256(creationCode) != CODE_STORE.creationCodeHashV1()
        ) revert CodeReconstructionMismatch();
        bytes memory constructorArguments = abi.encode(plan.shared.accounts[0], plan.shared.accounts[1], plan.config);
        if (
            constructorArguments.length < MINIMUM_CONSTRUCTOR_ARGUMENT_BYTES
                || constructorArguments.length > MAXIMUM_CONSTRUCTOR_ARGUMENT_BYTES
        ) revert CodeReconstructionMismatch();
        bytes memory initCode = bytes.concat(creationCode, constructorArguments);
        if (initCode.length > MAXIMUM_INITCODE_BYTES || keccak256(initCode) != plan.completeInitCodeHash) {
            revert CodeReconstructionMismatch();
        }
        assembly ("memory-safe") {
            launcher := create(0, add(initCode, 32), mload(initCode))
        }
        if (launcher == address(0)) revert CreateFailed();
        if (launcher != predictedLauncherV1() || launcher != plan.exclusive.accounts[0]) revert CreateFailed();
        _requireRuntime(launcher, plan.exclusive.runtimeCodeHashes[0]);
    }

    function _executeVerifyFinalize(
        ExactHookemonPlanV1 calldata plan,
        PlanCommitmentsV1 memory commitments,
        ExecutionCorrelationV1 memory correlation
    ) private returns (bytes32 receiptCoreHash, address launcher) {
        bytes32 consumedRepositoryKey = REPOSITORY_LINEAGE_REGISTRY.consume(
            plan.githubRepositoryId, correlation.stampLaunchId, PROFILE_KEY
        );
        if (consumedRepositoryKey != plan.repositoryKey) revert PostconditionMismatch();
        launcher = _createExactLauncher(plan);
        (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash) = _verifyPostconditions(plan, launcher);
        if (address(this).balance != correlation.balanceBefore) revert UnexpectedValueFlow();
        IProgrammableUniversalLaunchKernelV1.ExecutionResultV1 memory result;
        result.grantDigest = correlation.grantDigest;
        result.stampLaunchId = correlation.stampLaunchId;
        result.planHash = commitments.planHash;
        result.componentSetHash = commitments.componentSetHash;
        result.componentRuntimeSetHash = commitments.componentRuntimeSetHash;
        result.configurationHash = commitments.configurationHash;
        result.reservationSetHash = correlation.reservationSetHash;
        result.providerResultHash = keccak256(
            abi.encode(
                PROVIDER_RESULT_TYPEHASH,
                correlation.executionKey,
                address(this),
                EXPECTED_CREATE_NONCE,
                launcher,
                plan.completeInitCodeHash,
                plan.exclusive.runtimeCodeHashes[0]
            )
        );
        result.postconditionHash =
            keccak256(abi.encode(POSTCONDITION_TYPEHASH, launcher, architectureHash, poolHash, revenueHash));
        result.valueFlowHash = commitments.valueFlowHash;
        result.deploymentLineageHash = keccak256(
            abi.encode(
                DEPLOYMENT_LINEAGE_TYPEHASH, address(this), EXPECTED_CREATE_NONCE, launcher, plan.completeInitCodeHash
            )
        );
        receiptCoreHash = KERNEL.finalizeProfileExecutionV1(result);
    }

    function _profilePreflightHash(ExactHookemonPlanV1 calldata plan) private view returns (bytes32 readbackHash) {
        _requireBoundDependencies();
        _requireVerifierPlanBinding(plan);
        _validatePrestate(plan);
        PlanCommitmentsV1 memory commitments = _planCommitments(plan);
        (bytes32 exclusiveHead, bytes32 sharedHead) = _prestateHeads(plan);
        uint256 exactApproval = plan.config.liquidityUsdcAmount + plan.config.cycleBootstrapUsdcAmount;
        readbackHash = keccak256(
            abi.encode(
                PROFILE_PREFLIGHT_TYPEHASH,
                address(this),
                predictedLauncherV1(),
                commitments.planHash,
                commitments.configurationHash,
                exclusiveHead,
                sharedHead,
                plan.config.poolManager,
                plan.config.poolManager.codehash,
                plan.config.usdc,
                exactApproval,
                CODE_STORE_BINDING_HASH,
                VERIFIER_BINDING_HASH
            )
        );
        _requireBoundDependencies();
    }

    function _verifyPostconditions(ExactHookemonPlanV1 calldata plan, address launcher)
        private
        view
        returns (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash)
    {
        _requireBoundDependencies();
        bytes memory payload = abi.encodeCall(
            IProgrammableExactHookemonPostconditionVerifierV1.verifyExactHookemonPostconditionsV1, (launcher)
        );
        bytes memory output = new bytes(96);
        bool success;
        uint256 returnedSize;
        address verifier = address(POSTCONDITION_VERIFIER);
        uint256 gasLimit = VERIFIER_GAS_LIMIT;
        assembly ("memory-safe") {
            success := staticcall(gasLimit, verifier, add(payload, 32), mload(payload), add(output, 32), 96)
            returnedSize := returndatasize()
        }
        if (!success) revert VerifierCallFailed();
        if (returnedSize != 96) revert VerifierReturnMalformed();
        _requireBoundDependencies();
        (architectureHash, poolHash, revenueHash) = abi.decode(output, (bytes32, bytes32, bytes32));
        if (
            architectureHash != plan.expectedArchitectureStateHash || poolHash != plan.expectedPoolStateHash
                || revenueHash != plan.expectedRevenueStateHash
        ) revert PostconditionMismatch();
    }

    function _requireVerifierPlanBinding(ExactHookemonPlanV1 calldata plan) private view {
        if (
            POSTCONDITION_VERIFIER.expectedLauncherRuntimeCodeHashV1() != plan.exclusive.runtimeCodeHashes[0]
                || POSTCONDITION_VERIFIER.expectedArchitectureStateHashV1() != plan.expectedArchitectureStateHash
                || POSTCONDITION_VERIFIER.expectedPoolStateHashV1() != plan.expectedPoolStateHash
                || POSTCONDITION_VERIFIER.expectedRevenueStateHashV1() != plan.expectedRevenueStateHash
                || POSTCONDITION_VERIFIER.expectedTokenNameHashV1() != plan.tokenNameHash
                || POSTCONDITION_VERIFIER.expectedTokenSymbolHashV1() != plan.tokenSymbolHash
        ) revert PostconditionMismatch();
    }

    function _prestateHeads(ExactHookemonPlanV1 calldata plan)
        private
        view
        returns (bytes32 exclusiveHead, bytes32 sharedHead)
    {
        for (uint256 i; i < 9; ++i) {
            exclusiveHead = keccak256(abi.encode(exclusiveHead, i, plan.exclusive.accounts[i], uint256(0)));
        }
        for (uint256 i; i < 14; ++i) {
            address account = plan.shared.accounts[i];
            sharedHead = keccak256(abi.encode(sharedHead, i, account, account.codehash));
        }
    }

    function _buildReservations(ExactHookemonPlanV1 calldata plan)
        private
        view
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations)
    {
        reservations = new IProgrammableUniversalLaunchKernelV1.ReservationV1[](29);
        for (uint256 i; i < 9; ++i) {
            reservations[i] = _componentReservation(
                IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
                plan.exclusive.accounts[i],
                plan.exclusive.runtimeCodeHashes[i],
                bytes32(0)
            );
        }
        for (uint256 i; i < 14; ++i) {
            reservations[9 + i] = _componentReservation(
                IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
                plan.shared.accounts[i],
                plan.shared.runtimeCodeHashes[i],
                keccak256(
                    abi.encode(
                        SHARED_RESERVATION_IDENTITY_TYPEHASH,
                        uint8(i + 1),
                        plan.shared.accounts[i],
                        plan.shared.runtimeCodeHashes[i]
                    )
                )
            );
        }
        reservations[23] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Token,
            scope: IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            account: plan.exclusive.accounts[1],
            manager: address(0),
            identifier: bytes32(0),
            expectedRuntimeCodeHash: plan.exclusive.runtimeCodeHashes[1],
            expectedManagerRuntimeCodeHash: bytes32(0),
            sharedIdentityHash: bytes32(0)
        });
        reservations[24] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Pool,
            scope: IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            account: address(0),
            manager: plan.config.poolManager,
            identifier: plan.canonicalPoolId,
            expectedRuntimeCodeHash: bytes32(0),
            expectedManagerRuntimeCodeHash: plan.poolManagerRuntimeCodeHash,
            sharedIdentityHash: bytes32(0)
        });
        reservations[25] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
            address(CODE_STORE),
            CODE_STORE_RUNTIME_CODEHASH,
            CODE_STORE_BINDING_HASH
        );
        for (uint256 i; i < 2; ++i) {
            (address part, bytes32 runtimeHash,) = CODE_STORE.partV1(i);
            reservations[26 + i] = _componentReservation(
                IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
                part,
                runtimeHash,
                keccak256(abi.encode(CODE_STORE_BINDING_HASH, i, part, runtimeHash))
            );
        }
        reservations[28] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
            address(REPOSITORY_LINEAGE_REGISTRY),
            REPOSITORY_LINEAGE_REGISTRY_RUNTIME_CODEHASH,
            keccak256(
                abi.encode(
                    "programmable.github.repository-lineage.registry.v1",
                    address(REPOSITORY_LINEAGE_REGISTRY),
                    REPOSITORY_LINEAGE_REGISTRY_RUNTIME_CODEHASH
                )
            )
        );
    }

    function _componentReservation(
        IProgrammableUniversalLaunchKernelV1.ReservationScope scope,
        address account,
        bytes32 runtimeHash,
        bytes32 sharedIdentity
    ) private pure returns (IProgrammableUniversalLaunchKernelV1.ReservationV1 memory reservation) {
        reservation = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Component,
            scope: scope,
            account: account,
            manager: address(0),
            identifier: bytes32(0),
            expectedRuntimeCodeHash: runtimeHash,
            expectedManagerRuntimeCodeHash: bytes32(0),
            sharedIdentityHash: sharedIdentity
        });
    }

    function _planCommitments(ExactHookemonPlanV1 calldata plan)
        private
        pure
        returns (PlanCommitmentsV1 memory commitments)
    {
        (bytes32 exclusiveHead, bytes32 exclusiveSet, bytes32 exclusiveRuntime) = _exclusiveHashes(plan);
        (bytes32 sharedHead, bytes32 sharedSet, bytes32 sharedRuntime) = _sharedHashes(plan);
        commitments.componentGraphHash = keccak256(
            abi.encode(
                GRAPH_TYPEHASH,
                exclusiveHead,
                sharedHead,
                plan.config.poolManager,
                plan.poolManagerRuntimeCodeHash,
                plan.canonicalPoolId
            )
        );
        commitments.componentSetHash = keccak256(abi.encode(exclusiveSet, sharedSet, plan.canonicalPoolId));
        commitments.componentRuntimeSetHash =
            keccak256(abi.encode(exclusiveRuntime, sharedRuntime, plan.poolManagerRuntimeCodeHash));
        commitments.configurationHash = _configurationHash(plan);
        commitments.valueFlowHash = _valueFlowHash(plan);
        commitments.planHash = _finalPlanHash(plan, commitments);
    }

    function _finalPlanHash(ExactHookemonPlanV1 calldata plan, PlanCommitmentsV1 memory commitments)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PLAN_TYPEHASH,
                _planSourceIdentityHash(plan),
                _actionHash(plan),
                commitments.componentGraphHash,
                commitments.componentSetHash,
                commitments.componentRuntimeSetHash,
                commitments.configurationHash,
                _expectedStateHash(plan),
                commitments.valueFlowHash
            )
        );
    }

    function _planSourceIdentityHash(ExactHookemonPlanV1 calldata plan) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                PLAN_SOURCE_IDENTITY_TYPEHASH,
                plan.schemaVersion,
                plan.applicantWallet,
                plan.sourceLaunchId,
                plan.githubRepositoryId,
                plan.repositoryKey,
                plan.repositoryLineageRegistry,
                plan.presentationBindingHash
            )
        );
    }

    function _configurationHash(ExactHookemonPlanV1 calldata plan) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CONFIGURATION_TYPEHASH,
                plan.githubRepositoryId,
                plan.repositoryKey,
                plan.repositoryLineageRegistry,
                plan.presentationBindingHash,
                plan.tokenNameHash,
                plan.tokenSymbolHash,
                keccak256(abi.encode(plan.config)),
                plan.completeInitCodeHash,
                plan.expectedLaunchConfigHash,
                plan.expectedLaunchId,
                plan.expectedLaunchHash
            )
        );
    }

    function _valueFlowHash(ExactHookemonPlanV1 calldata plan) private pure returns (bytes32) {
        uint256 exactApproval = plan.config.liquidityUsdcAmount + plan.config.cycleBootstrapUsdcAmount;
        return keccak256(
            abi.encode(
                VALUE_FLOW_TYPEHASH,
                plan.config.fundingWallet,
                plan.config.usdc,
                plan.exclusive.accounts[0],
                plan.config.liquidityUsdcAmount,
                plan.config.cycleBootstrapUsdcAmount,
                exactApproval,
                uint256(0)
            )
        );
    }

    function _actionHash(ExactHookemonPlanV1 calldata plan) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                plan.exclusive.accounts[0],
                plan.completeInitCodeHash,
                plan.exclusive.runtimeCodeHashes[0],
                plan.config.poolManager,
                plan.poolManagerRuntimeCodeHash,
                plan.canonicalPoolId,
                plan.expectedPositionTokenId,
                plan.expectedLaunchConfigHash,
                plan.expectedLaunchId,
                plan.expectedLaunchHash
            )
        );
    }

    function _expectedStateHash(ExactHookemonPlanV1 calldata plan) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXPECTED_STATE_TYPEHASH,
                plan.expectedArchitectureStateHash,
                plan.expectedPoolStateHash,
                plan.expectedRevenueStateHash
            )
        );
    }

    function _exclusiveHashes(ExactHookemonPlanV1 calldata plan)
        private
        pure
        returns (bytes32 orderedHead, bytes32 setHash, bytes32 runtimeHash)
    {
        for (uint256 i; i < 9; ++i) {
            bytes32 leaf = keccak256(
                abi.encode(
                    EXCLUSIVE_COMPONENT_TYPEHASH,
                    uint8(i + 1),
                    plan.exclusive.accounts[i],
                    plan.exclusive.runtimeCodeHashes[i]
                )
            );
            orderedHead = keccak256(abi.encode(orderedHead, i, leaf));
            setHash = keccak256(abi.encode(setHash, i, plan.exclusive.accounts[i], leaf));
            runtimeHash = keccak256(
                abi.encode(runtimeHash, i, plan.exclusive.accounts[i], plan.exclusive.runtimeCodeHashes[i])
            );
        }
    }

    function _sharedHashes(ExactHookemonPlanV1 calldata plan)
        private
        pure
        returns (bytes32 orderedHead, bytes32 setHash, bytes32 runtimeHash)
    {
        for (uint256 i; i < 14; ++i) {
            bytes32 leaf = keccak256(
                abi.encode(
                    SHARED_COMPONENT_TYPEHASH, uint8(i + 1), plan.shared.accounts[i], plan.shared.runtimeCodeHashes[i]
                )
            );
            orderedHead = keccak256(abi.encode(orderedHead, i, leaf));
            setHash = keccak256(abi.encode(setHash, i, plan.shared.accounts[i], leaf));
            runtimeHash =
                keccak256(abi.encode(runtimeHash, i, plan.shared.accounts[i], plan.shared.runtimeCodeHashes[i]));
        }
    }

    function _requireBoundDependencies() private view {
        _requireRuntime(address(KERNEL), KERNEL_RUNTIME_CODEHASH);
        _requireBoundRuntime(address(CODE_STORE), CODE_STORE_RUNTIME_CODEHASH, CODE_STORE_BINDING_HASH);
        _requireBoundRuntime(
            address(POSTCONDITION_VERIFIER), POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH
        );
        _requireBoundRuntime(
            ARCHITECTURE_VERIFIER_MODULE,
            ARCHITECTURE_VERIFIER_MODULE_RUNTIME_CODEHASH,
            ARCHITECTURE_VERIFIER_MODULE_BINDING_HASH
        );
        _requireBoundRuntime(
            ECONOMIC_VERIFIER_MODULE, ECONOMIC_VERIFIER_MODULE_RUNTIME_CODEHASH, ECONOMIC_VERIFIER_MODULE_BINDING_HASH
        );
        _requireRuntime(address(REPOSITORY_LINEAGE_REGISTRY), REPOSITORY_LINEAGE_REGISTRY_RUNTIME_CODEHASH);
    }

    function _requireRuntime(address account, bytes32 expectedCodeHash) private view {
        if (
            account == address(0) || expectedCodeHash == bytes32(0) || account.code.length == 0
                || account.codehash != expectedCodeHash
        ) revert RuntimeCodeHashDrift(account);
    }

    function _requireBoundRuntime(address account, bytes32 expectedCodeHash, bytes32 expectedBindingHash) private view {
        _requireRuntime(account, expectedCodeHash);
        bytes memory payload = abi.encodeCall(IProgrammableRuntimeBindingV1.runtimeBindingHashV1, ());
        bool success;
        uint256 returnedSize;
        bytes32 actualBindingHash;
        assembly ("memory-safe") {
            success := staticcall(100000, account, add(payload, 32), mload(payload), 0, 0)
            returnedSize := returndatasize()
            if and(success, eq(returnedSize, 32)) {
                returndatacopy(0, 0, 32)
                actualBindingHash := mload(0)
            }
        }
        if (!success || returnedSize != 32 || actualBindingHash != expectedBindingHash) {
            revert RuntimeCodeHashDrift(account);
        }
        _requireRuntime(account, expectedCodeHash);
    }
}

/// @notice Exact configurable-identity Hookemon Router-V4 candidate.
/// @dev Its production constructor can only bind the reviewed 55fd47ce normal-compiler launcher artifact. The source
///      revision remains ANALYSIS_PENDING and this contract is not an activation or deployment authorization.
contract ProgrammableExactHookemonNormalCreateProfileV1 is ProgrammableExactHookemonNormalCreateProfileBaseV1 {
    constructor(DeploymentConfigV1 memory deployment)
        ProgrammableExactHookemonNormalCreateProfileBaseV1(
            deployment, REVIEWED_LAUNCHER_CREATION_CODE_HASH, REVIEWED_LAUNCHER_CREATION_CODE_LENGTH
        )
    { }
}
