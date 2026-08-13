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
import { ProgrammableExactHookemonNormalCreateExecutorV2 } from "./ProgrammableExactHookemonNormalCreateExecutorV2.sol";
import { IProgrammableHookemonLaunchRegistryV1 } from "./IProgrammableHookemonLaunchRegistryV1.sol";

/// @notice Fixed stateless hashing, structural-validation and reservation module for the reusable Hookemon route.
/// @dev The stateful profile pins this module's address, runtime code hash and binding hash and checks them before and
///      after every call. No launch authority, replay state, reentrancy state or external effect lives in this module.
contract ProgrammableExactHookemonReusablePlanModuleV2 is IProgrammableRuntimeBindingV1 {
    uint256 private constant MINIMUM_CONSTRUCTOR_ARGUMENT_BYTES = 1440;
    uint256 private constant MAXIMUM_CONSTRUCTOR_ARGUMENT_BYTES = 1472;
    uint256 private constant MAXIMUM_INITCODE_BYTES = 49_152;
    uint16 private constant PLAN_SCHEMA_VERSION = 2;
    uint16 private constant INNER_PLAN_SCHEMA_VERSION = 1;
    uint64 private constant GITHUB_REPOSITORY_ID = 1_324_982_531;
    bytes32 private constant SOURCE_REPOSITORY_KEY =
        keccak256(abi.encode("programmable.github.repository.v1", GITHUB_REPOSITORY_ID));
    bytes32 private constant PROFILE_ID_HOOKEMON_V2 = keccak256("HOOKEMON:EXACT_REUSABLE_NORMAL_CREATE:v2");
    bytes20 private constant APPROVED_REPOSITORY_HEAD_COMMIT = bytes20(hex"9943c158998147f4fea9049fb42b8c4a5d044c1d");
    bytes20 private constant APPROVED_REPOSITORY_HEAD_TREE = bytes20(hex"99a6984362a86e49ae8f2318b170da6d916dc519");

    bytes32 public constant PLAN_TYPEHASH = keccak256(
        "ExactHookemonReusableNormalCreatePlanV2(bytes32 sourceIdentityHash,bytes32 actionHash,bytes32 componentGraphHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,bytes32 configurationHash,bytes32 expectedStateHash,bytes32 valueFlowHash)"
    );
    bytes32 private constant EXECUTOR_SALT_TYPEHASH = keccak256(
        "ExactHookemonExecutorSaltV2(bytes32 repositoryKey,bytes32 sourceLaunchId,address applicantWallet)"
    );
    bytes32 private constant SOURCE_IDENTITY_TYPEHASH = keccak256(
        "ExactHookemonReusableSourceIdentityV2(uint16 schemaVersion,address applicantWallet,bytes32 sourceLaunchId,uint64 githubRepositoryId,bytes32 repositoryKey,address permitAuthority,bytes32 presentationBindingHash)"
    );
    bytes32 private constant ACTION_TYPEHASH = keccak256(
        "ExactHookemonReusableActionV2(address executor,bytes32 executorSalt,address launcher,bytes32 completeInitCodeHash,bytes32 launcherRuntimeCodeHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 canonicalPoolId,uint256 expectedPositionTokenId,bytes32 expectedLaunchConfigHash,bytes32 expectedLaunchId,bytes32 expectedLaunchHash)"
    );
    bytes32 private constant GRAPH_TYPEHASH = keccak256(
        "ExactHookemonReusableGraphV2(address executor,bytes32 executorRuntimeCodeHash,bytes32 exclusiveHead,bytes32 sharedHead,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 canonicalPoolId)"
    );
    bytes32 private constant CONFIGURATION_TYPEHASH =
        keccak256("ExactHookemonReusableConfigurationV2(bytes32 routeHead,bytes32 launcherHead)");
    bytes32 private constant EXPECTED_STATE_TYPEHASH = keccak256(
        "ExactHookemonExpectedStateV1(bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash)"
    );
    bytes32 private constant VALUE_FLOW_TYPEHASH = keccak256(
        "ExactHookemonReusableValueFlowV2(address fundingWallet,address usdc,address launcher,uint256 liquidityUsdcAmount,uint256 cycleBootstrapUsdcAmount,uint256 exactApproval,uint256 nativeValue)"
    );
    bytes32 private constant EXECUTION_CORE_TYPEHASH = keccak256(
        "ExactHookemonExecutionCoreV2(bytes32 rawPlanHash,bytes32 rawLaunchConfigHash,address executor,address launcher,bytes32 completeInitCodeHash,uint256 executionValue)"
    );
    bytes32 private constant PROFILE_PREFLIGHT_TYPEHASH = keccak256(
        "ExactHookemonReusablePreflightV2(uint256 chainId,address profile,address executor,address launcher,bytes32 planHash,bytes32 configurationHash,bytes32 componentSetHash,bytes32 componentRuntimeSetHash,address approvalAsset,uint256 exactApproval,bytes32 codeStoreBindingHash,bytes32 verifierBindingHash,bytes32 permitAuthorityBindingHash)"
    );
    bytes32 private constant SHARED_RESERVATION_IDENTITY_TYPEHASH = keccak256(
        "ExactHookemonReusableSharedReservationIdentityV2(uint8 role,address account,bytes32 runtimeCodeHash)"
    );
    bytes32 public constant MODULE_BINDING_HASH = keccak256(
        "ProgrammableExactHookemonReusablePlanModuleV2:approved-head-9943c158:artifact-source-55fd47ce:shared-authority-8afe4548553b406bd0374b3a8958f1a186104b11"
    );

    struct ReservationDependenciesV2 {
        address codeStore;
        bytes32 codeStoreRuntimeCodeHash;
        bytes32 codeStoreBindingHash;
        address[2] codeParts;
        bytes32[2] codePartRuntimeCodeHashes;
        address postconditionVerifier;
        bytes32 postconditionVerifierRuntimeCodeHash;
        bytes32 verifierBindingHash;
        address planModule;
        bytes32 planModuleRuntimeCodeHash;
        bytes32 planModuleBindingHash;
        address permitAuthority;
        bytes32 permitAuthorityRuntimeCodeHash;
        bytes32 permitAuthorityBindingHash;
    }

    struct PermitValidationContextV2 {
        IProgrammableLaunchPermitAuthorityV1 permitAuthority;
        IProgrammableHookemonLaunchRegistryV1 launchRegistry;
        address route;
        bytes32 routeId;
        bytes32 profileId;
        bytes32 profileBindingHash;
        bytes32 executionAuthorityHash;
        bytes32 grantDigest;
        bytes32 currentnessDigest;
        bytes32 walletIntentDigest;
    }

    struct ProfilePreflightBindingsV2 {
        address profile;
        bytes32 codeStoreBindingHash;
        bytes32 verifierBindingHash;
        bytes32 planModuleBindingHash;
        address permitAuthority;
        bytes32 permitAuthorityRuntimeCodeHash;
        bytes32 launchRegistryBindingHash;
    }

    error InvalidField(uint256 field);
    error ComponentCollision(address account);
    error RuntimeCodeHashDrift(address account);
    error CodeReconstructionMismatch();
    error UnexpectedValueFlow();
    error PostconditionMismatch();
    error VerifierCallFailed();
    error VerifierReturnMalformed();

    function runtimeBindingHashV1() external pure returns (bytes32) {
        return MODULE_BINDING_HASH;
    }

    function predictedExecutorV2(address route, bytes32 executorSalt) public pure returns (address executor) {
        executor = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            route,
                            executorSalt,
                            keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).creationCode)
                        )
                    )
                )
            )
        );
    }

    function predictedLauncherV2(address route, bytes32 executorSalt) external pure returns (address launcher) {
        address executor = predictedExecutorV2(route, executorSalt);
        launcher = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", executor, hex"01")))));
    }

    function validateAndCommitPlanV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        address expectedPermitAuthority,
        address predictedExecutor,
        address predictedLauncher
    ) external pure returns (IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory) {
        _validateIdentityAndAction(plan, expectedPermitAuthority, predictedExecutor, predictedLauncher);
        _validateConfiguration(plan.hookemon);
        _validateComponents(plan);
        return _planCommitments(plan);
    }

    function computePlanCommitmentsV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) external pure returns (IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory) {
        return _planCommitments(plan);
    }

    function computeExecutionCoreHashV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) external pure returns (bytes32) {
        return _executionCoreHash(plan);
    }

    function validateGrantPlanV2(
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 calldata grant,
        bytes32 grantDigest,
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 calldata commitments,
        IProgrammableUniversalLaunchKernelV1 kernel,
        address profile,
        bytes32 exactContractBindingHash,
        bytes32 providerBindingHash,
        bytes32 revenuePolicyHash
    ) external view {
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            kernel.profileDescriptorV1(PROFILE_ID_HOOKEMON_V2);
        if (
            grantDigest == bytes32(0) || grant.profileKey != PROFILE_ID_HOOKEMON_V2
                || grant.applicantWallet != plan.hookemon.applicantWallet || grant.planHash != commitments.planHash
                || grant.sourceRepoHash != plan.hookemon.repositoryKey
                || grant.sourceCommit != APPROVED_REPOSITORY_HEAD_COMMIT
                || grant.sourceTree != APPROVED_REPOSITORY_HEAD_TREE
                || grant.sourceLaunchId != plan.hookemon.sourceLaunchId
                || grant.componentGraphHash != commitments.componentGraphHash
                || grant.componentRuntimeSetHash != commitments.componentRuntimeSetHash
                || grant.configurationHash != commitments.configurationHash
                || grant.exactContractBindingHash != exactContractBindingHash
                || grant.providerBindingHash != providerBindingHash || grant.revenueBindingHash != revenuePolicyHash
                || descriptor.module != profile || descriptor.moduleRuntimeCodeHash != profile.codehash
                || descriptor.actionTypeHash != PLAN_TYPEHASH
                || descriptor.exactContractBindingHash != exactContractBindingHash
                || descriptor.providerBindingHash != providerBindingHash
                || descriptor.revenuePolicyHash != revenuePolicyHash
                || descriptor.capabilitySemantics != IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute
        ) revert InvalidField(8);
    }

    function computeProfilePreflightHashV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 calldata commitments,
        ProfilePreflightBindingsV2 calldata bindings
    ) external view returns (bytes32) {
        uint256 exactApproval = plan.hookemon.config.liquidityUsdcAmount + plan.hookemon.config.cycleBootstrapUsdcAmount;
        bytes32 authorityBindingHash = keccak256(
            abi.encode(
                bindings.planModuleBindingHash,
                bindings.permitAuthority,
                bindings.permitAuthorityRuntimeCodeHash,
                bindings.launchRegistryBindingHash
            )
        );
        return keccak256(
            abi.encode(
                PROFILE_PREFLIGHT_TYPEHASH,
                block.chainid,
                bindings.profile,
                plan.expectedExecutor,
                plan.hookemon.exclusive.accounts[0],
                commitments.planHash,
                commitments.configurationHash,
                commitments.componentSetHash,
                commitments.componentRuntimeSetHash,
                plan.hookemon.config.usdc,
                exactApproval,
                bindings.codeStoreBindingHash,
                bindings.verifierBindingHash,
                authorityBindingHash
            )
        );
    }

    function verifyPostconditionsV2(
        address verifier,
        uint256 verifierGasLimit,
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        address launcher
    ) external view returns (bytes32 architectureHash, bytes32 poolHash, bytes32 revenueHash) {
        bytes memory payload = abi.encodeCall(
            IExactHookemonPostconditionVerifierPlanModuleV2.verifyExactHookemonPostconditionsV2,
            (
                launcher,
                plan.hookemon.exclusive.runtimeCodeHashes[0],
                plan.hookemon.tokenNameHash,
                plan.hookemon.tokenSymbolHash
            )
        );
        bytes memory output = new bytes(96);
        bool success;
        uint256 returnedSize;
        assembly ("memory-safe") {
            success := staticcall(verifierGasLimit, verifier, add(payload, 32), mload(payload), add(output, 32), 96)
            returnedSize := returndatasize()
        }
        if (!success) revert VerifierCallFailed();
        if (returnedSize != 96) revert VerifierReturnMalformed();
        (architectureHash, poolHash, revenueHash) = abi.decode(output, (bytes32, bytes32, bytes32));
        if (
            architectureHash != plan.hookemon.expectedArchitectureStateHash
                || poolHash != plan.hookemon.expectedPoolStateHash
                || revenueHash != plan.hookemon.expectedRevenueStateHash
        ) revert PostconditionMismatch();
    }

    function validatePermitV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PermitTransportV2 calldata transport,
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 calldata commitments,
        bytes calldata launcherInitCode,
        PermitValidationContextV2 calldata context
    ) external view returns (bytes32 executionCoreHash, bytes32 executionCalldataKeccak256) {
        executionCoreHash = _executionCoreHash(plan);
        executionCalldataKeccak256 = keccak256(
            abi.encodeCall(
                ProgrammableExactHookemonNormalCreateExecutorV2.executeExactNormalCreateV2,
                (
                    launcherInitCode,
                    plan.hookemon.completeInitCodeHash,
                    plan.hookemon.exclusive.accounts[0],
                    plan.hookemon.exclusive.runtimeCodeHashes[0]
                )
            )
        );
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit = transport.permit;
        if (
            permit.chainId != block.chainid || permit.githubRepositoryId != GITHUB_REPOSITORY_ID
                || permit.repositoryKey != SOURCE_REPOSITORY_KEY || permit.routeId != context.routeId
                || permit.route != context.route || permit.approvalGeneration == 0 || permit.permitGeneration == 0
                || permit.launchId == bytes32(0) || permit.approvalId == bytes32(0)
                || permit.technicalApprovalHash == bytes32(0) || permit.applicantWallet != plan.hookemon.applicantWallet
                || permit.configurationHash != commitments.configurationHash
                || permit.presentationBindingHash != plan.hookemon.presentationBindingHash
                || permit.executionPlanHash != commitments.planHash || permit.executionCoreHash != executionCoreHash
                || permit.executionCalldataKeccak256 != executionCalldataKeccak256
        ) revert InvalidField(9);
        if (
            permit.releaseBindingHash != context.permitAuthority.computeReleaseBindingHash(transport.releaseBinding)
                || permit.generationBindingHash != context.permitAuthority.computeGenerationBindingHash(permit)
                || transport.kernelEnvelope.kernelGrantDigest != context.grantDigest
                || transport.kernelEnvelope.reviewerCurrentnessDigest != context.currentnessDigest
                || transport.kernelEnvelope.applicantWalletIntentDigest != context.walletIntentDigest
                || permit.kernelExecutionEnvelopeHash
                    != context.permitAuthority.computeKernelExecutionEnvelopeHash(transport.kernelEnvelope)
                || permit.executionValue != 0 || permit.deadline <= block.timestamp
                || transport.permitSignature.length == 0 || context.grantDigest == bytes32(0)
                || context.currentnessDigest == bytes32(0) || context.walletIntentDigest == bytes32(0)
        ) revert InvalidField(9);
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata release = transport.releaseBinding;
        if (
            release.permitAuthority != address(context.permitAuthority)
                || release.launchRegistry != address(context.launchRegistry)
                || release.launchRegistryGeneration != context.launchRegistry.REGISTRY_GENERATION()
                || release.chainProfileHash != context.launchRegistry.CHAIN_PROFILE_HASH()
                || release.profile != context.route || release.profileId != context.profileId
                || release.profileBindingHash != context.profileBindingHash || release.route != context.route
                || release.routeId != context.routeId
                || release.executionAuthorityHash != context.executionAuthorityHash
                || release.kernelEnvelopeMode != IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED
        ) revert InvalidField(9);
    }

    function validatePrestateV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableLaunchPermitAuthorityV1 permitAuthority,
        address route
    ) external view {
        if (plan.expectedExecutor.code.length != 0) revert ComponentCollision(plan.expectedExecutor);
        for (uint256 i; i < 9; ++i) {
            address account = plan.hookemon.exclusive.accounts[i];
            if (account.code.length != 0) revert ComponentCollision(account);
        }
        for (uint256 i; i < 14; ++i) {
            _requireRuntime(plan.hookemon.shared.accounts[i], plan.hookemon.shared.runtimeCodeHashes[i]);
        }
        _requireRuntime(plan.hookemon.config.poolManager, plan.hookemon.poolManagerRuntimeCodeHash);
        if (
            permitAuthority.repositoryConsumed(plan.hookemon.repositoryKey)
                || !IAccessControlViewHookemonV2(address(permitAuthority))
                    .hasRole(permitAuthority.CONSUMER_ROLE(), route)
        ) revert InvalidField(7);
        uint256 exactApproval = plan.hookemon.config.liquidityUsdcAmount + plan.hookemon.config.cycleBootstrapUsdcAmount;
        if (
            IExactHookemonReusableApprovalAssetPlanModuleV2(plan.hookemon.config.usdc)
                    .allowance(plan.hookemon.applicantWallet, plan.hookemon.exclusive.accounts[0]) != exactApproval
        ) revert UnexpectedValueFlow();
    }

    function reconstructLauncherInitCodeV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableExactHookemonLauncherCodeStoreV1 codeStore,
        bytes32 expectedCreationCodeHash,
        uint256 expectedCreationCodeLength
    ) external view returns (bytes memory initCode) {
        bytes memory creationCode = codeStore.readCreationCodeV1();
        if (creationCode.length != expectedCreationCodeLength || keccak256(creationCode) != expectedCreationCodeHash) {
            revert CodeReconstructionMismatch();
        }
        bytes memory constructorArguments =
            abi.encode(plan.hookemon.shared.accounts[0], plan.hookemon.shared.accounts[1], plan.hookemon.config);
        if (
            constructorArguments.length < MINIMUM_CONSTRUCTOR_ARGUMENT_BYTES
                || constructorArguments.length > MAXIMUM_CONSTRUCTOR_ARGUMENT_BYTES
        ) revert CodeReconstructionMismatch();
        initCode = bytes.concat(creationCode, constructorArguments);
        if (initCode.length > MAXIMUM_INITCODE_BYTES || keccak256(initCode) != plan.hookemon.completeInitCodeHash) {
            revert CodeReconstructionMismatch();
        }
    }

    function buildReservationsV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        ReservationDependenciesV2 calldata dependencies
    ) external pure returns (IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations) {
        reservations = new IProgrammableUniversalLaunchKernelV1.ReservationV1[](32);
        reservations[0] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            plan.expectedExecutor,
            keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).runtimeCode),
            bytes32(0)
        );
        for (uint256 i; i < 9; ++i) {
            reservations[1 + i] = _componentReservation(
                IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
                plan.hookemon.exclusive.accounts[i],
                plan.hookemon.exclusive.runtimeCodeHashes[i],
                bytes32(0)
            );
        }
        for (uint256 i; i < 14; ++i) {
            reservations[10 + i] = _componentReservation(
                IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
                plan.hookemon.shared.accounts[i],
                plan.hookemon.shared.runtimeCodeHashes[i],
                keccak256(
                    abi.encode(
                        SHARED_RESERVATION_IDENTITY_TYPEHASH,
                        uint8(i + 1),
                        plan.hookemon.shared.accounts[i],
                        plan.hookemon.shared.runtimeCodeHashes[i]
                    )
                )
            );
        }
        reservations[24] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Token,
            scope: IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            account: plan.hookemon.exclusive.accounts[1],
            manager: address(0),
            identifier: bytes32(0),
            expectedRuntimeCodeHash: plan.hookemon.exclusive.runtimeCodeHashes[1],
            expectedManagerRuntimeCodeHash: bytes32(0),
            sharedIdentityHash: bytes32(0)
        });
        reservations[25] = IProgrammableUniversalLaunchKernelV1.ReservationV1({
            kind: IProgrammableUniversalLaunchKernelV1.ReservationKind.Pool,
            scope: IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive,
            account: address(0),
            manager: plan.hookemon.config.poolManager,
            identifier: plan.hookemon.canonicalPoolId,
            expectedRuntimeCodeHash: bytes32(0),
            expectedManagerRuntimeCodeHash: plan.hookemon.poolManagerRuntimeCodeHash,
            sharedIdentityHash: bytes32(0)
        });
        reservations[26] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
            dependencies.codeStore,
            dependencies.codeStoreRuntimeCodeHash,
            dependencies.codeStoreBindingHash
        );
        for (uint256 i; i < 2; ++i) {
            reservations[27 + i] = _componentReservation(
                IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
                dependencies.codeParts[i],
                dependencies.codePartRuntimeCodeHashes[i],
                keccak256(
                    abi.encode(
                        dependencies.codeStoreBindingHash,
                        i,
                        dependencies.codeParts[i],
                        dependencies.codePartRuntimeCodeHashes[i]
                    )
                )
            );
        }
        reservations[29] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
            dependencies.postconditionVerifier,
            dependencies.postconditionVerifierRuntimeCodeHash,
            dependencies.verifierBindingHash
        );
        reservations[30] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
            dependencies.planModule,
            dependencies.planModuleRuntimeCodeHash,
            dependencies.planModuleBindingHash
        );
        reservations[31] = _componentReservation(
            IProgrammableUniversalLaunchKernelV1.ReservationScope.SharedInfrastructure,
            dependencies.permitAuthority,
            dependencies.permitAuthorityRuntimeCodeHash,
            dependencies.permitAuthorityBindingHash
        );
    }

    function buildLaunchRegistrationV2(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        bytes32 permitDigest,
        uint64 registryGeneration,
        bytes32 approvedRepositoryHeadHash,
        bytes32 executableArtifactSourceHash,
        bytes32 exactContractBindingHash,
        IProgrammableHookemonLaunchRegistryV1.HookemonGraphV1 calldata graph
    ) external view returns (IProgrammableHookemonLaunchRegistryV1.LaunchRegistrationV1 memory registration) {
        IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory commitments =
            _planCommitments(plan);
        if (
            permit.chainId != block.chainid || permit.githubRepositoryId != plan.hookemon.githubRepositoryId
                || permit.repositoryKey != plan.hookemon.repositoryKey
                || permit.applicantWallet != plan.hookemon.applicantWallet
                || permit.configurationHash != commitments.configurationHash
                || permit.executionPlanHash != commitments.planHash
                || permit.executionCoreHash != _executionCoreHash(plan)
                || permit.presentationBindingHash != plan.hookemon.presentationBindingHash
                || permit.approvalId == bytes32(0) || permit.technicalApprovalHash == bytes32(0)
                || permit.descriptorHash == bytes32(0) || permit.releaseBindingHash == bytes32(0)
                || permit.executionCalldataKeccak256 == bytes32(0) || permitDigest == bytes32(0)
        ) revert InvalidField(9);
        registration.schemaVersion = 1;
        registration.chainId = block.chainid;
        registration.registryGeneration = registryGeneration;
        registration.approvalGeneration = permit.approvalGeneration;
        registration.permitGeneration = permit.permitGeneration;
        registration.permitNonce = permit.nonce;
        registration.permitDigest = permitDigest;
        registration.routeId = permit.routeId;
        registration.profileId = PROFILE_ID_HOOKEMON_V2;
        registration.technicalApproval = IProgrammableHookemonLaunchRegistryV1.TechnicalApprovalV1({
            githubRepositoryId: permit.githubRepositoryId,
            repositoryKey: permit.repositoryKey,
            approvalId: permit.approvalId,
            technicalApprovalHash: permit.technicalApprovalHash,
            approvedRepositoryHeadHash: approvedRepositoryHeadHash,
            executableArtifactSourceHash: executableArtifactSourceHash,
            exactContractBindingHash: exactContractBindingHash
        });
        registration.launchIdentity = IProgrammableHookemonLaunchRegistryV1.JitLaunchIdentityV1({
            launchId: permit.launchId,
            applicantWallet: permit.applicantWallet,
            descriptorHash: permit.descriptorHash,
            tokenNameHash: plan.hookemon.tokenNameHash,
            tokenSymbolHash: plan.hookemon.tokenSymbolHash,
            presentationBindingHash: permit.presentationBindingHash,
            configurationHash: permit.configurationHash,
            executionPlanHash: permit.executionPlanHash,
            executionCoreHash: permit.executionCoreHash,
            executionCalldataKeccak256: permit.executionCalldataKeccak256,
            releaseBindingHash: permit.releaseBindingHash
        });
        registration.graph = graph;
    }

    function _validateIdentityAndAction(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan,
        address expectedPermitAuthority,
        address predictedExecutor,
        address predictedLauncher
    ) private pure {
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 calldata hookemon = plan.hookemon;
        bytes32 canonicalSalt = keccak256(
            abi.encode(
                EXECUTOR_SALT_TYPEHASH, hookemon.repositoryKey, hookemon.sourceLaunchId, hookemon.applicantWallet
            )
        );
        if (
            plan.schemaVersion != PLAN_SCHEMA_VERSION || hookemon.schemaVersion != INNER_PLAN_SCHEMA_VERSION
                || hookemon.applicantWallet == address(0) || hookemon.sourceLaunchId == bytes32(0)
                || hookemon.githubRepositoryId != GITHUB_REPOSITORY_ID
                || hookemon.repositoryKey != SOURCE_REPOSITORY_KEY
                || hookemon.repositoryLineageRegistry != expectedPermitAuthority
                || hookemon.presentationBindingHash == bytes32(0) || hookemon.tokenNameHash == bytes32(0)
                || hookemon.tokenSymbolHash == bytes32(0) || plan.executorSalt != canonicalSalt
                || plan.expectedExecutor != predictedExecutor || hookemon.exclusive.accounts[0] != predictedLauncher
                || hookemon.completeInitCodeHash == bytes32(0) || hookemon.poolManagerRuntimeCodeHash == bytes32(0)
                || hookemon.canonicalPoolId == bytes32(0) || hookemon.expectedPositionTokenId == 0
                || hookemon.expectedLaunchConfigHash == bytes32(0) || hookemon.expectedLaunchId == bytes32(0)
                || hookemon.expectedLaunchHash == bytes32(0) || hookemon.expectedArchitectureStateHash == bytes32(0)
                || hookemon.expectedPoolStateHash == bytes32(0) || hookemon.expectedRevenueStateHash == bytes32(0)
        ) revert InvalidField(3);
    }

    function _validateConfiguration(IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 calldata plan)
        private
        pure
    {
        IProgrammableExactHookemonNormalCreateProfileV1.LaunchConfigV1 calldata config = plan.config;
        if (
            config.poolManager == address(0) || config.positionManager == address(0) || config.usdc == address(0)
                || config.tokenMessengerV2 == address(0) || config.messageTransmitterV2 == address(0)
                || config.fundingWallet == address(0) || config.approvedMultisig == address(0)
                || config.executor == address(0) || config.artifactAuthorizer == address(0)
                || config.solanaUsdcAta == bytes32(0) || config.solanaUsdcMint == bytes32(0)
                || config.solanaReturnAuthority == bytes32(0) || config.solanaTokenMessenger == bytes32(0)
                || config.solanaDomain != 5 || config.outboundProtocolFeeCapBps != 1
                || config.outboundForwardFeeCapMicroUsdc != 2_000_000 || config.scheduleAnchor == 0
                || config.positionUnlockAt != config.scheduleAnchor + 2 * 365 days || config.launcherMode != 2
                || config.poolFee != 3000 || config.tickSpacing != 60 || config.tickLower != -887_220
                || config.tickUpper != 887_220 || config.initialSqrtPriceX96 == 0 || config.liquidityUsdcAmount == 0
                || config.cycleBootstrapUsdcAmount == 0 || config.expectedPositionLiquidity == 0
                || config.distributorFactory != plan.shared.accounts[2]
                || config.outboundBridgeFactory != plan.shared.accounts[3]
                || config.returnAdapterFactory != plan.shared.accounts[4]
                || config.cycleVaultFactory != plan.shared.accounts[5]
                || config.treasuryVestingFactory != plan.shared.accounts[6]
                || config.positionTimelockFactory != plan.shared.accounts[7]
        ) revert InvalidField(4);
    }

    function _validateComponents(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure {
        if (plan.expectedExecutor == address(0)) revert ComponentCollision(plan.expectedExecutor);
        for (uint256 i; i < 9; ++i) {
            address account = plan.hookemon.exclusive.accounts[i];
            if (account == address(0) || plan.hookemon.exclusive.runtimeCodeHashes[i] == bytes32(0)) {
                revert InvalidField(5);
            }
            if (account == plan.expectedExecutor) revert ComponentCollision(account);
            for (uint256 j; j < i; ++j) {
                if (plan.hookemon.exclusive.accounts[j] == account) revert ComponentCollision(account);
            }
        }
        for (uint256 i; i < 14; ++i) {
            address account = plan.hookemon.shared.accounts[i];
            if (account == address(0) || plan.hookemon.shared.runtimeCodeHashes[i] == bytes32(0)) {
                revert InvalidField(6);
            }
            if (account == plan.expectedExecutor) revert ComponentCollision(account);
            for (uint256 j; j < 9; ++j) {
                if (plan.hookemon.exclusive.accounts[j] == account) revert ComponentCollision(account);
            }
            for (uint256 j; j < i; ++j) {
                if (plan.hookemon.shared.accounts[j] == account) revert ComponentCollision(account);
            }
        }
    }

    function _planCommitments(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    )
        private
        pure
        returns (IProgrammableExactHookemonReusableNormalCreateProfileV2.PlanCommitmentsV2 memory commitments)
    {
        bytes32 exclusiveHead =
            keccak256(abi.encode(plan.hookemon.exclusive.accounts, plan.hookemon.exclusive.runtimeCodeHashes));
        bytes32 sharedHead =
            keccak256(abi.encode(plan.hookemon.shared.accounts, plan.hookemon.shared.runtimeCodeHashes));
        bytes32 executorRuntimeHash = keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).runtimeCode);
        commitments.componentGraphHash = keccak256(
            abi.encode(
                GRAPH_TYPEHASH,
                plan.expectedExecutor,
                executorRuntimeHash,
                exclusiveHead,
                sharedHead,
                plan.hookemon.config.poolManager,
                plan.hookemon.poolManagerRuntimeCodeHash,
                plan.hookemon.canonicalPoolId
            )
        );
        commitments.componentSetHash = keccak256(
            abi.encode(
                plan.expectedExecutor,
                plan.hookemon.exclusive.accounts,
                plan.hookemon.shared.accounts,
                plan.hookemon.canonicalPoolId
            )
        );
        commitments.componentRuntimeSetHash = keccak256(
            abi.encode(
                executorRuntimeHash,
                plan.hookemon.exclusive.runtimeCodeHashes,
                plan.hookemon.shared.runtimeCodeHashes,
                plan.hookemon.poolManagerRuntimeCodeHash
            )
        );
        commitments.configurationHash = _configurationHash(plan);
        commitments.valueFlowHash = _valueFlowHash(plan);
        commitments.planHash = keccak256(
            abi.encode(
                PLAN_TYPEHASH,
                _sourceIdentityHash(plan),
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

    function _sourceIdentityHash(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SOURCE_IDENTITY_TYPEHASH,
                plan.schemaVersion,
                plan.hookemon.applicantWallet,
                plan.hookemon.sourceLaunchId,
                plan.hookemon.githubRepositoryId,
                plan.hookemon.repositoryKey,
                plan.hookemon.repositoryLineageRegistry,
                plan.hookemon.presentationBindingHash
            )
        );
    }

    function _actionHash(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                plan.expectedExecutor,
                plan.executorSalt,
                plan.hookemon.exclusive.accounts[0],
                plan.hookemon.completeInitCodeHash,
                plan.hookemon.exclusive.runtimeCodeHashes[0],
                plan.hookemon.config.poolManager,
                plan.hookemon.poolManagerRuntimeCodeHash,
                plan.hookemon.canonicalPoolId,
                plan.hookemon.expectedPositionTokenId,
                plan.hookemon.expectedLaunchConfigHash,
                plan.hookemon.expectedLaunchId,
                plan.hookemon.expectedLaunchHash
            )
        );
    }

    function _configurationHash(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure returns (bytes32) {
        bytes32 routeHead = keccak256(
            abi.encode(
                plan.executorSalt,
                plan.expectedExecutor,
                plan.hookemon.exclusive.accounts[0],
                plan.hookemon.githubRepositoryId,
                plan.hookemon.repositoryKey,
                plan.hookemon.repositoryLineageRegistry,
                plan.hookemon.presentationBindingHash
            )
        );
        bytes32 launcherHead = keccak256(
            abi.encode(
                plan.hookemon.tokenNameHash,
                plan.hookemon.tokenSymbolHash,
                keccak256(abi.encode(plan.hookemon.config)),
                plan.hookemon.completeInitCodeHash,
                plan.hookemon.expectedLaunchConfigHash,
                plan.hookemon.expectedLaunchId,
                plan.hookemon.expectedLaunchHash
            )
        );
        return keccak256(abi.encode(CONFIGURATION_TYPEHASH, routeHead, launcherHead));
    }

    function _valueFlowHash(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure returns (bytes32) {
        uint256 exactApproval = plan.hookemon.config.liquidityUsdcAmount + plan.hookemon.config.cycleBootstrapUsdcAmount;
        return keccak256(
            abi.encode(
                VALUE_FLOW_TYPEHASH,
                plan.hookemon.config.fundingWallet,
                plan.hookemon.config.usdc,
                plan.hookemon.exclusive.accounts[0],
                plan.hookemon.config.liquidityUsdcAmount,
                plan.hookemon.config.cycleBootstrapUsdcAmount,
                exactApproval,
                uint256(0)
            )
        );
    }

    function _expectedStateHash(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXPECTED_STATE_TYPEHASH,
                plan.hookemon.expectedArchitectureStateHash,
                plan.hookemon.expectedPoolStateHash,
                plan.hookemon.expectedRevenueStateHash
            )
        );
    }

    function _executionCoreHash(
        IProgrammableExactHookemonReusableNormalCreateProfileV2.ExactHookemonReusablePlanV2 calldata plan
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXECUTION_CORE_TYPEHASH,
                keccak256(abi.encode(plan)),
                keccak256(abi.encode(plan.hookemon.config)),
                plan.expectedExecutor,
                plan.hookemon.exclusive.accounts[0],
                plan.hookemon.completeInitCodeHash,
                uint256(0)
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

    function _requireRuntime(address account, bytes32 expectedCodeHash) private view {
        if (
            account == address(0) || expectedCodeHash == bytes32(0) || account.code.length == 0
                || account.codehash != expectedCodeHash
        ) revert RuntimeCodeHashDrift(account);
    }
}

interface IExactHookemonReusableApprovalAssetPlanModuleV2 {
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IAccessControlViewHookemonV2 {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

interface IExactHookemonPostconditionVerifierPlanModuleV2 {
    function verifyExactHookemonPostconditionsV2(
        address launcher,
        bytes32 launcherRuntimeCodeHash,
        bytes32 expectedTokenNameHash,
        bytes32 expectedTokenSymbolHash
    ) external view returns (bytes32 architectureStateHash, bytes32 poolStateHash, bytes32 revenueStateHash);
}
