// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";

import { ProgrammableExactShardsAtomicLaunchRouteV1 } from "../src/ProgrammableExactShardsAtomicLaunchRouteV1.sol";
import { ProgrammableExactShardsFeePolicyVerifierV2 } from "../src/ProgrammableExactShardsFeePolicyVerifierV2.sol";
import {
    ProgrammableExactShardsPairDeploymentCoordinatorV1
} from "../src/ProgrammableExactShardsPairDeploymentCoordinatorV1.sol";
import { ProgrammableExactShardsRegistryV1 } from "../src/ProgrammableExactShardsRegistryV1.sol";
import { ProgrammableExactShardsRouteGatedFactoryV2 } from "../src/ProgrammableExactShardsRouteGatedFactoryV2.sol";
import { ProgrammableLaunchPermitAuthorityV1 } from "../src/ProgrammableLaunchPermitAuthorityV1.sol";
import { ProgrammableLaunchPermitVerifierV1 } from "../src/ProgrammableLaunchPermitVerifierV1.sol";
import { IProgrammableCustomRegistryV1 } from "../src/interfaces/IProgrammableCustomRegistryV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import { IProgrammableExactShardsLaunchFactoryV1 } from "../src/interfaces/IProgrammableExactShardsLaunchFactoryV1.sol";
import {
    IProgrammableExactShardsRouteGatedFactoryV2
} from "../src/interfaces/IProgrammableExactShardsRouteGatedFactoryV2.sol";
import { IProgrammableExactShardsRegistryV1 } from "../src/interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "../src/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { ProgrammableExactShardsBindingHarnessV1 } from "./utils/ProgrammableExactShardsBindingHarnessV1.sol";
import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "shards-v1/src/ShardLaunchFactoryV1.sol";
import { ShardNFTV1 } from "shards-v1/src/ShardNFTV1.sol";
import { ShardTokenV1 } from "shards-v1/src/ShardTokenV1.sol";

