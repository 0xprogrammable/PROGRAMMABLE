// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
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

contract ExactShardsUnreviewedRendererV1 { }

contract ProgrammableExactShardsRealGraphE2EV1Test is Test {
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

    ProgrammableLaunchPermitAuthorityV1 private authority;
    ProgrammableExactShardsFeePolicyVerifierV2 private feeVerifier;
    ProgrammableExactShardsRegistryV1 private registry;
    ProgrammableExactShardsRouteGatedFactoryV2 private factory;
    ProgrammableExactShardsAtomicLaunchRouteV1 private route;
    ProgrammableExactShardsBindingHarnessV1 private bindings;
    ShardLaunchFactoryV1 private implementation;
    IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 private releaseBinding;
    IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 private emptyKernel;

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

        uint64 registryNonce = vm.getNonce(address(this));
        address predictedCoordinator = vm.computeCreateAddress(address(this), registryNonce + 1);
        address predictedRoute = vm.computeCreateAddress(predictedCoordinator, 2);
        registry = _deployRegistry(predictedRoute);
        ProgrammableExactShardsPairDeploymentCoordinatorV1 coordinator = new ProgrammableExactShardsPairDeploymentCoordinatorV1(
            authority, registry, address(implementation), address(implementation).codehash
        );
        factory = ProgrammableExactShardsRouteGatedFactoryV2(payable(coordinator.factory()));
        route = ProgrammableExactShardsAtomicLaunchRouteV1(coordinator.route());
        assertEq(address(route), predictedRoute);
        bindings = new ProgrammableExactShardsBindingHarnessV1(registry, feeVerifier, authority);

        authority.grantRole(authority.CONSUMER_ROLE(), address(route));
        releaseBinding = _release();
        vm.prank(RELEASE_GOVERNOR);
        authority.activateReleaseBinding(releaseBinding);
    }

    function test_realAuthorityRegistryCoordinatorAndReviewedFactoryLaunchOneExactGraph() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-success", "Website Shard", "WSHARD");
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("success-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 permitDigest) =
            _permit(execution, 1);

        vm.prank(LAUNCHER);
        (address hook, address shard, address nft) = route.launch(envelope, execution);

        assertEq(hook, execution.registration.orderedFeeLegs[2].recipient);
        assertEq(shard, execution.registration.primaryContract);
        assertEq(ShardTokenV1(shard).name(), "Website Shard");
        assertEq(ShardTokenV1(shard).symbol(), "WSHARD");
        assertEq(ShardNFTV1(nft).name(), "Website Shard Pieces");
        assertEq(ShardNFTV1(nft).symbol(), "WSHARDN");
        assertEq(factory.configurationHashOf(hook), execution.registration.deploymentConfigurationHash);
        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        assertTrue(authority.repositoryConsumed(repositoryKey));
        assertEq(authority.nextNonce(repositoryKey), 1);
        assertEq(
            uint8(authority.permitStatus(permitDigest).state),
            uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.CONSUMED)
        );
        assertEq(registry.registrationCount(), 1);
        assertEq(
            uint8(registry.launchState(execution.registration.launchId).status),
            uint8(IProgrammableCustomRegistryV1.LaunchStatus.Observed)
        );
        assertEq(registry.feeClaim(execution.registration.launchId, 2).initialRecipientOrAccumulator, hook);
    }

    function test_downstreamRuntimeSetFailureRollsBackPermitRepoFactoryGraphAndRegistryThenRetrySucceeds() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-rollback", "Rollback Shard", "ROLL");
        bytes32 canonicalRuntimeCodeSetHash = execution.registration.runtimeCodeSetHash;
        bytes32 durableApproval = execution.registration.approvalBindingHash;
        execution.registration.runtimeCodeSetHash = keccak256("deliberately-wrong-runtime-code-set");
        _rebindRecord(execution.registration);
        assertEq(execution.registration.approvalBindingHash, durableApproval);
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number), keccak256("rollback-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory failedEnvelope, bytes32 failedDigest) =
            _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = factory.predictLaunch(
            execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
        );

        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.PermitBindingMismatch.selector);
        vm.prank(LAUNCHER);
        route.launch(failedEnvelope, execution);

        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        assertFalse(authority.repositoryConsumed(repositoryKey));
        assertEq(authority.nextNonce(repositoryKey), 0);
        assertEq(
            uint8(authority.permitStatus(failedDigest).state),
            uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.UNSEEN)
        );
        assertEq(registry.registrationCount(), 0);
        assertEq(prediction.shard.code.length, 0);
        assertEq(prediction.hook.code.length, 0);
        assertEq(prediction.nft.code.length, 0);
        assertEq(factory.configurationHashOf(prediction.hook), bytes32(0));

        vm.roll(block.number + 1);
        execution.registration.runtimeCodeSetHash = canonicalRuntimeCodeSetHash;
        _rebindRecord(execution.registration);
        assertEq(execution.registration.approvalBindingHash, durableApproval);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("retry-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory retryEnvelope,) = _permit(execution, 2);
        vm.prank(LAUNCHER);
        (address hook, address shard, address nft) = route.launch(retryEnvelope, execution);

        assertEq(hook, prediction.hook);
        assertEq(shard, prediction.shard);
        assertEq(nft, prediction.nft);
        assertTrue(authority.repositoryConsumed(repositoryKey));
        assertEq(authority.nextNonce(repositoryKey), 1);
        assertEq(registry.registrationCount(), 1);
    }

    function test_postPermitPresentationNameOrSymbolSubstitutionFailsBeforeConsumeOrDeployment() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-substitution", "Original Shard", "ORIG");
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("substitution-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 permitDigest) =
            _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = _prediction(execution);

        bytes32 originalPresentation = execution.registration.presentationBindingHash;
        execution.registration.presentationBindingHash = keccak256("different-image-description-links");
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.registration.presentationBindingHash = originalPresentation;

        string memory originalName = execution.params.tokenName;
        string memory originalNftName = execution.params.nftName;
        bytes32 originalNameHash = execution.registration.tokenNameHash;
        execution.params.tokenName = "Substituted Shard";
        execution.params.nftName = string.concat(execution.params.tokenName, " Pieces");
        execution.registration.tokenNameHash = keccak256(bytes(execution.params.tokenName));
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.tokenName = originalName;
        execution.params.nftName = originalNftName;
        execution.registration.tokenNameHash = originalNameHash;

        string memory originalSymbol = execution.params.tokenSymbol;
        string memory originalNftSymbol = execution.params.nftSymbol;
        bytes32 originalSymbolHash = execution.registration.tokenSymbolHash;
        execution.params.tokenSymbol = "SUB";
        execution.params.nftSymbol = string.concat(execution.params.tokenSymbol, "N");
        execution.registration.tokenSymbolHash = keccak256(bytes(execution.params.tokenSymbol));
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.tokenSymbol = originalSymbol;
        execution.params.nftSymbol = originalNftSymbol;
        execution.registration.tokenSymbolHash = originalSymbolHash;
    }

    function test_factoryRuntimeDriftFailsBeforeConsumeDeploymentOrRegistration() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-factory-runtime-drift", "Runtime Shard", "RUN");
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("runtime-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 permitDigest) =
            _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = _prediction(execution);
        vm.etch(address(factory), hex"00");

        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.DependencyRuntimeCodeHashMismatch.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);

        _assertNoLaunchEffects(execution, prediction, permitDigest, false);
    }

    function test_missingWrongOrExpiredRealLaunchIntentFailsBeforeConsumeOrDeployment() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-intent-negative", "Intent Shard", "INT");
        _authorizeTechnical(execution.registration);
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 permitDigest) =
            _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = _prediction(execution);

        _expectLaunchIntentUnavailableNoEffects(envelope, execution, prediction, permitDigest);

        _authorizeIntentBinding(
            execution.registration,
            keccak256("deliberately-wrong-launch-intent-binding"),
            uint64(block.number),
            uint64(block.number),
            keccak256("wrong-intent-evidence")
        );
        _expectLaunchIntentUnavailableNoEffects(envelope, execution, prediction, permitDigest);

        vm.roll(block.number + 1);
        (, bytes32 exactIntentBinding,,) = bindings.computeBindings(execution.registration);
        _authorizeIntentBinding(
            execution.registration,
            exactIntentBinding,
            uint64(block.number),
            uint64(block.number),
            keccak256("expired-intent-evidence")
        );
        vm.roll(block.number + 1);
        _expectLaunchIntentUnavailableNoEffects(envelope, execution, prediction, permitDigest);
    }

    function test_wrongWalletAndStandaloneConsumeSelectorCannotTouchRealLaunchState() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-wallet-negative", "Wallet Shard", "WAL");
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("wallet-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 permitDigest) =
            _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = _prediction(execution);

        (bool standaloneConsumeSucceeded,) = address(route)
            .call(
                abi.encodeWithSelector(
                    bytes4(keccak256("consume(uint64,bytes32,bytes32)")),
                    REPOSITORY_ID,
                    keccak256("standalone-consume"),
                    route.ROUTE_ID()
                )
            );
        assertFalse(standaloneConsumeSucceeded);
        _assertNoLaunchEffects(execution, prediction, permitDigest, true);

        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.LaunchWalletMismatch.selector);
        vm.prank(address(0xBAD));
        route.launch(envelope, execution);
        _assertNoLaunchEffects(execution, prediction, permitDigest, true);
    }

    function test_postPermitTechnicalAndDerivationMutationsCannotConsumeOrDeployRealGraph() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("real-technical-mutations", "Technical Shard", "TECH");
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("technical-mutation-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope, bytes32 permitDigest) =
            _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = _prediction(execution);

        bytes memory originalHookCreationCode = execution.hookCreationCode;
        execution.hookCreationCode = bytes.concat(originalHookCreationCode, hex"00");
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.hookCreationCode = originalHookCreationCode;

        int24 originalTickLower = execution.params.tickLower;
        execution.params.tickLower = originalTickLower + 60;
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.tickLower = originalTickLower;

        int24 originalTickBand = execution.params.tickBand;
        execution.params.tickBand = originalTickBand + 60;
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.tickBand = originalTickBand;

        int24 originalTickUpper = execution.params.tickUpper;
        execution.params.tickUpper = originalTickUpper + 60;
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.tickUpper = originalTickUpper;

        uint160 originalStartSqrtPriceX96 = execution.params.startSqrtPriceX96;
        execution.params.startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(originalTickUpper + 60);
        _expectPermitBindingMismatchNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.startSqrtPriceX96 = originalStartSqrtPriceX96;

        address originalRenderer = execution.params.renderer;
        execution.params.renderer = address(implementation.renderer());
        _expectConfigurationInvalidNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.renderer = originalRenderer;

        string memory originalNftName = execution.params.nftName;
        execution.params.nftName = "Substituted Shard Pieces";
        _expectConfigurationInvalidNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.nftName = originalNftName;

        string memory originalNftSymbol = execution.params.nftSymbol;
        execution.params.nftSymbol = "SUBN";
        _expectConfigurationInvalidNoEffects(envelope, execution, prediction, permitDigest);
        execution.params.nftSymbol = originalNftSymbol;
    }

    function test_hiddenJitRendererNftMetadataTickAndStartPriceFreedomIsRejectedBeforePermitConsumption() public {
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution =
            _execution("locked-technical", "Locked Shard", "LOCK");
        _authorizeTechnical(execution.registration);
        _authorizeIntent(execution.registration, uint64(block.number + 100), keccak256("locked-intent"));
        (ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope,) = _permit(execution, 1);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = factory.predictLaunch(
            execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
        );

        execution.params.renderer = address(new ExactShardsUnreviewedRendererV1());
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.ConfigurationInvalid.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        execution.params.renderer = address(0);

        execution.params.nftName = "Caller Chosen NFT";
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.ConfigurationInvalid.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        execution.params.nftName = string.concat(execution.params.tokenName, " Pieces");

        execution.params.nftSymbol = "OTHER";
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.ConfigurationInvalid.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        execution.params.nftSymbol = string.concat(execution.params.tokenSymbol, "N");

        execution.params.tickBand += 60;
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.PermitBindingMismatch.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        execution.params.tickBand -= 60;

        execution.params.startSqrtPriceX96 += 1;
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.PermitBindingMismatch.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);

        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        assertFalse(authority.repositoryConsumed(repositoryKey));
        assertEq(authority.nextNonce(repositoryKey), 0);
        assertEq(registry.registrationCount(), 0);
        assertEq(prediction.shard.code.length, 0);
        assertEq(prediction.hook.code.length, 0);
        assertEq(prediction.nft.code.length, 0);
    }

    function _execution(string memory label, string memory name, string memory symbol)
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
        execution.hookSalt = _mineHookSalt(execution.tokenSalt, execution.hookCreationCode, execution.params);
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction = factory.predictLaunch(
            execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
        );
        (bytes32 shardRuntime, bytes32 hookRuntime, bytes32 nftRuntime) = _exactRuntimeHashes(execution, prediction);
        execution.registration = _registration(label, execution, prediction, shardRuntime, hookRuntime, nftRuntime);
    }

    function _registration(
        string memory label,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction,
        bytes32 shardRuntime,
        bytes32 hookRuntime,
        bytes32 nftRuntime
    ) private view returns (IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) {
        registration.chainId = block.chainid;
        registration.registryGeneration = registry.REGISTRY_GENERATION();
        registration.githubRepositoryId = REPOSITORY_ID;
        registration.approvalGeneration = 1;
        registration.commitId = bytes32(feeVerifier.REVIEWED_SOURCE_COMMIT());
        registration.sourceCommitment = feeVerifier.SOURCE_REVISION_HASH();
        registration.buildCommitment = feeVerifier.REVIEWED_TECHNICAL_BUILD_SHA256();
        registration.projectId = bindings.computeProjectId(REPOSITORY_ID);
        registration.websiteProjectIdSha256 = keccak256(abi.encode("website-project-id", label));
        registration.websiteLaunchIdSha256 = keccak256(abi.encode("website-launch-id", label));
        registration.configurationHash = route.computeTechnicalConfigurationHash(
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
        registration.artifactSetHash = route.computeCanonicalArtifactSetHash(
            registration.sourceCommitment, registration.buildCommitment, execution.hookCreationCode
        );
        registration.deploymentSetHash = route.computeCanonicalDeploymentSetHash(prediction);
        registration.runtimeCodeSetHash = route.computePredictedRuntimeCodeSetHash(
            prediction.shard, shardRuntime, prediction.hook, hookRuntime, prediction.nft, nftRuntime
        );
        _feePolicy(registration, prediction.hook);
        (registration.approvalBindingHash,,,) = bindings.computeBindings(registration);
        (registration.approvalId, registration.launchId) = bindings.computeCanonicalTargetIds(
            registration.projectId, registration.approvalGeneration, registration.approvalBindingHash
        );
        _rebindRecord(registration);
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

    function _rebindRecord(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private view {
        (bytes32 approvalBindingHash,, bytes32 reviewBinding,) = bindings.computeBindings(registration);
        registration.approvalBindingHash = approvalBindingHash;
        registration.reviewDeploymentBindingHash = reviewBinding;
        // The registered-record commitment includes the canonical review/deployment binding.
        // Recompute only after that field has been projected into the registration.
        (,,, bytes32 recordCommitment) = bindings.computeBindings(registration);
        registration.registeredRecordCommitment = recordCommitment;
    }

    function _authorizeTechnical(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration) private {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory approval =
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: registration.approvalBindingHash,
                validAfterBlock: uint64(block.number),
                expiresAtBlock: type(uint64).max,
                evidenceHash: keccak256(abi.encode("durable-approval", registration.approvalId))
            });
        vm.prank(APPROVER);
        registry.authorizeApproval(approval);
    }

    function _authorizeIntent(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration,
        uint64 expiresAtBlock,
        bytes32 evidenceHash
    ) private {
        (, bytes32 intentBinding,,) = bindings.computeBindings(registration);
        _authorizeIntentBinding(registration, intentBinding, uint64(block.number), expiresAtBlock, evidenceHash);
    }

    function _authorizeIntentBinding(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration,
        bytes32 intentBinding,
        uint64 validAfterBlock,
        uint64 expiresAtBlock,
        bytes32 evidenceHash
    ) private {
        IProgrammableCustomRegistryV1.ApprovalAuthorizationV1 memory intent =
            IProgrammableCustomRegistryV1.ApprovalAuthorizationV1({
                chainId: block.chainid,
                registryGeneration: registry.REGISTRY_GENERATION(),
                approvalId: registration.approvalId,
                launchId: registration.launchId,
                approvalBindingHash: registration.approvalBindingHash,
                registrationBindingHash: intentBinding,
                validAfterBlock: validAfterBlock,
                expiresAtBlock: expiresAtBlock,
                evidenceHash: evidenceHash
            });
        vm.prank(INTENT_APPROVER);
        registry.authorizeLaunchIntent(intent);
    }

    function _prediction(ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution)
        private
        view
        returns (IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory)
    {
        return factory.predictLaunch(
            execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
        );
    }

    function _expectPermitBindingMismatchNoEffects(
        ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory canonicalPrediction,
        bytes32 permitDigest
    ) private {
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.PermitBindingMismatch.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        _assertNoLaunchEffects(execution, canonicalPrediction, permitDigest, true);
    }

    function _expectConfigurationInvalidNoEffects(
        ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory canonicalPrediction,
        bytes32 permitDigest
    ) private {
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.ConfigurationInvalid.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        _assertNoLaunchEffects(execution, canonicalPrediction, permitDigest, true);
    }

    function _expectLaunchIntentUnavailableNoEffects(
        ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1 memory envelope,
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory canonicalPrediction,
        bytes32 permitDigest
    ) private {
        vm.expectPartialRevert(ProgrammableExactShardsAtomicLaunchRouteV1.LaunchIntentUnavailable.selector);
        vm.prank(LAUNCHER);
        route.launch(envelope, execution);
        _assertNoLaunchEffects(execution, canonicalPrediction, permitDigest, true);
    }

    function _assertNoLaunchEffects(
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory canonicalPrediction,
        bytes32 permitDigest,
        bool factoryRuntimeIntact
    ) private view {
        bytes32 repositoryKey = authority.computeRepositoryKey(REPOSITORY_ID);
        assertFalse(authority.repositoryConsumed(repositoryKey));
        assertEq(authority.nextNonce(repositoryKey), 0);
        assertEq(authority.consumptionCount(), 0);
        assertEq(
            uint8(authority.permitStatus(permitDigest).state),
            uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.UNSEEN)
        );
        assertEq(registry.registrationCount(), 0);
        assertEq(
            uint8(registry.launchState(execution.registration.launchId).status),
            uint8(IProgrammableCustomRegistryV1.LaunchStatus.None)
        );
        assertFalse(registry.approvalState(execution.registration.approvalId).consumed);
        assertEq(registry.recordHashAtRevision(execution.registration.launchId, 1), bytes32(0));
        assertEq(registry.publicIdentityState(execution.registration.launchId).identityMappingHash, bytes32(0));
        assertEq(canonicalPrediction.shard.code.length, 0);
        assertEq(canonicalPrediction.hook.code.length, 0);
        assertEq(canonicalPrediction.nft.code.length, 0);
        if (factoryRuntimeIntact) {
            assertEq(factory.configurationHashOf(canonicalPrediction.hook), bytes32(0));
        }
    }

    function _permit(ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution, uint64 generation)
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
        permit.route = address(route);
        permit.routeId = route.ROUTE_ID();
        permit.applicantWallet = LAUNCHER;
        permit.launchId = execution.registration.launchId;
        permit.approvalId = execution.registration.approvalId;
        permit.technicalApprovalHash = execution.registration.approvalBindingHash;
        permit.descriptorHash = keccak256(abi.encode("exact-shards-descriptor", execution.registration.commitId));
        permit.presentationBindingHash = execution.registration.presentationBindingHash;
        permit.configurationHash = execution.registration.configurationHash;
        permit.walletOwnershipBindingHash = keccak256(abi.encode("wallet", LAUNCHER));
        permit.executionPlanHash = keccak256(abi.encode("plan", execution.registration.registeredRecordCommitment));
        permit.executionCoreHash = route.computeExecutionCoreHash(
            execution.registration,
            execution.tokenSalt,
            execution.hookSalt,
            execution.hookCreationCode,
            execution.params,
            0
        );
        permit.executionCalldataKeccak256 = route.computeInnerExecutionCalldataKeccak256(
            execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params
        );
        permit.releaseBindingHash = authority.computeReleaseBindingHash(releaseBinding);
        permit.kernelExecutionEnvelopeHash = authority.computeKernelExecutionEnvelopeHash(emptyKernel);
        permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
        digest = authority.hashPermit(permit);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        envelope = ProgrammableExactShardsAtomicLaunchRouteV1.PermitEnvelopeV1({
            permit: permit,
            releaseBinding: releaseBinding,
            kernelEnvelope: emptyKernel,
            permitSignature: abi.encodePacked(r, s, v)
        });
    }

    function _release() private view returns (IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory binding) {
        binding = IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1({
            authorityGeneration: authority.AUTHORITY_GENERATION(),
            releaseGeneration: 1,
            permitAuthority: address(authority),
            permitAuthorityRuntimeCodeHash: address(authority).codehash,
            launchRegistry: address(registry),
            launchRegistryGeneration: registry.REGISTRY_GENERATION(),
            launchRegistryRuntimeCodeHash: address(registry).codehash,
            chainProfileHash: registry.CHAIN_PROFILE_HASH(),
            profile: address(route),
            profileId: route.ROUTE_ID(),
            profileRuntimeCodeHash: address(route).codehash,
            profileBindingHash: route.permitProfileBindingHash(),
            route: address(route),
            routeId: route.ROUTE_ID(),
            routeRuntimeCodeHash: address(route).codehash,
            executionAuthorityHash: route.permitExecutionAuthorityHash(),
            kernelEnvelopeMode: IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE
        });
    }

    function _exactRuntimeHashes(
        ProgrammableExactShardsAtomicLaunchRouteV1.ShardsExecutionV1 memory execution,
        IProgrammableExactShardsRouteGatedFactoryV2.LaunchPredictionV2 memory prediction
    ) private returns (bytes32 shardRuntime, bytes32 hookRuntime, bytes32 nftRuntime) {
        uint256 snapshot = vm.snapshotState();
        vm.prank(address(route));
        (address hook, address shard, address nft) =
            factory.launch(execution.tokenSalt, execution.hookSalt, execution.hookCreationCode, execution.params);
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
                address(factory),
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
            address shard = Create2.computeAddress(effectiveSalt, tokenInitCodeHash, address(factory));
            assembly ("memory-safe") {
                mstore(add(hookInitCode, shardWordOffset), shard)
            }
            address hook = Create2.computeAddress(minedSalt, keccak256(hookInitCode), address(factory));
            if (uint160(hook) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) return minedSalt;
        }
    }

    function _deployRegistry(address exactRoute) private returns (ProgrammableExactShardsRegistryV1) {
        return new ProgrammableExactShardsRegistryV1(
            ProgrammableExactShardsRegistryV1.RegistryConfigV1({
                initialAdminDelay: 2 days,
                initialAdmin: address(this),
                initialApprover: APPROVER,
                initialLaunchIntentApprover: INTENT_APPROVER,
                initialWriter: exactRoute,
                initialFinalizer: FINALIZER,
                initialRevoker: REVOKER,
                registryGeneration: 3,
                minimumFinalityBlocks: 3,
                chainProfileHash: keccak256("ethereum-mainnet-chain-profile"),
                registryPolicyHash: keccak256("exact-shards-registry-policy")
            }),
            feeVerifier,
            authority
        );
    }
}
