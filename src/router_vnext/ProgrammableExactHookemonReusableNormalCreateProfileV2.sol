// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableExactHookemonNormalCreateProfileV1,
    IProgrammableExactHookemonLauncherCodeStoreV1
} from "./IProgrammableExactHookemonNormalCreateProfileV1.sol";
import {
    IProgrammableExactHookemonReusableNormalCreateProfileV2
} from "./IProgrammableExactHookemonReusableNormalCreateProfileV2.sol";
import {
    IProgrammableLaunchPermitAuthorityV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "./IProgrammableUniversalLaunchKernelV1.sol";
import {
    ProgrammableExactHookemonPostconditionVerifierV2
} from "./ProgrammableExactHookemonPostconditionVerifierV1.sol";
import { ProgrammableExactHookemonNormalCreateExecutorV2 } from "./ProgrammableExactHookemonNormalCreateExecutorV2.sol";
import { ProgrammableExactHookemonReusablePlanModuleV2 } from "./ProgrammableExactHookemonReusablePlanModuleV2.sol";
import { IProgrammableHookemonLaunchRegistryV1 } from "./IProgrammableHookemonLaunchRegistryV1.sol";
import { IExactHookemonAtomicLauncherViewV1 } from "./ProgrammableExactHookemonPostconditionVerifierV1.sol";

/// @notice Reusable exact Hookemon NORMAL_CREATE profile for approved head 9943c158 / tree 99a69843.
/// @dev The route/profile is compatible with the shared Authority frozen at 8afe4548 / tree 19393b3a. Production
///      activation remains an external release/deployment/finality decision, never a Solidity constant.
contract ProgrammableExactHookemonReusableNormalCreateProfileV2 is
    IProgrammableExactHookemonReusableNormalCreateProfileV2
{
    uint64 private constant EXPECTED_CREATE_NONCE = 1;
    uint256 private constant BINDING_READ_GAS_LIMIT = 100_000;
    uint64 private constant GITHUB_REPOSITORY_ID = 1_324_982_531;
    bytes20 private constant APPROVED_REPOSITORY_HEAD_COMMIT = bytes20(hex"9943c158998147f4fea9049fb42b8c4a5d044c1d");
    bytes20 private constant APPROVED_REPOSITORY_HEAD_TREE = bytes20(hex"99a6984362a86e49ae8f2318b170da6d916dc519");
    bytes20 private constant EXECUTABLE_ARTIFACT_SOURCE_COMMIT = bytes20(hex"55fd47cec3ed8e61e59d5a919d98aeec2e269549");
    bytes20 private constant EXECUTABLE_ARTIFACT_SOURCE_TREE = bytes20(hex"2667ff1bee70dd082596d5f65b3ed4cb2c1ce387");
    bytes20 private constant SHARED_AUTHORITY_COMMIT = bytes20(hex"8afe4548553b406bd0374b3a8958f1a186104b11");
    bytes20 private constant SHARED_AUTHORITY_TREE = bytes20(hex"19393b3a1010db11de4b45d686580ee8b52f79f5");
    bytes32 private constant SHARED_AUTHORITY_INTERFACE_SHA256 =
        0x3aaae1dcf9f04b4ee38aa30ebd518d18f946a945f37142c1d0d02dcd8bec4169;
    bytes20 private constant SHARED_AUTHORITY_INTERFACE_BLOB = bytes20(hex"c6f5f199997958561a2238968bb284ca253e1837");
    bytes32 private constant SOURCE_REPOSITORY_KEY =
        keccak256(abi.encode("programmable.github.repository.v1", GITHUB_REPOSITORY_ID));
    bytes32 private constant PROFILE_KEY = keccak256("HOOKEMON:EXACT_REUSABLE_NORMAL_CREATE:v2");
    bytes32 public constant ROUTE_ID = keccak256("PROGRAMMABLE_ROUTE:HOOKEMON:EXACT_REUSABLE_NORMAL_CREATE:v2");
    bytes32 public constant PLAN_TYPEHASH = keccak256(
        "ExactHookemonReusableNormalCreatePlanV2(bytes32 sourceIdentityHash,bytes32 actionHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 configurationHash,bytes32 expectedStateHash,bytes32 valueFlowHash)"
    );
    bytes32 public constant REVENUE_POLICY_HASH = keccak256(
        "HookemonInclusiveQuoteFeeV1(totalHundredthsOfBip=30000,projectHundredthsOfBip=29000,programmableHundredthsOfBip=1000,programmableFeeOwner=0x4957f49620AFf3Adbbe8195a4f633E49cc93376c,lpFeePips=3000,lpFeeSeparate=true,externalAdditiveFee=false)"
    );
    bytes32 public constant TOKEN_IDENTITY_POLICY_HASH = keccak256("platform_selected_bounded_identity_v1");
    bytes32 private constant TOKEN_IDENTITY_CONSTRAINTS_HASH =
        0xbaa83b5dc37144910dc459fa3d6f6dfded2b4ef536f5f1a952b2e521c81f7160;
    bytes32 private constant PERMIT_EXECUTION_AUTHORITY_TYPEHASH = keccak256(
        "ExactHookemonPermitExecutionAuthorityV2(uint256 chainId,address route,bytes32 routeId,address profile,bytes32 profileId,bytes32 profileBindingHash,bytes32 dependencyAHash,bytes32 dependencyBHash,bytes32 exactContractBindingHash)"
    );
    bytes32 private constant PROFILE_BINDING_TYPEHASH = keccak256(
        "ExactHookemonReusableProfileBindingV2(uint256 chainId,address profile,bytes32 profileId,address planModule,bytes32 planModuleRuntimeCodeHash,bytes32 planModuleBindingHash,bytes32 providerBindingHash,bytes32 exactContractBindingHash)"
    );
    bytes32 private constant EXACT_CONTRACT_BINDING_TYPEHASH = keccak256(
        "ExactHookemonReusableContractBindingV2(bytes32 approvedRepositoryHeadHash,bytes32 executableArtifactSourceHash,bytes32 artifactHeadHash,bytes32 tokenIdentityPolicyHash,bytes32 tokenIdentityConstraintsHash,bytes20 sharedAuthorityCommit,bytes20 sharedAuthorityTree,bytes32 sharedAuthorityInterfaceSha256,bytes20 sharedAuthorityInterfaceBlob)"
    );
    bytes32 private constant APPROVED_REPOSITORY_HEAD_TYPEHASH = keccak256(
        "ExactHookemonApprovedRepositoryHeadV2(uint64 githubRepositoryId,bytes32 repositoryKey,bytes20 commit,bytes20 tree)"
    );
    bytes32 private constant EXECUTABLE_ARTIFACT_SOURCE_TYPEHASH =
        keccak256("ExactHookemonExecutableArtifactSourceV2(bytes20 commit,bytes20 tree)");
    bytes32 private constant PROVIDER_BINDING_TYPEHASH = keccak256(
        "ExactHookemonReusableProviderBindingV2(uint256 chainId,address profile,bytes32 routeId,bytes32 profileKey,bytes32 dependencyAHash,bytes32 dependencyBHash,bytes32 exactContractBindingHash)"
    );
    bytes32 private constant PROVIDER_RESULT_TYPEHASH = keccak256(
        "ExactHookemonReusableProviderResultV2(bytes32 executionKey,address profile,address executor,uint64 createNonce,address launcher,bytes32 completeInitCodeHash,bytes32 launcherRuntimeCodeHash)"
    );
    bytes32 private constant POSTCONDITION_TYPEHASH = keccak256(
        "ExactHookemonPostconditionV1(address launcher,bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash)"
    );
    bytes32 private constant DEPLOYMENT_LINEAGE_TYPEHASH = keccak256(
        "ExactHookemonReusableLineageV2(address profile,bytes32 executorSalt,address executor,uint64 executorNonce,address launcher,bytes32 completeInitCodeHash)"
    );

    struct DeploymentConfigV2 {
        IProgrammableUniversalLaunchKernelV1 kernel;
        bytes32 kernelRuntimeCodeHash;
        IProgrammableExactHookemonLauncherCodeStoreV1 codeStore;
        bytes32 codeStoreRuntimeCodeHash;
        bytes32 codeStoreBindingHash;
        ProgrammableExactHookemonPostconditionVerifierV2 postconditionVerifier;
        bytes32 postconditionVerifierRuntimeCodeHash;
        bytes32 verifierBindingHash;
        ProgrammableExactHookemonReusablePlanModuleV2 planModule;
        bytes32 planModuleRuntimeCodeHash;
        bytes32 planModuleBindingHash;
        IProgrammableLaunchPermitAuthorityV1 permitAuthority;
        bytes32 permitAuthorityRuntimeCodeHash;
        IProgrammableHookemonLaunchRegistryV1 launchRegistry;
        bytes32 launchRegistryRuntimeCodeHash;
        bytes32 launchRegistryBindingHash;
        bytes32 expectedLauncherCreationCodeHash;
        uint256 expectedLauncherCreationCodeLength;
        uint32 verifierGasLimit;
    }

    struct PreparedExecutionV2 {
        PlanCommitmentsV2 commitments;
        bytes32 grantDigest;
        bytes32 currentnessDigest;
        bytes32 walletIntentDigest;
        bytes32 executionKey;
        bytes32 reservationSetHash;
        bytes32 executionCoreHash;
        bytes32 executionCalldataKeccak256;
        uint256 balanceBefore;
        bytes launcherInitCode;
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] reservations;
    }

    struct ObservedLaunchV2 {
        address executor;
        address launcher;
        bytes32 architectureHash;
        bytes32 poolHash;
        bytes32 revenueHash;
    }

    IProgrammableUniversalLaunchKernelV1 private immutable KERNEL;
    bytes32 private immutable KERNEL_RUNTIME_CODEHASH;
    IProgrammableExactHookemonLauncherCodeStoreV1 private immutable CODE_STORE;
    bytes32 private immutable CODE_STORE_RUNTIME_CODEHASH;
    bytes32 private immutable CODE_STORE_BINDING_HASH;
    ProgrammableExactHookemonPostconditionVerifierV2 private immutable POSTCONDITION_VERIFIER;
    bytes32 private immutable POSTCONDITION_VERIFIER_RUNTIME_CODEHASH;
    bytes32 private immutable VERIFIER_BINDING_HASH;
    ProgrammableExactHookemonReusablePlanModuleV2 private immutable PLAN_MODULE;
    bytes32 private immutable PLAN_MODULE_RUNTIME_CODEHASH;
    bytes32 private immutable PLAN_MODULE_BINDING_HASH;
    IProgrammableLaunchPermitAuthorityV1 private immutable PERMIT_AUTHORITY;
    bytes32 private immutable PERMIT_AUTHORITY_RUNTIME_CODEHASH;
    IProgrammableHookemonLaunchRegistryV1 private immutable LAUNCH_REGISTRY;
    bytes32 private immutable LAUNCH_REGISTRY_RUNTIME_CODEHASH;
    bytes32 private immutable LAUNCH_REGISTRY_BINDING_HASH;
    bytes32 private immutable EXPECTED_LAUNCHER_CREATION_CODE_HASH;
    uint256 private immutable EXPECTED_LAUNCHER_CREATION_CODE_LENGTH;
    bytes32 private immutable EXECUTOR_CREATION_CODE_HASH;
    bytes32 private immutable EXECUTOR_RUNTIME_CODE_HASH;
    bytes32 public immutable EXACT_CONTRACT_BINDING_HASH;
    bytes32 public immutable PROVIDER_BINDING_HASH;
    bytes32 private immutable APPROVED_REPOSITORY_HEAD_HASH;
    bytes32 private immutable EXECUTABLE_ARTIFACT_SOURCE_HASH;
    bytes32 private immutable PROFILE_BINDING_HASH;
    bytes32 private immutable PERMIT_EXECUTION_AUTHORITY_HASH;
    uint32 private immutable VERIFIER_GAS_LIMIT;

    uint8 private _executionGuard;
    mapping(bytes32 grantDigest => address launcher) public launcherByGrantDigest;
    mapping(bytes32 grantDigest => address executor) public executorByGrantDigest;

    error InvalidField(uint256 field);
    error UnauthorizedApplicant();
    error ReentrantExecution();
    error RuntimeCodeHashDrift(address account);
    error ComponentCollision(address account);
    error CodeReconstructionMismatch();
    error CreateFailed();
    error PostconditionMismatch();
    error UnexpectedValueFlow();

    event ExactHookemonReusableLaunchFinalized(
        bytes32 indexed grantDigest,
        bytes32 indexed stampLaunchId,
        bytes32 indexed receiptCoreHash,
        address executor,
        address launcher
    );

    constructor(DeploymentConfigV2 memory deployment) {
        _validateDeployment(deployment);
        bytes32 executorCreationHash = keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).creationCode);
        bytes32 executorRuntimeHash = keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).runtimeCode);
        bytes32 exactBindingHash = _exactContractBindingHash(deployment, executorCreationHash, executorRuntimeHash);
        bytes32 providerBindingHash = _providerBindingHash(deployment, exactBindingHash);
        bytes32 profileBindingHash = _profileBindingHashAtDeployment(deployment, providerBindingHash, exactBindingHash);
        bytes32 executionAuthorityHash = _executionAuthorityHashAtDeployment(
            deployment, executorCreationHash, executorRuntimeHash, profileBindingHash, exactBindingHash
        );
        KERNEL = deployment.kernel;
        KERNEL_RUNTIME_CODEHASH = deployment.kernelRuntimeCodeHash;
        CODE_STORE = deployment.codeStore;
        CODE_STORE_RUNTIME_CODEHASH = deployment.codeStoreRuntimeCodeHash;
        CODE_STORE_BINDING_HASH = deployment.codeStoreBindingHash;
        POSTCONDITION_VERIFIER = deployment.postconditionVerifier;
        POSTCONDITION_VERIFIER_RUNTIME_CODEHASH = deployment.postconditionVerifierRuntimeCodeHash;
        VERIFIER_BINDING_HASH = deployment.verifierBindingHash;
        PLAN_MODULE = deployment.planModule;
        PLAN_MODULE_RUNTIME_CODEHASH = deployment.planModuleRuntimeCodeHash;
        PLAN_MODULE_BINDING_HASH = deployment.planModuleBindingHash;
        PERMIT_AUTHORITY = deployment.permitAuthority;
        PERMIT_AUTHORITY_RUNTIME_CODEHASH = deployment.permitAuthorityRuntimeCodeHash;
        LAUNCH_REGISTRY = deployment.launchRegistry;
        LAUNCH_REGISTRY_RUNTIME_CODEHASH = deployment.launchRegistryRuntimeCodeHash;
        LAUNCH_REGISTRY_BINDING_HASH = deployment.launchRegistryBindingHash;
        EXPECTED_LAUNCHER_CREATION_CODE_HASH = deployment.expectedLauncherCreationCodeHash;
        EXPECTED_LAUNCHER_CREATION_CODE_LENGTH = deployment.expectedLauncherCreationCodeLength;
        EXECUTOR_CREATION_CODE_HASH = executorCreationHash;
        EXECUTOR_RUNTIME_CODE_HASH = executorRuntimeHash;
        EXACT_CONTRACT_BINDING_HASH = exactBindingHash;
        VERIFIER_GAS_LIMIT = deployment.verifierGasLimit;
        PROVIDER_BINDING_HASH = providerBindingHash;
        APPROVED_REPOSITORY_HEAD_HASH = _approvedRepositoryHeadHash();
        EXECUTABLE_ARTIFACT_SOURCE_HASH = _executableArtifactSourceHash();
        PROFILE_BINDING_HASH = profileBindingHash;
        PERMIT_EXECUTION_AUTHORITY_HASH = executionAuthorityHash;
    }

    // Slither sees effects after the deliberately atomic external sequence; the guard is set before its first call.
    // slither-disable-next-line reentrancy-no-eth,reentrancy-benign,reentrancy-events
    function launchExactHookemonV2(ExactHookemonReusablePlanV2 calldata plan, bytes calldata encodedTransport)
        external
        returns (bytes32 receiptCoreHash)
    {
        LaunchTransportV2 memory transport = abi.decode(encodedTransport, (LaunchTransportV2));
        KernelTransportV2 memory kernelTransport = abi.decode(transport.encodedKernelTransport, (KernelTransportV2));
        if (_executionGuard != 0) revert ReentrantExecution();
        if (
            msg.sender != plan.hookemon.applicantWallet || msg.sender != plan.hookemon.config.fundingWallet
                || msg.sender != kernelTransport.grant.applicantWallet
        ) revert UnauthorizedApplicant();
        _requireBoundDependencies();

        PreparedExecutionV2 memory prepared = _prepareExecution(plan, kernelTransport, transport.encodedPermitTransport);

        // Guard precedes every stateful external call; the reset is reachable only after the complete atomic path.
        _executionGuard = 1;
        bytes32 activatedDigest =
            KERNEL.activateLaunchGrantV1(kernelTransport.grant, kernelTransport.reviewerGrantSignature);
        if (activatedDigest != prepared.grantDigest) revert PostconditionMismatch();
        IProgrammableUniversalLaunchKernelV1.ProfileExecutionEnvelopeV1 memory envelope =
            IProgrammableUniversalLaunchKernelV1.ProfileExecutionEnvelopeV1({
                currentness: kernelTransport.currentness,
                currentnessSignature: kernelTransport.currentnessSignature,
                walletIntent: kernelTransport.walletIntent,
                walletSignature: kernelTransport.walletSignature,
                reservations: prepared.reservations
            });
        prepared.executionKey = KERNEL.beginProfileExecutionV1(prepared.grantDigest, envelope);
        receiptCoreHash = _consumeCreateVerifyFinalize(
            plan, kernelTransport.grant.stampLaunchId, transport.encodedPermitTransport, prepared
        );
        _executionGuard = 0;
    }

    function _predictedExecutor(bytes32 executorSalt) private view returns (address executor) {
        executor = address(
            uint160(
                uint256(keccak256(abi.encodePacked(hex"ff", address(this), executorSalt, EXECUTOR_CREATION_CODE_HASH)))
            )
        );
    }

    function _predictedLauncher(bytes32 executorSalt) private view returns (address launcher) {
        address executor = _predictedExecutor(executorSalt);
        launcher = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", executor, hex"01")))));
    }

    function permitExecutionAuthorityHash() public view returns (bytes32 executionAuthorityHash) {
        _requireBoundDependencies();
        executionAuthorityHash = PERMIT_EXECUTION_AUTHORITY_HASH;
        _requireBoundDependencies();
    }

    /// @notice Kernel registration readback; the immutable binding commits every dependency and implementation.
    /// @dev This deliberately stays below the Kernel Preflight's 100,000 gas closed-read cap. Dependency runtime
    ///      checks remain fail-closed in permitProfileBindingHash(), permitExecutionAuthorityHash(), and launch().
    function runtimeBindingHashV1() external view returns (bytes32 providerBindingHash) {
        providerBindingHash = PROVIDER_BINDING_HASH;
    }

    function permitProfile() external view returns (address) {
        return address(this);
    }

    function permitProfileId() external pure returns (bytes32) {
        return PROFILE_KEY;
    }

    function permitProfileBindingHash() external view returns (bytes32) {
        _requireBoundDependencies();
        return PROFILE_BINDING_HASH;
    }

    function permitLaunchRegistry() external view returns (address) {
        return address(LAUNCH_REGISTRY);
    }

    function permitKernelEnvelopeMode()
        external
        pure
        returns (IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1)
    {
        return IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED;
    }

    function _prepareExecution(
        ExactHookemonReusablePlanV2 calldata plan,
        KernelTransportV2 memory kernelTransport,
        bytes memory encodedPermitTransport
    ) private view returns (PreparedExecutionV2 memory prepared) {
        prepared.commitments = _validatePlan(plan);
        prepared.grantDigest = KERNEL.computeLaunchGrantDigestV1(kernelTransport.grant);
        _validateGrantPlan(kernelTransport.grant, prepared.grantDigest, plan, prepared.commitments);
        if (
            kernelTransport.currentness.profilePreflightReadbackHash
                != _profilePreflightHash(plan, prepared.commitments)
        ) {
            revert PostconditionMismatch();
        }
        prepared.reservations = _buildReservations(plan);
        prepared.reservationSetHash = KERNEL.computeReservationSetHashV1(prepared.reservations);
        prepared.currentnessDigest = KERNEL.computeExecutionCurrentnessDigestV1(kernelTransport.currentness);
        prepared.walletIntentDigest = KERNEL.computeWalletIntentDigestV1(kernelTransport.walletIntent);
        PermitTransportV2 memory permitTransport = abi.decode(encodedPermitTransport, (PermitTransportV2));
        if (
            permitTransport.permit.launchId != kernelTransport.grant.stampLaunchId
                || permitTransport.permit.technicalApprovalHash != kernelTransport.grant.reviewerAttestationHash
        ) revert InvalidField(9);
        prepared.launcherInitCode = _reconstructLauncherInitCode(plan);
        ProgrammableExactHookemonReusablePlanModuleV2.PermitValidationContextV2 memory context =
            ProgrammableExactHookemonReusablePlanModuleV2.PermitValidationContextV2({
                permitAuthority: PERMIT_AUTHORITY,
                launchRegistry: LAUNCH_REGISTRY,
                route: address(this),
                routeId: ROUTE_ID,
                profileId: PROFILE_KEY,
                profileBindingHash: PROFILE_BINDING_HASH,
                executionAuthorityHash: permitExecutionAuthorityHash(),
                grantDigest: prepared.grantDigest,
                currentnessDigest: prepared.currentnessDigest,
                walletIntentDigest: prepared.walletIntentDigest
            });
        (prepared.executionCoreHash, prepared.executionCalldataKeccak256) = PLAN_MODULE.validatePermitV2(
            plan, permitTransport, prepared.commitments, prepared.launcherInitCode, context
        );
        prepared.balanceBefore = address(this).balance;
    }

    // slither-disable-next-line reentrancy-benign,reentrancy-events
    function _consumeCreateVerifyFinalize(
        ExactHookemonReusablePlanV2 calldata plan,
        bytes32 stampLaunchId,
        bytes memory encodedPermitTransport,
        PreparedExecutionV2 memory prepared
    ) private returns (bytes32 receiptCoreHash) {
        PermitTransportV2 memory permitTransport = abi.decode(encodedPermitTransport, (PermitTransportV2));
        bytes32 permitDigest = _consumePermit(plan, permitTransport, prepared);
        ObservedLaunchV2 memory observed = _deployAndVerify(plan, prepared.launcherInitCode);
        _registerLaunch(plan, permitTransport.permit, permitDigest, observed, prepared.commitments);
        if (address(this).balance != prepared.balanceBefore) revert UnexpectedValueFlow();
        IProgrammableUniversalLaunchKernelV1.ExecutionResultV1 memory result =
            _executionResult(plan, stampLaunchId, observed, prepared);
        receiptCoreHash = KERNEL.finalizeProfileExecutionV1(result);
        executorByGrantDigest[prepared.grantDigest] = observed.executor;
        launcherByGrantDigest[prepared.grantDigest] = observed.launcher;
        emit ExactHookemonReusableLaunchFinalized(
            prepared.grantDigest, stampLaunchId, receiptCoreHash, observed.executor, observed.launcher
        );
    }

    function _consumePermit(
        ExactHookemonReusablePlanV2 calldata plan,
        PermitTransportV2 memory transport,
        PreparedExecutionV2 memory prepared
    ) private returns (bytes32 permitDigest) {
        IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 memory
            actualExecution =
            IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1({
                applicantWallet: plan.hookemon.applicantWallet,
                executionCoreHash: prepared.executionCoreHash,
                executionCalldataKeccak256: prepared.executionCalldataKeccak256,
                executionValue: 0
            });
        bytes32 repositoryKey;
        uint256 consumedNonce;
        (permitDigest, repositoryKey, consumedNonce) = PERMIT_AUTHORITY.consumePermit(
            transport.permit,
            transport.releaseBinding,
            transport.kernelEnvelope,
            transport.permitSignature,
            actualExecution
        );
        if (repositoryKey != plan.hookemon.repositoryKey || consumedNonce != transport.permit.nonce) {
            revert PostconditionMismatch();
        }
    }

    function _deployAndVerify(ExactHookemonReusablePlanV2 calldata plan, bytes memory launcherInitCode)
        private
        returns (ObservedLaunchV2 memory observed)
    {
        ProgrammableExactHookemonNormalCreateExecutorV2 executor =
            new ProgrammableExactHookemonNormalCreateExecutorV2{ salt: plan.executorSalt }();
        if (address(executor) != plan.expectedExecutor || address(executor).codehash != EXECUTOR_RUNTIME_CODE_HASH) {
            revert CreateFailed();
        }
        observed.launcher = executor.executeExactNormalCreateV2(
            launcherInitCode,
            plan.hookemon.completeInitCodeHash,
            plan.hookemon.exclusive.accounts[0],
            plan.hookemon.exclusive.runtimeCodeHashes[0]
        );
        observed.executor = address(executor);
        (observed.architectureHash, observed.poolHash, observed.revenueHash) =
            _verifyPostconditions(plan, observed.launcher);
    }

    function _executionResult(
        ExactHookemonReusablePlanV2 calldata plan,
        bytes32 stampLaunchId,
        ObservedLaunchV2 memory observed,
        PreparedExecutionV2 memory prepared
    ) private view returns (IProgrammableUniversalLaunchKernelV1.ExecutionResultV1 memory result) {
        result.grantDigest = prepared.grantDigest;
        result.stampLaunchId = stampLaunchId;
        result.planHash = prepared.commitments.planHash;
        result.componentSetHash = prepared.commitments.componentSetHash;
        result.componentRuntimeSetHash = prepared.commitments.componentRuntimeSetHash;
        result.configurationHash = prepared.commitments.configurationHash;
        result.reservationSetHash = prepared.reservationSetHash;
        result.providerResultHash = _providerResultHash(
            prepared.executionKey,
            observed.executor,
            observed.launcher,
            plan.hookemon.completeInitCodeHash,
            plan.hookemon.exclusive.runtimeCodeHashes[0]
        );
        result.postconditionHash = keccak256(
            abi.encode(
                POSTCONDITION_TYPEHASH,
                observed.launcher,
                observed.architectureHash,
                observed.poolHash,
                observed.revenueHash
            )
        );
        result.valueFlowHash = prepared.commitments.valueFlowHash;
        result.deploymentLineageHash = _deploymentLineageHash(
            plan.executorSalt, observed.executor, observed.launcher, plan.hookemon.completeInitCodeHash
        );
    }

    function _registerLaunch(
        ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit,
        bytes32 permitDigest,
        ObservedLaunchV2 memory observed,
        PlanCommitmentsV2 memory commitments
    ) private {
        IExactHookemonAtomicLauncherViewV1 launcher = IExactHookemonAtomicLauncherViewV1(observed.launcher);
        address token = launcher.token();
        address hook = launcher.hook();
        IProgrammableHookemonLaunchRegistryV1.HookemonGraphV1 memory graph =
            IProgrammableHookemonLaunchRegistryV1.HookemonGraphV1({
                executor: observed.executor,
                executorRuntimeCodeHash: EXECUTOR_RUNTIME_CODE_HASH,
                launcher: observed.launcher,
                launcherRuntimeCodeHash: plan.hookemon.exclusive.runtimeCodeHashes[0],
                token: token,
                tokenRuntimeCodeHash: plan.hookemon.exclusive.runtimeCodeHashes[1],
                hook: hook,
                hookRuntimeCodeHash: plan.hookemon.exclusive.runtimeCodeHashes[2],
                poolManager: plan.hookemon.config.poolManager,
                poolManagerRuntimeCodeHash: plan.hookemon.poolManagerRuntimeCodeHash,
                canonicalPoolId: plan.hookemon.canonicalPoolId,
                componentGraphHash: commitments.componentGraphHash,
                componentRuntimeSetHash: commitments.componentRuntimeSetHash,
                architectureStateHash: observed.architectureHash,
                poolStateHash: observed.poolHash,
                revenueStateHash: observed.revenueHash,
                revenueBindingHash: REVENUE_POLICY_HASH
            });
        IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory registration =
            PLAN_MODULE.buildLaunchRegistrationV2(
                plan,
                permit,
                permitDigest,
                LAUNCH_REGISTRY.REGISTRY_GENERATION(),
                APPROVED_REPOSITORY_HEAD_HASH,
                EXECUTABLE_ARTIFACT_SOURCE_HASH,
                EXACT_CONTRACT_BINDING_HASH,
                graph
            );
        registration.registeredRecordCommitment = LAUNCH_REGISTRY.computeRegisteredRecordCommitmentV1(registration);
        LAUNCH_REGISTRY.registerLaunchFromConsumedPermitV1(registration);
    }

    function _providerResultHash(
        bytes32 executionKey,
        address executor,
        address launcher,
        bytes32 completeInitCodeHash,
        bytes32 launcherRuntimeCodeHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROVIDER_RESULT_TYPEHASH,
                executionKey,
                address(this),
                executor,
                EXPECTED_CREATE_NONCE,
                launcher,
                completeInitCodeHash,
                launcherRuntimeCodeHash
            )
        );
    }

    function _deploymentLineageHash(
        bytes32 executorSalt,
        address executor,
        address launcher,
        bytes32 completeInitCodeHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                DEPLOYMENT_LINEAGE_TYPEHASH,
                address(this),
                executorSalt,
                executor,
                EXPECTED_CREATE_NONCE,
                launcher,
                completeInitCodeHash
            )
        );
    }

    function _validatePlan(ExactHookemonReusablePlanV2 calldata plan)
        private
        view
        returns (PlanCommitmentsV2 memory commitments)
    {
        _requireBoundDependencies();
        commitments = PLAN_MODULE.validateAndCommitPlanV2(
            plan,
            address(PERMIT_AUTHORITY),
            _predictedExecutor(plan.executorSalt),
            _predictedLauncher(plan.executorSalt)
        );
        _requireBoundDependencies();
        (bytes32 tokenNameHash, bytes32 tokenSymbolHash) = POSTCONDITION_VERIFIER.validateTokenIdentityV1(
            plan.hookemon.config.tokenName, plan.hookemon.config.tokenSymbol
        );
        if (plan.hookemon.tokenNameHash != tokenNameHash || plan.hookemon.tokenSymbolHash != tokenSymbolHash) {
            revert InvalidField(4);
        }
        _requireBoundDependencies();
        _validatePrestate(plan);
        _reconstructLauncherInitCode(plan);
    }

    function _validatePrestate(ExactHookemonReusablePlanV2 calldata plan) private view {
        _requireBoundDependencies();
        PLAN_MODULE.validatePrestateV2(plan, PERMIT_AUTHORITY, address(this));
        _requireBoundDependencies();
    }

    function _validateGrantPlan(
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant,
        bytes32 grantDigest,
        ExactHookemonReusablePlanV2 calldata plan,
        PlanCommitmentsV2 memory commitments
    ) private view {
        _requireBoundDependencies();
        PLAN_MODULE.validateGrantPlanV2(
            grant,
            grantDigest,
            plan,
            commitments,
            KERNEL,
            address(this),
            EXACT_CONTRACT_BINDING_HASH,
            PROVIDER_BINDING_HASH,
            REVENUE_POLICY_HASH
        );
        _requireBoundDependencies();
    }

    function _reconstructLauncherInitCode(ExactHookemonReusablePlanV2 calldata plan)
        private
        view
        returns (bytes memory initCode)
    {
        _requireBoundDependencies();
        initCode = PLAN_MODULE.reconstructLauncherInitCodeV2(
            plan, CODE_STORE, EXPECTED_LAUNCHER_CREATION_CODE_HASH, EXPECTED_LAUNCHER_CREATION_CODE_LENGTH
        );
        _requireBoundDependencies();
    }

    function _verifyPostconditions(ExactHookemonReusablePlanV2 calldata plan, address launcher)
        private
        view
        returns (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash)
    {
        _requireBoundDependencies();
        (architectureHash, poolHash, revenueHash) =
            PLAN_MODULE.verifyPostconditionsV2(address(POSTCONDITION_VERIFIER), VERIFIER_GAS_LIMIT, plan, launcher);
        _requireBoundDependencies();
    }

    function _profilePreflightHash(ExactHookemonReusablePlanV2 calldata plan, PlanCommitmentsV2 memory commitments)
        private
        view
        returns (bytes32 readbackHash)
    {
        _requireBoundDependencies();
        _validatePrestate(plan);
        readbackHash = PLAN_MODULE.computeProfilePreflightHashV2(
            plan,
            commitments,
            ProgrammableExactHookemonReusablePlanModuleV2.ProfilePreflightBindingsV2({
                profile: address(this),
                codeStoreBindingHash: CODE_STORE_BINDING_HASH,
                verifierBindingHash: VERIFIER_BINDING_HASH,
                planModuleBindingHash: PLAN_MODULE_BINDING_HASH,
                permitAuthority: address(PERMIT_AUTHORITY),
                permitAuthorityRuntimeCodeHash: PERMIT_AUTHORITY_RUNTIME_CODEHASH,
                launchRegistryBindingHash: LAUNCH_REGISTRY_BINDING_HASH
            })
        );
        _requireBoundDependencies();
    }

    function _buildReservations(ExactHookemonReusablePlanV2 calldata plan)
        private
        view
        returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations)
    {
        ProgrammableExactHookemonReusablePlanModuleV2.ReservationDependenciesV2 memory dependencies =
            ProgrammableExactHookemonReusablePlanModuleV2.ReservationDependenciesV2({
                codeStore: address(CODE_STORE),
                codeStoreRuntimeCodeHash: CODE_STORE_RUNTIME_CODEHASH,
                codeStoreBindingHash: CODE_STORE_BINDING_HASH,
                codeParts: [address(0), address(0)],
                codePartRuntimeCodeHashes: [bytes32(0), bytes32(0)],
                postconditionVerifier: address(POSTCONDITION_VERIFIER),
                postconditionVerifierRuntimeCodeHash: POSTCONDITION_VERIFIER_RUNTIME_CODEHASH,
                verifierBindingHash: VERIFIER_BINDING_HASH,
                planModule: address(PLAN_MODULE),
                planModuleRuntimeCodeHash: PLAN_MODULE_RUNTIME_CODEHASH,
                planModuleBindingHash: PLAN_MODULE_BINDING_HASH,
                permitAuthority: address(PERMIT_AUTHORITY),
                permitAuthorityRuntimeCodeHash: PERMIT_AUTHORITY_RUNTIME_CODEHASH,
                permitAuthorityBindingHash: keccak256(
                    abi.encode(
                        SHARED_AUTHORITY_COMMIT,
                        SHARED_AUTHORITY_TREE,
                        SHARED_AUTHORITY_INTERFACE_SHA256,
                        SHARED_AUTHORITY_INTERFACE_BLOB
                    )
                )
            });
        for (uint256 i; i < 2; ++i) {
            (address part, bytes32 runtimeHash, uint256 partLength) = CODE_STORE.partV1(i);
            if (partLength == 0) revert CodeReconstructionMismatch();
            dependencies.codeParts[i] = part;
            dependencies.codePartRuntimeCodeHashes[i] = runtimeHash;
        }
        _requireBoundDependencies();
        reservations = PLAN_MODULE.buildReservationsV2(plan, dependencies);
        _requireBoundDependencies();
    }

    function _providerBindingHash(DeploymentConfigV2 memory deployment, bytes32 exactBindingHash)
        private
        view
        returns (bytes32)
    {
        bytes32 dependencyAHash = keccak256(
            abi.encode(
                address(deployment.kernel),
                deployment.kernelRuntimeCodeHash,
                address(deployment.codeStore),
                deployment.codeStoreRuntimeCodeHash,
                deployment.codeStoreBindingHash
            )
        );
        bytes32 dependencyBHash = keccak256(
            abi.encode(
                address(deployment.postconditionVerifier),
                deployment.postconditionVerifierRuntimeCodeHash,
                deployment.verifierBindingHash,
                address(deployment.planModule),
                deployment.planModuleRuntimeCodeHash,
                deployment.planModuleBindingHash,
                address(deployment.permitAuthority),
                deployment.permitAuthorityRuntimeCodeHash,
                address(deployment.launchRegistry),
                deployment.launchRegistryRuntimeCodeHash,
                deployment.launchRegistryBindingHash
            )
        );
        return keccak256(
            abi.encode(
                PROVIDER_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                ROUTE_ID,
                PROFILE_KEY,
                dependencyAHash,
                dependencyBHash,
                exactBindingHash
            )
        );
    }

    function _profileBindingHashAtDeployment(
        DeploymentConfigV2 memory deployment,
        bytes32 providerBindingHash,
        bytes32 exactBindingHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                PROFILE_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                PROFILE_KEY,
                address(deployment.planModule),
                deployment.planModuleRuntimeCodeHash,
                deployment.planModuleBindingHash,
                providerBindingHash,
                exactBindingHash
            )
        );
    }

    function _executionAuthorityHashAtDeployment(
        DeploymentConfigV2 memory deployment,
        bytes32 executorCreationHash,
        bytes32 executorRuntimeHash,
        bytes32 profileBindingHash,
        bytes32 exactBindingHash
    ) private view returns (bytes32) {
        bytes32 dependencyAHash = keccak256(
            abi.encode(
                address(deployment.kernel),
                deployment.kernelRuntimeCodeHash,
                address(deployment.permitAuthority),
                deployment.permitAuthorityRuntimeCodeHash,
                address(deployment.launchRegistry),
                deployment.launchRegistryRuntimeCodeHash,
                deployment.launchRegistryBindingHash
            )
        );
        bytes32 dependencyBHash = keccak256(
            abi.encode(
                address(deployment.codeStore),
                deployment.codeStoreRuntimeCodeHash,
                deployment.codeStoreBindingHash,
                address(deployment.postconditionVerifier),
                deployment.postconditionVerifierRuntimeCodeHash,
                deployment.verifierBindingHash,
                address(deployment.planModule),
                deployment.planModuleRuntimeCodeHash,
                deployment.planModuleBindingHash,
                executorCreationHash,
                executorRuntimeHash
            )
        );
        return keccak256(
            abi.encode(
                PERMIT_EXECUTION_AUTHORITY_TYPEHASH,
                block.chainid,
                address(this),
                ROUTE_ID,
                address(this),
                PROFILE_KEY,
                profileBindingHash,
                dependencyAHash,
                dependencyBHash,
                exactBindingHash
            )
        );
    }

    function _validateDeployment(DeploymentConfigV2 memory deployment) private view {
        if (
            address(deployment.kernel) == address(0) || address(deployment.codeStore) == address(0)
                || address(deployment.postconditionVerifier) == address(0)
                || address(deployment.planModule) == address(0) || address(deployment.permitAuthority) == address(0)
                || address(deployment.launchRegistry) == address(0) || deployment.codeStoreBindingHash == bytes32(0)
                || deployment.verifierBindingHash == bytes32(0) || deployment.planModuleBindingHash == bytes32(0)
                || deployment.launchRegistryBindingHash == bytes32(0)
                || deployment.expectedLauncherCreationCodeHash == bytes32(0)
                || deployment.expectedLauncherCreationCodeLength == 0 || deployment.verifierGasLimit < 300_000
        ) revert InvalidField(1);
        _requireRuntime(address(deployment.kernel), deployment.kernelRuntimeCodeHash);
        _requireBoundRuntime(
            address(deployment.codeStore), deployment.codeStoreRuntimeCodeHash, deployment.codeStoreBindingHash
        );
        _requireBoundRuntime(
            address(deployment.postconditionVerifier),
            deployment.postconditionVerifierRuntimeCodeHash,
            deployment.verifierBindingHash
        );
        _requireBoundRuntime(
            address(deployment.planModule), deployment.planModuleRuntimeCodeHash, deployment.planModuleBindingHash
        );
        _requireBoundRuntime(
            address(deployment.launchRegistry),
            deployment.launchRegistryRuntimeCodeHash,
            deployment.launchRegistryBindingHash
        );
        _requireRuntime(address(deployment.permitAuthority), deployment.permitAuthorityRuntimeCodeHash);
        if (
            deployment.launchRegistry.LAUNCH_PERMIT_AUTHORITY() != address(deployment.permitAuthority)
                || deployment.launchRegistry.LAUNCH_ROUTE() != address(this)
                || deployment.launchRegistry.ROUTE_ID() != ROUTE_ID
                || deployment.launchRegistry.PROFILE_ID() != PROFILE_KEY
                || deployment.launchRegistry.HOOKEMON_REVENUE_BINDING_HASH() != REVENUE_POLICY_HASH
        ) revert InvalidField(2);
        if (
            deployment.codeStore.creationCodeHashV1() != deployment.expectedLauncherCreationCodeHash
                || deployment.codeStore.creationCodeLengthV1() != deployment.expectedLauncherCreationCodeLength
                || deployment.postconditionVerifier.tokenIdentityConstraintsHashV1() != TOKEN_IDENTITY_CONSTRAINTS_HASH
                || deployment.planModule.MODULE_BINDING_HASH() != deployment.planModuleBindingHash
        ) revert InvalidField(2);
    }

    function _exactContractBindingHash(
        DeploymentConfigV2 memory deployment,
        bytes32 executorCreationHash,
        bytes32 executorRuntimeHash
    ) private pure returns (bytes32) {
        bytes32 approvedRepositoryHeadHash = _approvedRepositoryHeadHash();
        bytes32 executableArtifactSourceHash = _executableArtifactSourceHash();
        bytes32 artifactHead = keccak256(
            abi.encode(
                deployment.expectedLauncherCreationCodeHash,
                deployment.expectedLauncherCreationCodeLength,
                executorCreationHash,
                executorRuntimeHash,
                EXPECTED_CREATE_NONCE
            )
        );
        return keccak256(
            abi.encode(
                EXACT_CONTRACT_BINDING_TYPEHASH,
                approvedRepositoryHeadHash,
                executableArtifactSourceHash,
                artifactHead,
                TOKEN_IDENTITY_POLICY_HASH,
                TOKEN_IDENTITY_CONSTRAINTS_HASH,
                SHARED_AUTHORITY_COMMIT,
                SHARED_AUTHORITY_TREE,
                SHARED_AUTHORITY_INTERFACE_SHA256,
                SHARED_AUTHORITY_INTERFACE_BLOB
            )
        );
    }

    function _approvedRepositoryHeadHash() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                APPROVED_REPOSITORY_HEAD_TYPEHASH,
                GITHUB_REPOSITORY_ID,
                SOURCE_REPOSITORY_KEY,
                APPROVED_REPOSITORY_HEAD_COMMIT,
                APPROVED_REPOSITORY_HEAD_TREE
            )
        );
    }

    function _executableArtifactSourceHash() private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXECUTABLE_ARTIFACT_SOURCE_TYPEHASH, EXECUTABLE_ARTIFACT_SOURCE_COMMIT, EXECUTABLE_ARTIFACT_SOURCE_TREE
            )
        );
    }

    function _requireBoundDependencies() private view {
        _requireRuntime(address(KERNEL), KERNEL_RUNTIME_CODEHASH);
        _requireBoundRuntime(address(CODE_STORE), CODE_STORE_RUNTIME_CODEHASH, CODE_STORE_BINDING_HASH);
        _requireBoundRuntime(
            address(POSTCONDITION_VERIFIER), POSTCONDITION_VERIFIER_RUNTIME_CODEHASH, VERIFIER_BINDING_HASH
        );
        _requireBoundRuntime(address(PLAN_MODULE), PLAN_MODULE_RUNTIME_CODEHASH, PLAN_MODULE_BINDING_HASH);
        _requireRuntime(address(PERMIT_AUTHORITY), PERMIT_AUTHORITY_RUNTIME_CODEHASH);
        _requireBoundRuntime(address(LAUNCH_REGISTRY), LAUNCH_REGISTRY_RUNTIME_CODEHASH, LAUNCH_REGISTRY_BINDING_HASH);
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
        bytes memory output = new bytes(32);
        bool success;
        uint256 returnedSize;
        uint256 gasLimit = BINDING_READ_GAS_LIMIT;
        // Fixed output copying prevents a dependency from griefing the route with oversized return data.
        assembly ("memory-safe") {
            success := staticcall(gasLimit, account, add(payload, 32), mload(payload), add(output, 32), 32)
            returnedSize := returndatasize()
        }
        if (
            !success || returnedSize != 32 || abi.decode(output, (bytes32)) != expectedBindingHash
                || account.codehash != expectedCodeHash
        ) revert RuntimeCodeHashDrift(account);
    }
}