/// @notice Proves that the stable repository-lineage authority remains global when two independently deployed,
///         otherwise-valid Shards release stacks race the same GitHub repository.
contract ProgrammableExactShardsCrossRouteRealGraphE2EV1Test is Test {
    struct StackV1 {
        ProgrammableExactShardsRegistryV1 registry;
        ProgrammableExactShardsRouteGatedFactoryV2 factory;
        ProgrammableExactShardsAtomicLaunchRouteV1 route;
        ProgrammableExactShardsBindingHarnessV1 bindings;
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 releaseBinding;
    }

    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant SIGNER_GOVERNOR = address(0x1001);
    address private constant RELEASE_GOVERNOR = address(0x1002);
    address private constant PAUSER = address(0x1003);
    address private constant CANCELLER = address(0x1004);
    address private constant APPROVER = address(0x2001);
    address private constant INTENT_APPROVER = address(0x2005);
    address private constant FINALIZER = address(0x2002);
    address private constant REVOKER = address(0x2004);
    address private constant LAUNCHER = address(0x51A4D5);
    uint64 private constant REPOSITORY_ID = 1_329_073_878;
    uint160 private constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 private constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    uint256 private constant EIP_7825_TRANSACTION_GAS_LIMIT_CAP = 1 << 24;
    uint256 private constant EIP_7934_MAX_RLP_BLOCK_SIZE = 8 * 1024 * 1024;

    ProgrammableLaunchPermitAuthorityV1 private authority;
    ProgrammableExactShardsFeePolicyVerifierV2 private feeVerifier;
    ShardLaunchFactoryV1 private implementation;
    StackV1 private winnerStack;
    StackV1 private loserStack;
    IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 private emptyKernel;
    bytes private losingExecutionEncoded;
    bytes private winningExecutionEncoded;
    IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 private losingPredictionState;
    IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 private winningPredictionState;
    bytes32 private losingCanonicalRuntimeCodeSetHash;
    bytes32 private losingDurableApprovalBinding;
    bytes32 private winningPermitDigest;
    address private miningFactory;
    bytes private measurementExecutionEncoded;
    bytes private measurementEnvelopeEncoded;
    uint256 public measuredBrowserLaunchCalldataBytes;
    uint256 public measuredBrowserLaunchExecutionGas;
    uint256 public measuredBrowserLaunchIntrinsicGas;
    uint256 public measuredBrowserLaunchTotalGas;

    function setUp() public {
        vm.chainId(1);
        vm.roll(100);
        vm.warp(1_800_000_000);

        ProgrammableLaunchPermitVerifierV1 permitVerifier = new ProgrammableLaunchPermitVerifierV1();
        authority = new ProgrammableLaunchPermitAuthorityV1(
            1,
            address(this),
            SIGNER_GOVERNOR,
            RELEASE_GOVERNOR,
            PAUSER,
            CANCELLER,
            vm.addr(SIGNER_KEY),
            900,
            permitVerifier,
            address(permitVerifier).codehash
        );
        feeVerifier = new ProgrammableExactShardsFeePolicyVerifierV2();
        IPoolManager manager = IPoolManager(address(new PoolManager(address(this))));
        implementation = new ShardLaunchFactoryV1(manager, keccak256(type(ShardHookV1).creationCode));

        winnerStack = _deployStack(3);
        loserStack = _deployStack(4);
        assertEq(winnerStack.factory.IMPLEMENTATION(), address(implementation));
        assertEq(loserStack.factory.IMPLEMENTATION(), address(implementation));

        authority.grantRole(authority.CONSUMER_ROLE(), address(winnerStack.route));
        authority.grantRole(authority.CONSUMER_ROLE(), address(loserStack.route));
        winnerStack.releaseBinding = _release(winnerStack, 1);
        loserStack.releaseBinding = _release(loserStack, 2);
        vm.startPrank(RELEASE_GOVERNOR);
        authority.activateReleaseBinding(winnerStack.releaseBinding);
        authority.activateReleaseBinding(loserStack.releaseBinding);
        vm.stopPrank();

        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory measurementExecution =
            _execution(winnerStack, "browser-measurement", "Measured Shard", "MEAS");
        _authorizeTechnical(winnerStack, measurementExecution.registration);
        _authorizeIntent(
            winnerStack,
            measurementExecution.registration,
            uint64(block.number),
            keccak256("browser-measurement-intent")
        );
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory measurementEnvelope,) =
            _permit(winnerStack, measurementExecution, 77);
        measurementExecutionEncoded = abi.encode(measurementExecution);
        measurementEnvelopeEncoded = abi.encode(measurementEnvelope);
    }

    function test_twoRealReleaseStacksCanProduceOnlyOneGraphForOneRepositoryLineage() public {
        vm.roll(block.number + 1);
        _attemptLoserAndAssertAtomicRollback();
        _launchWinnerAndAssertExclusiveSurvival();
        _retryLoserAndAssertRepositoryOnce();
    }

    function test_measureFreshBrowserWalletLaunchCalldataAndGas() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            abi.decode(measurementExecutionEncoded, (ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1));
        ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope =
            abi.decode(measurementEnvelopeEncoded, (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1));
        (address hook, address shard, address nft) = _measuredBrowserLaunch(envelope, execution);
        assertEq(hook, execution.registration.orderedFeeLegs[2].recipient);
        assertEq(shard, execution.registration.primaryContract);
        assertGt(nft.code.length, 0);
    }

    function _attemptLoserAndAssertAtomicRollback() private {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory losingExecution =
            _execution(loserStack, "cross-route-loser", "Losing Shard", "LOSE");
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory losingPrediction =
            _prediction(loserStack, losingExecution);
        losingCanonicalRuntimeCodeSetHash = losingExecution.registration.runtimeCodeSetHash;
        losingDurableApprovalBinding = losingExecution.registration.approvalBindingHash;

        // The bad runtime-set commitment fails only after the shared Authority has consumed and the exact upstream
        // implementation has deployed the complete graph through Stack B. The outer revert must erase all of it.
        losingExecution.registration.runtimeCodeSetHash = keccak256("cross-route-deliberate-runtime-mismatch");
        _rebindRecord(loserStack, losingExecution.registration);
        assertEq(losingExecution.registration.approvalBindingHash, losingDurableApprovalBinding);
        _authorizeTechnical(loserStack, losingExecution.registration);
        _authorizeIntent(
            loserStack, losingExecution.registration, uint64(block.number), keccak256("loser-first-intent")
        );
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory failingEnvelope, bytes32 failingDigest) =
            _permit(loserStack, losingExecution, 1);

        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.PermitBindingMismatch.selector);
        vm.recordLogs();
        vm.prank(LAUNCHER);
        loserStack.route.launch(failingEnvelope, losingExecution);
        Vm.Log[] memory revertedLogs = vm.getRecordedLogs();
        _assertNoLoserOriginOrCompletionLogs(revertedLogs);
        _assertLoserAbsent(losingExecution, losingPrediction, failingDigest, 0);
        _assertFactoryBypassesClosed(losingExecution, losingPrediction);

        losingExecutionEncoded = abi.encode(losingExecution);
        losingPredictionState = losingPrediction;
    }

    function _launchWinnerAndAssertExclusiveSurvival() private {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory winningExecution =
            _execution(winnerStack, "cross-route-winner", "Winning Shard", "WIN");
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory winningPrediction =
            _prediction(winnerStack, winningExecution);
        assertEq(
            winnerStack.registry.approvalState(winningExecution.registration.approvalId).approvalBindingHash,
            winningExecution.registration.approvalBindingHash
        );
        _authorizeIntent(
            winnerStack, winningExecution.registration, uint64(block.number + 100), keccak256("winner-intent")
        );
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory winningEnvelope, bytes32 winningDigest) =
            _permit(winnerStack, winningExecution, 1);

        vm.prank(LAUNCHER);
        (address winningHook, address winningShard, address winningNft) =
            winnerStack.route.launch(winningEnvelope, winningExecution);
        assertEq(winningHook, winningPrediction.hook);
        assertEq(winningShard, winningPrediction.shard);
        assertEq(winningNft, winningPrediction.nft);
        winningExecutionEncoded = abi.encode(winningExecution);
        winningPredictionState = winningPrediction;
        winningPermitDigest = winningDigest;
        _assertWinnerStillCanonical(winningExecution, winningPrediction, winningDigest);
        _assertLoserAbsent(_decodeLosingExecution(), losingPredictionState, bytes32(0), 1);
    }

    function _retryLoserAndAssertRepositoryOnce() private {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory losingExecution = _decodeLosingExecution();
        // Restore Stack B to a fully valid execution and issue a fresh permit at the now-current nonce. The global
        // repository-once record, not a stale nonce or the earlier deliberate mismatch, must reject this retry.
        vm.roll(block.number + 1);
        losingExecution.registration.runtimeCodeSetHash = losingCanonicalRuntimeCodeSetHash;
        _rebindRecord(loserStack, losingExecution.registration);
        assertEq(losingExecution.registration.approvalBindingHash, losingDurableApprovalBinding);
        _authorizeIntent(
            loserStack, losingExecution.registration, uint64(block.number + 100), keccak256("loser-retry-intent")
        );
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory retryEnvelope, bytes32 retryDigest) =
            _permit(loserStack, losingExecution, 2);
        assertEq(retryEnvelope.permit.nonce, 1);

        vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.RepositoryAlreadyConsumed.selector);
        vm.recordLogs();
        vm.prank(LAUNCHER);
        loserStack.route.launch(retryEnvelope, losingExecution);
        Vm.Log[] memory revertedLogs = vm.getRecordedLogs();
        _assertNoLoserOriginOrCompletionLogs(revertedLogs);

        _assertLoserAbsent(losingExecution, losingPredictionState, retryDigest, 1);
        _assertWinnerStillCanonical(_decodeWinningExecution(), winningPredictionState, winningPermitDigest);
    }

    function _decodeLosingExecution()
        private
        view
        returns (ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory)
    {
        return abi.decode(losingExecutionEncoded, (ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1));
    }

    function _decodeWinningExecution()
        private
        view
        returns (ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory)
    {
        return abi.decode(winningExecutionEncoded, (ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1));
    }

    function _deployStack(uint64 registryGeneration) private returns (StackV1 memory stack) {
        uint64 registryNonce = vm.getNonce(address(this));
        address predictedCoordinator = vm.computeCreateAddress(address(this), registryNonce + 1);
        address predictedRoute = vm.computeCreateAddress(predictedCoordinator, 2);
        stack.registry = _deployRegistry(predictedRoute, registryGeneration);
        ProgrammableExactShardsPairDeploymentCoordinatorV1 coordinator = new ProgrammableExactShardsPairDeploymentCoordinatorV1(
            authority, stack.registry, address(implementation), address(implementation).codehash
        );
        stack.factory = ProgrammableExactShardsRouteGatedFactoryV2(payable(coordinator.factory()));
        stack.route = ProgrammableExactShardsAtomicLaunchRouteV1(coordinator.route());
        stack.bindings = new ProgrammableExactShardsBindingHarnessV1(stack.registry, feeVerifier, authority);
        assertEq(address(stack.route), predictedRoute);
    }

    function _execution(StackV1 storage stack, string memory label, string memory name, string memory symbol)
        private
        returns (ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution)
    {
        execution.tokenSalt = keccak256(abi.encode("exact-shards-token-salt", label));
        execution.hookCreationCode = type(ShardHookV1).creationCode;
        execution.params = IProgrammableExactShardsLaunchFactoryV1.LaunchParams({
            tickLower: TickMath.minUsableTick(60),
            tickBand: 22_980,
            tickUpper: 115_080,
            startSqrtPriceX96: TickMath.getSqrtPriceAtTick(115_080),
            renderer: address(0),
            tokenName: name,
            tokenSymbol: symbol,
            nftName: string.concat(name, " Pieces"),
            nftSymbol: string.concat(symbol, "N")
        });
        miningFactory = address(stack.factory);
        execution.hookSalt = _mineHookSalt(execution.tokenSalt, execution.hookCreationCode, execution.params);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = _prediction(stack, execution);
        (bytes32 shardRuntime, bytes32 hookRuntime, bytes32 nftRuntime) =
            _exactRuntimeHashes(stack, execution, prediction);
        execution.registration =
            _registration(stack, label, execution, prediction, shardRuntime, hookRuntime, nftRuntime);
    }

    function _registration(
        StackV1 storage stack,
        string memory label,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction,
        bytes32 shardRuntime,
        bytes32 hookRuntime,
        bytes32 nftRuntime
    ) private view returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) {
        registration.chainId = block.chainid;
        registration.registryGeneration = stack.registry.REGISTRY_GENERATION();
        registration.githubRepositoryId = REPOSITORY_ID;
        registration.approvalGeneration = 1;
        registration.commitId = bytes32(feeVerifier.REVIEWED_SOURCE_COMMIT());
        registration.sourceCommitment = feeVerifier.SOURCE_REVISION_HASH();
        registration.buildCommitment = feeVerifier.REVIEWED_TECHNICAL_BUILD_SHA256();
        registration.projectId = stack.bindings.computeProjectId(REPOSITORY_ID);
        registration.websiteProjectIdSha256 = sha256(abi.encode("website-project-id", label));
        registration.websiteLaunchIdSha256 = sha256(abi.encode("website-launch-id", label));
        registration.configurationHash = stack.route
            .computeTechnicalConfigurationHash(
                execution.hookCreationCode, execution.params, keccak256("programmable-finality-policy-v1")
            );
        registration.tokenNameHash = keccak256(bytes(execution.params.tokenName));
        registration.tokenSymbolHash = keccak256(bytes(execution.params.tokenSymbol));
        registration.presentationBindingHash = keccak256(abi.encode("presentation", label));
        registration.permissionsHash = keccak256("exact-shards-permissions-v1");
        registration.deploymentId = keccak256(abi.encode("deployment", label));
        registration.deploymentConfigurationHash = prediction.deploymentConfigurationHash;
        registration.primaryContract = prediction.shard;
        registration.primaryRuntimeCodeHash = shardRuntime;
        registration.launchWallet = LAUNCHER;
        registration.modelId = keccak256("programmable.exact-shards.v1");
        registration.modelVersion = keccak256("1");
        registration.templateId = keccak256("programmable.exact-shards.atomic-route.v1");
        registration.templateVersion = keccak256("1");
        registration.providerId = bytes32(0);
        registration.builderAttributionHash = keccak256("exact-shards-builder-attribution-v1");
        registration.originHash = keccak256("exact-shards-origin-v1");
        registration.assetSetHash = keccak256(abi.encode("assets", prediction.shard, prediction.hook, prediction.nft));
        registration.marketSetHash = keccak256(abi.encode("market", prediction.poolManager, prediction.hook));
        registration.marketPathId = feeVerifier.PROFILE_KEY();
        registration.capabilitySetHash = keccak256("exact-shards-capabilities-v1");
        registration.reviewPolicyHash = keccak256("programmable-shards-review-policy-v1");
        registration.securityReviewHash = keccak256("exact-shards-security-review-v1");
        registration.reviewResultId = keccak256("exact-shards-review-result-v1");
        registration.finalityPolicyHash = keccak256("programmable-finality-policy-v1");
        registration.artifactSetHash = stack.route
            .computeCanonicalArtifactSetHash(
                registration.sourceCommitment, registration.buildCommitment, execution.hookCreationCode
            );
        registration.deploymentSetHash = stack.route.computeCanonicalDeploymentSetHash(prediction);
        registration.runtimeCodeSetHash = stack.route
            .computePredictedRuntimeCodeSetHash(
                prediction.shard, shardRuntime, prediction.hook, hookRuntime, prediction.nft, nftRuntime
            );
        _feePolicy(registration, prediction.hook);
        (registration.approvalBindingHash,,,) = stack.bindings.computeBindings(registration);
        (registration.approvalId, registration.launchId) = stack.bindings
            .computeCanonicalTargetIds(
                registration.projectId, registration.approvalGeneration, registration.approvalBindingHash
            );
        _rebindRecord(stack, registration);
    }

    function _feePolicy(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration, address hook)
        private
        view
    {
        registration.feePolicy.profileKey = feeVerifier.PROFILE_KEY();
        registration.feePolicy.feeAsset = address(0);
        registration.feePolicy.feeBasisHash = feeVerifier.FEE_BASIS_HASH();
        registration.feePolicy.totalFeeBps = feeVerifier.TOTAL_FEE_BPS();
        registration.orderedFeeLegs[0] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: feeVerifier.BUILDER_ROLE_HASH(),
            feeBps: feeVerifier.BUILDER_FEE_BPS(),
            recipient: feeVerifier.INITIAL_BUILDER_RECIPIENT(),
            recipientModeHash: feeVerifier.BUILDER_RECIPIENT_MODE_HASH()
        });
        registration.orderedFeeLegs[1] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: feeVerifier.PROGRAMMABLE_ROLE_HASH(),
            feeBps: feeVerifier.PROGRAMMABLE_FEE_BPS(),
            recipient: feeVerifier.PROGRAMMABLE_RECIPIENT(),
            recipientModeHash: feeVerifier.PROGRAMMABLE_RECIPIENT_MODE_HASH()
        });
        registration.orderedFeeLegs[2] = IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1({
            roleHash: feeVerifier.HOLDER_ROLE_HASH(),
            feeBps: feeVerifier.HOLDER_FEE_BPS(),
            recipient: hook,
            recipientModeHash: feeVerifier.HOLDER_RECIPIENT_MODE_HASH()
        });
        registration.feePolicy.legsHash = keccak256(
            abi.encode(
                feeVerifier.hashLeg(registration.orderedFeeLegs[0]),
                feeVerifier.hashLeg(registration.orderedFeeLegs[1]),
                feeVerifier.hashLeg(registration.orderedFeeLegs[2])
            )
        );
    }

    function _rebindRecord(
        StackV1 storage stack,
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration
    ) private view {
        (bytes32 approvalBindingHash,, bytes32 reviewBinding,) = stack.bindings.computeBindings(registration);
        registration.approvalBindingHash = approvalBindingHash;
        registration.reviewDeploymentBindingHash = reviewBinding;
        (,,, bytes32 recordCommitment) = stack.bindings.computeBindings(registration);
        registration.registeredRecordCommitment = recordCommitment;
    }

    function _authorizeTechnical(
        StackV1 storage stack,
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration
    ) private {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory approval =
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: stack.registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registration.approvalBindingHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: type(uint64).max,
                evidenceHash: keccak256(abi.encode("durable-approval", registration.approvalId))
            });
        vm.prank(APPROVER);
        stack.registry.authorizeApproval(approval);
    }

    function _authorizeIntent(
        StackV1 storage stack,
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration,
        uint64 expiresAtBlock,
        bytes32 evidenceHash
    ) private {
        (, bytes32 intentBinding,,) = stack.bindings.computeBindings(registration);
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory intent =
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: stack.registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: intentBinding,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: expiresAtBlock,
                evidenceHash: evidenceHash
            });
        vm.prank(INTENT_APPROVER);
        stack.registry.authorizeLaunchIntent(intent);
    }

    function _permit(
        StackV1 storage stack,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        uint64 generation
    )
        private
        view
        returns (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 digest)
    {
        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit;
        permit.githubRepositoryId = REPOSITORY_ID;
        permit.approvalGeneration = execution.registration.approvalGeneration;
        permit.permitGeneration = generation;
        permit.notBefore = uint64(block.timestamp);
        permit.deadline = uint64(block.timestamp + 300);
        permit.signerEpoch = authority.currentSignerEpoch();
        permit.nonce = authority.nextNonce(repositoryKey);
        permit.chainId = block.chainid;
        permit.repositoryKey = repositoryKey;
        permit.route = address(stack.route);
        permit.routeId = stack.route.ROUTE_ID();
        permit.applicantWallet = LAUNCHER;
        permit.launchId = execution.registration.launchId;
        permit.approvalId = execution.registration.approvalId;
        permit.technicalApprovalHash = execution.registration.approvalBindingHash;
        permit.descriptorHash = keccak256(abi.encode("exact-shards-descriptor", execution.registration.commitId));
        permit.presentationBindingHash = execution.registration.presentationBindingHash;
        permit.configurationHash = execution.registration.configurationHash;
        permit.walletOwnershipBindingHash = keccak256(abi.encode("wallet", LAUNCHER));
        permit.executionPlanHash = keccak256(abi.encode("plan", execution.registration.registeredRecordCommitment));
        permit.executionCoreHash = stack.route
            .computeExecutionCoreHash(
                execution.registration,
                execution.tokenSalt,
                execution.hookSalt,
                execution.hookCreationCode,
                execution.params,
                0
            );
        permit.executionCalldataKeccak256 = stack.route
            .computeInnerExecutionCalldataKeccak256(
                execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
            );
        permit.releaseBindingHash = authority.computeReleaseBindingHash(stack.releaseBinding);
        permit.kernelExecutionEnvelopeHash = authority.computeKernelExecutionEnvelopeHash(emptyKernel);
        permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
        digest = authority.hashPermit(permit);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        envelope = ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1({
            permit: permit,
            releaseBinding: stack.releaseBinding,
            kernelEnvelope: emptyKernel,
            permitSignature: abi.encodePacked(r, s, v)
        });
    }

    function _release(StackV1 storage stack, uint64 releaseGeneration)
        private
        view
        returns (IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory binding)
    {
        binding = IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1({
            authorityGeneration: authority.AUTHORITY_GENERATION(),
            releaseGeneration: releaseGeneration,
            permitAuthority: address(authority),
            permitAuthorityRuntimeCodeHash: address(authority).codehash,
            launchRegistry: address(stack.registry),
            launchRegistryGeneration: stack.registry.REGISTRY_GENERATION(),
            launchRegistryRuntimeCodeHash: address(stack.registry).codehash,
            chainProfileHash: stack.registry.CHAIN_PROFILE_HASH(),
            profile: address(stack.route),
            profileId: stack.route.ROUTE_ID(),
            profileRuntimeCodeHash: address(stack.route).codehash,
            profileBindingHash: stack.route.permitProfileBindingHash(),
            route: address(stack.route),
            routeId: stack.route.ROUTE_ID(),
            routeRuntimeCodeHash: address(stack.route).codehash,
            executionAuthorityHash: stack.route.permitExecutionAuthorityHash(),
            kernelEnvelopeMode: IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE
        });
    }

    function _prediction(
        StackV1 storage stack,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution
    ) private view returns (IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory) {
        return stack.factory
            .predictLaunch(execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params);
    }

    function _exactRuntimeHashes(
        StackV1 storage stack,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction
    ) private returns (bytes32 shardRuntime, bytes32 hookRuntime, bytes32 nftRuntime) {
        uint256 snapshot = vm.snapshotState();
        vm.prank(address(stack.route));
        (address hook, address shard, address nft) =
            stack.factory.launch(execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params);
        assertEq(shard, prediction.shard);
        assertEq(hook, prediction.hook);
        assertEq(nft, prediction.nft);
        shardRuntime = shard.codehash;
        hookRuntime = hook.codehash;
        nftRuntime = nft.codehash;
        assertTrue(vm.revertToState(snapshot));
        assertEq(prediction.shard.code.length, 0);
        assertEq(prediction.hook.code.length, 0);
        assertEq(prediction.nft.code.length, 0);
    }

    function _mineHookSalt(
        bytes32 tokenSalt,
        bytes memory hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams memory params
    ) private view returns (bytes32 minedSalt) {
        address renderer = address(implementation.renderer());
        bytes32 tokenInitCodeHash = keccak256(
            bytes.concat(type(ShardTokenV1).creationCode, abi.encode(params.tokenName, params.tokenSymbol))
        );
        bytes32[11] memory words;
        words[0] = tokenSalt;
        words[2] = bytes32(uint256(int256(params.tickLower)));
        words[3] = bytes32(uint256(int256(params.tickBand)));
        words[4] = bytes32(uint256(int256(params.tickUpper)));
        words[5] = bytes32(uint256(params.startSqrtPriceX96));
        words[6] = bytes32(uint256(uint160(renderer)));
        words[7] = keccak256(bytes(params.tokenName));
        words[8] = keccak256(bytes(params.tokenSymbol));
        words[9] = keccak256(bytes(params.nftName));
        words[10] = keccak256(bytes(params.nftSymbol));
        bytes memory hookInitCode = bytes.concat(
            hookCreationCode,
            abi.encode(
                implementation.poolManager(),
                ShardTokenV1(address(0)),
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                miningFactory,
                implementation.launcherFeeRecipient(),
                implementation.builderFeeRecipient()
            )
        );
        uint256 shardWordOffset = hookCreationCode.length + 64;
        for (uint256 candidate;; ++candidate) {
            minedSalt = bytes32(candidate);
            words[1] = minedSalt;
            bytes32 effectiveSalt;
            assembly ("memory-safe") {
                effectiveSalt := keccak256(words, 0x160)
            }
            address shard = Create2.computeAddress(effectiveSalt, tokenInitCodeHash, miningFactory);
            assembly ("memory-safe") {
                mstore(add(hookInitCode, shardWordOffset), shard)
            }
            address hook = Create2.computeAddress(minedSalt, keccak256(hookInitCode), miningFactory);
            if (uint160(hook) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) return minedSalt;
        }
    }

    function _measuredBrowserLaunch(
        ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution
    ) private returns (address hook, address shard, address nft) {
        bytes memory transactionCalldata =
            abi.encodeCall(ProgrammableExactShardsAtomicLaunchRouteV1.launch, (envelope, execution));
        measuredBrowserLaunchCalldataBytes = transactionCalldata.length;
        assertLt(measuredBrowserLaunchCalldataBytes, EIP_7934_MAX_RLP_BLOCK_SIZE);
        (uint256 intrinsicGas, uint256 calldataTokens) = _transactionIntrinsicGas(transactionCalldata);
        measuredBrowserLaunchIntrinsicGas = intrinsicGas;

        vm.prank(LAUNCHER);
        uint256 gasBefore = gasleft();
        (hook, shard, nft) = winnerStack.route.launch(envelope, execution);
        measuredBrowserLaunchExecutionGas = gasBefore - gasleft();

        uint256 ordinaryTotal = measuredBrowserLaunchExecutionGas + measuredBrowserLaunchIntrinsicGas;
        uint256 calldataFloor = 21_000 + 10 * calldataTokens;
        measuredBrowserLaunchTotalGas = ordinaryTotal < calldataFloor ? calldataFloor : ordinaryTotal;
        assertLt(measuredBrowserLaunchTotalGas, EIP_7825_TRANSACTION_GAS_LIMIT_CAP);
        emit log_named_uint("browser launch calldata bytes", measuredBrowserLaunchCalldataBytes);
        emit log_named_uint("browser launch execution gas", measuredBrowserLaunchExecutionGas);
        emit log_named_uint("browser launch intrinsic gas", measuredBrowserLaunchIntrinsicGas);
        emit log_named_uint("browser launch total gas", measuredBrowserLaunchTotalGas);
        emit log_named_uint("EIP-7825 transaction gas cap", EIP_7825_TRANSACTION_GAS_LIMIT_CAP);
        emit log_named_uint("EIP-7934 max RLP block bytes", EIP_7934_MAX_RLP_BLOCK_SIZE);
    }

    function _transactionIntrinsicGas(bytes memory transactionCalldata)
        private
        pure
        returns (uint256 intrinsicGas, uint256 calldataTokens)
    {
        intrinsicGas = 21_000;
        for (uint256 i; i < transactionCalldata.length; ++i) {
            if (transactionCalldata[i] == bytes1(0)) {
                intrinsicGas += 4;
                calldataTokens += 1;
            } else {
                intrinsicGas += 16;
                calldataTokens += 4;
            }
        }
    }

    function _assertFactoryBypassesClosed(
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory losingExecution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory losingPrediction
    ) private {
        vm.expectPartialRevert(ProgrammableExactShardsRouteGatedFactoryV2.UnauthorizedLaunchCaller.selector);
        vm.prank(LAUNCHER);
        loserStack.factory
            .launch(
                losingExecution.tokenSalt,
                losingExecution.hookSalt,
                losingExecution.hookCreationCode,
                losingExecution.params
            );

        vm.expectPartialRevert(ProgrammableExactShardsRouteGatedFactoryV2.UnauthorizedLaunchCaller.selector);
        vm.prank(address(winnerStack.route));
        loserStack.factory
            .launch(
                losingExecution.tokenSalt,
                losingExecution.hookSalt,
                losingExecution.hookCreationCode,
                losingExecution.params
            );

        assertEq(losingPrediction.shard.code.length, 0);
        assertEq(losingPrediction.hook.code.length, 0);
        assertEq(losingPrediction.nft.code.length, 0);
        assertEq(loserStack.factory.configurationHashOf(losingPrediction.hook), bytes32(0));
    }

    function _assertNoLoserOriginOrCompletionLogs(Vm.Log[] memory revertedTraceLogs) private view {
        // Foundry's debug recorder exposes inner logs even when their surrounding call reverts. Such logs are not
        // present in an Ethereum receipt. The durable origin/completion events are later than every deliberate
        // failure in this test, so they must not even appear in that raw trace.
        for (uint256 i; i < revertedTraceLogs.length; ++i) {
            assertTrue(revertedTraceLogs[i].emitter != address(loserStack.registry));
            assertTrue(revertedTraceLogs[i].emitter != address(loserStack.route));
        }
    }

    function _assertLoserAbsent(
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory losingExecution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory losingPrediction,
        bytes32 permitDigest,
        uint256 expectedNonce
    ) private view {
        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        assertEq(authority.nextNonce(repositoryKey), expectedNonce);
        assertEq(
            uint8(authority.permitStatus(permitDigest).state),
            uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.UNSEEN)
        );
        assertEq(loserStack.registry.registrationCount(), 0);
        assertEq(
            uint8(loserStack.registry.launchState(losingExecution.registration.launchId).status),
            uint8(IProgrammableCustomRegistryV1.LaunchStatus.None)
        );
        assertFalse(loserStack.registry.approvalState(losingExecution.registration.approvalId).consumed);
        assertEq(
            loserStack.registry.publicIdentityState(losingExecution.registration.launchId).identityMappingHash,
            bytes32(0)
        );
        assertEq(loserStack.registry.recordHashAtRevision(losingExecution.registration.launchId, 1), bytes32(0));
        assertEq(loserStack.registry.launchDetails(losingExecution.registration.launchId).primaryContract, address(0));
        assertEq(loserStack.registry.feePolicyState(losingExecution.registration.launchId).policyHash, bytes32(0));
        assertEq(loserStack.registry.feeClaim(losingExecution.registration.launchId, 0).storedClaimHash, bytes32(0));
        assertEq(losingPrediction.shard.code.length, 0);
        assertEq(losingPrediction.hook.code.length, 0);
        assertEq(losingPrediction.nft.code.length, 0);
        assertEq(loserStack.factory.configurationHashOf(losingPrediction.hook), bytes32(0));
    }

    function _assertWinnerStillCanonical(
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory winningExecution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory winningPrediction,
        bytes32 winningDigest
    ) private view {
        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        IProgrammableLaunchPermitAuthorityV1.RepositoryConsumptionV1 memory consumption =
            authority.repositoryConsumption(repositoryKey);
        assertTrue(authority.repositoryConsumed(repositoryKey));
        assertEq(authority.consumptionCount(), 1);
        assertEq(authority.nextNonce(repositoryKey), 1);
        assertEq(consumption.permitDigest, winningDigest);
        assertEq(consumption.launchId, winningExecution.registration.launchId);
        assertEq(consumption.route, address(winnerStack.route));
        assertEq(
            uint8(authority.permitStatus(winningDigest).state),
            uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.CONSUMED)
        );
        assertEq(winnerStack.registry.registrationCount(), 1);
        assertEq(
            uint8(winnerStack.registry.launchState(winningExecution.registration.launchId).status),
            uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed)
        );
        assertEq(winningPrediction.shard.codehash, winningExecution.registration.primaryRuntimeCodeHash);
        assertGt(winningPrediction.hook.code.length, 0);
        assertGt(winningPrediction.nft.code.length, 0);
        assertEq(
            winnerStack.factory.configurationHashOf(winningPrediction.hook),
            winningExecution.registration.deploymentConfigurationHash
        );
        assertEq(ShardTokenV1(winningPrediction.shard).name(), "Winning Shard");
        assertEq(ShardTokenV1(winningPrediction.shard).symbol(), "WIN");
        assertEq(ShardNFTV1(winningPrediction.nft).name(), "Winning Shard Pieces");
        assertEq(ShardNFTV1(winningPrediction.nft).symbol(), "WINN");
        ShardHookV1 winningHook = ShardHookV1(payable(winningPrediction.hook));
        assertTrue(winningHook.initialised());
        assertEq(winningHook.deployer(), address(winnerStack.factory));
        assertEq(address(winningHook.shard()), winningPrediction.shard);
        assertEq(address(winningHook.nft()), winningPrediction.nft);
        assertEq(ShardNFTV1(winningPrediction.nft).hook(), winningPrediction.hook);
        assertGt(winningHook.seedLiquidity(), 0);
        assertGt(winningHook.seedLiquidityBand(), 0);
        assertEq(ShardTokenV1(winningPrediction.shard).balanceOf(winningPrediction.hook), winningHook.seedDust());
        assertEq(ShardTokenV1(winningPrediction.shard).balanceOf(address(winnerStack.factory)), 0);
        assertEq(ShardNFTV1(winningPrediction.nft).circulatingSupply(), 0);
    }

    function _deployRegistry(address exactRoute, uint64 registryGeneration)
        private
        returns (ProgrammableExactShardsRegistryV1)
    {
        return new ProgrammableExactShardsRegistryV1(
            ProgrammableExactShardsRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: APPROVER,
                initialLaunchIntentApprover: INTENT_APPROVER,
                initialWriter: exactRoute,
                initialFinalizer: FINALIZER,
                initialRevoker: REVOKER,
                registryGeneration: registryGeneration,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile"),
                registryPolicyHash: keccak256("exact-shards-registry-policy")
            }),
            feeVerifier,
            authority
        );
    }
}
