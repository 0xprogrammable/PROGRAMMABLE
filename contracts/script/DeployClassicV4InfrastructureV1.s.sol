// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script } from "forge-std/Script.sol";

import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "../src/ClassicInitialBuyVestingWalletFactoryV1.sol";
import { ClassicGraduationVaultFactoryV1 } from "../src/ClassicGraduationVaultFactoryV1.sol";
import { ClassicGraduationVaultV1 } from "../src/ClassicGraduationVaultV1.sol";
import { ClassicLaunchPolicyV1 } from "../src/ClassicLaunchPolicyV1.sol";
import { ClassicPositionPlannerV1 } from "../src/ClassicPositionPlannerV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { EthCreatorFeeHookFactoryV4 } from "../src/EthCreatorFeeHookFactoryV4.sol";
import { EthCreatorFeeHookV4 } from "../src/EthCreatorFeeHookV4.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV3 } from "../src/MemeLaunchV3.sol";

/// @title DeployClassicV4InfrastructureV1
/// @notice Fail-closed preparation for the additive Classic V4 release on Ethereum Mainnet or Sepolia.
/// @dev Deploys five new contracts: HookFactoryV4, the mined HookV4, ClassicPositionPlannerV1,
///      ClassicGraduationVaultFactoryV1 and MemeLaunchV3.
///      The reviewed Classic V3 authority, reward, custody, policy and position-lock dependencies are explicit Inputs
///      and are reused only after exact address, runtime-codehash and immutable-binding validation. `run` never reads a
///      private key. A live transaction still requires Forge's explicit `--broadcast`, an operator-controlled signer,
///      the complete environment listed on `run`, and a source commitment approved after the final source review.
contract DeployClassicV4InfrastructureV1 is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11_155_111;
    uint256 internal constant MAX_LAUNCHER_RUNTIME_BYTES = 24_000;

    address public constant LAUNCHER_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant EXPECTED_CTO_AUTHORITY_OWNER = 0x2Bb333d48DFAF1596D9036671d2E43168994249E;
    int24 public constant EXPECTED_INITIAL_TICK = 204_200;
    int24 public constant EXPECTED_DEEP30_TICK_LOWER = 174_800;
    int24 public constant EXPECTED_FINAL_TICK_LOWER = 9800;
    int24 public constant EXPECTED_FINAL_TICK_UPPER = 225_200;
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.AFTER_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
            | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    struct OfficialDependencies {
        address poolManager;
        address positionManager;
        address stateView;
        address v4Quoter;
        address uerc20Factory;
        address permit2;
        address universalRouter;
        bytes32 poolManagerCodeHash;
        bytes32 positionManagerCodeHash;
        bytes32 stateViewCodeHash;
        bytes32 v4QuoterCodeHash;
        bytes32 uerc20FactoryCodeHash;
        bytes32 permit2CodeHash;
        bytes32 universalRouterCodeHash;
    }

    /// @notice Exact already-deployed Classic V3 components reused by the additive release.
    struct Inputs {
        address ctoAuthority;
        address rewardVaultFactory;
        address initialBuyVestingWalletFactory;
        address launchPolicy;
        address positionForwarderFactory;
    }

    struct SharedCodeHashes {
        bytes32 ctoAuthority;
        bytes32 rewardVaultFactory;
        bytes32 initialBuyVestingWalletFactory;
        bytes32 launchPolicy;
        bytes32 positionForwarderFactory;
    }

    struct DeploymentPlan {
        uint256 chainId;
        address broadcaster;
        uint64 startingNonce;
        address hookFactory;
        address feeHook;
        address positionPlanner;
        address graduationVaultFactory;
        address launcher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
    }

    struct DeploymentResult {
        EthCreatorFeeHookFactoryV4 hookFactory;
        EthCreatorFeeHookV4 feeHook;
        ClassicPositionPlannerV1 positionPlanner;
        ClassicGraduationVaultFactoryV1 graduationVaultFactory;
        MemeLaunchV3 launcher;
        bytes32 hookSalt;
        bytes32 sourceCommitment;
        bytes32 hookFactoryRuntimeCodeHash;
        bytes32 feeHookRuntimeCodeHash;
        bytes32 positionPlannerRuntimeCodeHash;
        bytes32 graduationVaultFactoryRuntimeCodeHash;
        bytes32 launcherRuntimeCodeHash;
        uint64 startingNonce;
    }

    error DeploymentAddressOccupied(address target);
    error ExplicitOwnerApprovalRequired();
    error InvalidBroadcaster(address broadcaster);
    error UnexpectedAddress(bytes32 field, address actual, address expected);
    error UnexpectedChain(uint256 actual);
    error UnexpectedCodeHash(address target, bytes32 actual, bytes32 expected);
    error UnexpectedCommitment(bytes32 field, bytes32 actual, bytes32 expected);
    error UnexpectedHookFlags(uint160 actual, uint160 expected);
    error UnexpectedHookPermissions();
    error UnexpectedLauncherFeeRecipient(address actual, address expected);
    error UnexpectedNonce(address broadcaster, uint64 actual, uint64 expected);
    error UnexpectedValue(bytes32 field, uint256 actual, uint256 expected);

    /// @notice Simulates or, only with Forge `--broadcast`, submits the reviewed five-transaction sequence.
    /// @dev Required environment:
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_OWNER_APPROVED=true
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_DEPLOYER
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_START_NONCE
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_LAUNCHER_FEE_RECIPIENT
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_SOURCE_COMMITMENT
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_CTO_AUTHORITY
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_REWARD_VAULT_FACTORY
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_INITIAL_BUY_VESTING_WALLET_FACTORY
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_LAUNCH_POLICY
    ///      CLASSIC_V4_{MAINNET|SEPOLIA}_POSITION_FORWARDER_FACTORY
    function run() external returns (DeploymentResult memory result) {
        address broadcaster = vm.envAddress(_environmentKey("DEPLOYER"));
        address configuredLauncherFeeRecipient = vm.envAddress(_environmentKey("LAUNCHER_FEE_RECIPIENT"));
        uint256 configuredNonce = vm.envUint(_environmentKey("START_NONCE"));
        if (configuredNonce > type(uint64).max) {
            revert UnexpectedValue(keccak256("startingNonce"), configuredNonce, type(uint64).max);
        }

        Inputs memory inputs = Inputs({
            ctoAuthority: vm.envAddress(_environmentKey("CTO_AUTHORITY")),
            rewardVaultFactory: vm.envAddress(_environmentKey("REWARD_VAULT_FACTORY")),
            initialBuyVestingWalletFactory: vm.envAddress(_environmentKey("INITIAL_BUY_VESTING_WALLET_FACTORY")),
            launchPolicy: vm.envAddress(_environmentKey("LAUNCH_POLICY")),
            positionForwarderFactory: vm.envAddress(_environmentKey("POSITION_FORWARDER_FACTORY"))
        });

        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        return deployReviewed(inputs, broadcaster, uint64(configuredNonce), configuredLauncherFeeRecipient);
    }

    function deployReviewed(
        Inputs memory inputs,
        address broadcaster,
        uint64 startingNonce,
        address configuredLauncherFeeRecipient
    ) public returns (DeploymentResult memory result) {
        _requireExplicitApproval(inputs, broadcaster, startingNonce, configuredLauncherFeeRecipient);
        OfficialDependencies memory dependencies = validateOfficialDependencies();
        validateSharedDependencies(inputs);
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        address expectedRecipient = expectedLauncherFeeRecipient();
        if (configuredLauncherFeeRecipient != expectedRecipient) {
            revert UnexpectedLauncherFeeRecipient(configuredLauncherFeeRecipient, expectedRecipient);
        }

        uint64 actualNonce = vm.getNonce(broadcaster);
        if (actualNonce != startingNonce) revert UnexpectedNonce(broadcaster, actualNonce, startingNonce);

        DeploymentPlan memory plan = deploymentPlan(inputs, broadcaster, startingNonce);
        _assertVacant(plan.hookFactory);
        _assertVacant(plan.feeHook);
        _assertVacant(plan.positionPlanner);
        _assertVacant(plan.graduationVaultFactory);
        _assertVacant(plan.launcher);

        vm.startBroadcast(broadcaster);
        result.hookFactory = new EthCreatorFeeHookFactoryV4();
        result.feeHook = result.hookFactory
            .deploy(
                plan.hookSalt,
                IPoolManager(dependencies.poolManager),
                configuredLauncherFeeRecipient,
                FeeSplitVaultFactoryV1(inputs.rewardVaultFactory)
            );
        result.positionPlanner = new ClassicPositionPlannerV1();
        result.graduationVaultFactory = new ClassicGraduationVaultFactoryV1(
            IPositionManager(dependencies.positionManager),
            LockedPositionFeeForwarderFactoryV1(inputs.positionForwarderFactory)
        );
        result.launcher = _deployLauncher(
            dependencies, inputs, result.feeHook, result.positionPlanner, result.graduationVaultFactory
        );
        vm.stopBroadcast();

        _assertAddress(keccak256("hookFactory"), address(result.hookFactory), plan.hookFactory);
        _assertAddress(keccak256("feeHook"), address(result.feeHook), plan.feeHook);
        _assertAddress(keccak256("positionPlanner"), address(result.positionPlanner), plan.positionPlanner);
        _assertAddress(
            keccak256("graduationVaultFactory"), address(result.graduationVaultFactory), plan.graduationVaultFactory
        );
        _assertAddress(keccak256("launcher"), address(result.launcher), plan.launcher);

        result.hookSalt = plan.hookSalt;
        result.sourceCommitment = plan.sourceCommitment;
        result.startingNonce = startingNonce;
        _validateDeployedStack(result, dependencies, inputs);
        result.hookFactoryRuntimeCodeHash = address(result.hookFactory).codehash;
        result.feeHookRuntimeCodeHash = address(result.feeHook).codehash;
        result.positionPlannerRuntimeCodeHash = address(result.positionPlanner).codehash;
        result.graduationVaultFactoryRuntimeCodeHash = address(result.graduationVaultFactory).codehash;
        result.launcherRuntimeCodeHash = address(result.launcher).codehash;

        uint64 finalNonce = vm.getNonce(broadcaster);
        if (finalNonce != startingNonce + 5) {
            revert UnexpectedNonce(broadcaster, finalNonce, startingNonce + 5);
        }
    }

    function deploymentPlan(Inputs memory inputs, address broadcaster, uint64 startingNonce)
        public
        view
        returns (DeploymentPlan memory plan)
    {
        if (broadcaster == address(0)) revert InvalidBroadcaster(broadcaster);
        _assertExpectedInputs(inputs);
        OfficialDependencies memory dependencies = _officialDependencies();

        plan.chainId = block.chainid;
        plan.broadcaster = broadcaster;
        plan.startingNonce = startingNonce;
        plan.hookFactory = vm.computeCreateAddress(broadcaster, startingNonce);
        (plan.feeHook, plan.hookSalt) = HookMiner.find(
            plan.hookFactory,
            REQUIRED_HOOK_FLAGS,
            type(EthCreatorFeeHookV4).creationCode,
            abi.encode(
                IPoolManager(dependencies.poolManager),
                expectedLauncherFeeRecipient(),
                FeeSplitVaultFactoryV1(inputs.rewardVaultFactory)
            )
        );
        // The hook is created by transaction N+1 through the factory; the next broadcaster CREATE uses nonce N+2.
        plan.positionPlanner = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 2);
        plan.graduationVaultFactory = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 3);
        plan.launcher = vm.computeCreateAddress(broadcaster, uint256(startingNonce) + 4);
        plan.sourceCommitment = deploymentSourceCommitment(inputs);
    }

    function predictHook(address hookFactory, Inputs memory inputs, bytes32 hookSalt) public view returns (address) {
        _assertExpectedInputs(inputs);
        OfficialDependencies memory dependencies = _officialDependencies();
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(EthCreatorFeeHookV4).creationCode,
                abi.encode(
                    IPoolManager(dependencies.poolManager),
                    expectedLauncherFeeRecipient(),
                    FeeSplitVaultFactoryV1(inputs.rewardVaultFactory)
                )
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), hookFactory, hookSalt, initCodeHash)))));
    }

    function expectedInputs() public view returns (Inputs memory) {
        if (block.chainid == MAINNET_CHAIN_ID) {
            return Inputs({
                ctoAuthority: 0x9746469Cd79fdDc5aA7218e7dd51c829ee518c0C,
                rewardVaultFactory: 0xF28967f9DFaC3Ca21384b59D6D75C8106b3eab2a,
                initialBuyVestingWalletFactory: 0xDe21b9c0Cc0AfDB9be20e8236113f066BB8C66f4,
                launchPolicy: 0x53a4d1E6ab184389D3581085AB73CD3549B20d1a,
                positionForwarderFactory: 0x291a9ff1059d225d02B1659430804486404dB507
            });
        }
        if (block.chainid == SEPOLIA_CHAIN_ID) {
            return Inputs({
                ctoAuthority: 0x7AEf9a4038FAbb1d477BbFD3A106F81b93EB5aeB,
                rewardVaultFactory: 0xB7Eb3Ae60EE2f7F2F89DA8D372529919C700e76c,
                initialBuyVestingWalletFactory: 0xF41568B2b4681bDbA4f5e03345597a526973F65c,
                launchPolicy: 0x5b36779d6B6F571A518725974Fde243a58afFEa2,
                positionForwarderFactory: 0xaE3C324B742a7576863A546120c4280b7c9E8448
            });
        }
        revert UnexpectedChain(block.chainid);
    }

    /// @notice Checks every official dependency needed by deployment, quoting and Universal Router trading.
    function validateOfficialDependencies() public view returns (OfficialDependencies memory dependencies) {
        dependencies = _officialDependencies();
        _assertCodeHash(dependencies.poolManager, dependencies.poolManagerCodeHash);
        _assertCodeHash(dependencies.positionManager, dependencies.positionManagerCodeHash);
        _assertCodeHash(dependencies.stateView, dependencies.stateViewCodeHash);
        _assertCodeHash(dependencies.v4Quoter, dependencies.v4QuoterCodeHash);
        _assertCodeHash(dependencies.uerc20Factory, dependencies.uerc20FactoryCodeHash);
        _assertCodeHash(dependencies.permit2, dependencies.permit2CodeHash);
        _assertCodeHash(dependencies.universalRouter, dependencies.universalRouterCodeHash);
    }

    /// @notice Verifies the exact deployed V3 components before reusing them in a V4 constructor.
    function validateSharedDependencies(Inputs memory inputs) public view {
        _assertExpectedInputs(inputs);
        SharedCodeHashes memory hashes = _sharedCodeHashes();
        _assertCodeHash(inputs.ctoAuthority, hashes.ctoAuthority);
        _assertCodeHash(inputs.rewardVaultFactory, hashes.rewardVaultFactory);
        _assertCodeHash(inputs.initialBuyVestingWalletFactory, hashes.initialBuyVestingWalletFactory);
        _assertCodeHash(inputs.launchPolicy, hashes.launchPolicy);
        _assertCodeHash(inputs.positionForwarderFactory, hashes.positionForwarderFactory);

        ClassicCtoAuthorityV1 ctoAuthority = ClassicCtoAuthorityV1(inputs.ctoAuthority);
        ClassicRewardVaultFactoryV1 rewardVaultFactory = ClassicRewardVaultFactoryV1(inputs.rewardVaultFactory);
        ClassicInitialBuyVestingWalletFactoryV1 custodyFactory =
            ClassicInitialBuyVestingWalletFactoryV1(inputs.initialBuyVestingWalletFactory);
        ClassicLaunchPolicyV1 launchPolicy = ClassicLaunchPolicyV1(inputs.launchPolicy);
        LockedPositionFeeForwarderFactoryV1 forwarderFactory =
            LockedPositionFeeForwarderFactoryV1(inputs.positionForwarderFactory);
        OfficialDependencies memory dependencies = _officialDependencies();

        _assertAddress(
            keccak256("rewardVaultFactory.ctoAuthority"),
            address(rewardVaultFactory.ctoAuthority()),
            inputs.ctoAuthority
        );
        _assertAddress(keccak256("ctoAuthority.authority"), ctoAuthority.authority(), EXPECTED_CTO_AUTHORITY_OWNER);
        _assertAddress(keccak256("ctoAuthority.pendingAuthority"), ctoAuthority.pendingAuthority(), address(0));
        _assertAddress(
            keccak256("positionForwarderFactory.positionManager"),
            address(forwarderFactory.positionManager()),
            dependencies.positionManager
        );
        _assertAddress(keccak256("positionForwarderFactory.operator"), forwarderFactory.OPERATOR(), address(0));
        _assertValue(
            keccak256("positionForwarderFactory.timelockBlock"), forwarderFactory.TIMELOCK_BLOCK(), type(uint256).max
        );
        _assertValue(keccak256("custody.minimumDurationDays"), custodyFactory.MIN_DURATION_DAYS(), 1);
        _assertValue(keccak256("custody.maximumDurationDays"), custodyFactory.MAX_DURATION_DAYS(), 3650);
        _assertValue(keccak256("launchPolicy.maximumBeneficiaries"), launchPolicy.MAX_REWARD_BENEFICIARIES(), 5);
        _assertValue(keccak256("launchPolicy.rewardShareBasisPoints"), launchPolicy.REWARD_SHARE_BASIS_POINTS(), 10_000);
    }

    function expectedLauncherFeeRecipient() public view returns (address) {
        if (block.chainid == MAINNET_CHAIN_ID || block.chainid == SEPOLIA_CHAIN_ID) {
            return LAUNCHER_FEE_RECIPIENT;
        }
        revert UnexpectedChain(block.chainid);
    }

    function deploymentSourceCommitment(Inputs memory inputs) public view returns (bytes32) {
        _assertExpectedInputs(inputs);
        OfficialDependencies memory dependencies = _officialDependencies();
        SharedCodeHashes memory sharedHashes = _sharedCodeHashes();
        bytes32 bytecodeCommitment = keccak256(
            abi.encode(
                keccak256(type(EthCreatorFeeHookFactoryV4).creationCode),
                keccak256(type(EthCreatorFeeHookV4).creationCode),
                keccak256(type(ClassicPositionPlannerV1).creationCode),
                keccak256(type(ClassicGraduationVaultV1).creationCode),
                keccak256(type(ClassicGraduationVaultFactoryV1).creationCode),
                keccak256(type(MemeLaunchV3).creationCode)
            )
        );
        bytes32 dependencyCommitment =
            keccak256(abi.encode(block.chainid, dependencies, inputs, sharedHashes, expectedLauncherFeeRecipient()));
        return keccak256(
            abi.encode(
                keccak256("programmable.classic.infrastructure.v4.ethereum"),
                bytecodeCommitment,
                dependencyCommitment,
                economicsCommitment()
            )
        );
    }

    function economicsCommitment() public pure returns (bytes32) {
        bytes32 feeCommitment = keccak256(
            abi.encode(
                uint256(10),
                uint256(10),
                uint256(1000),
                uint256(10),
                uint256(0),
                uint256(0),
                int256(200),
                keccak256("immutable-directional-buy-and-sell-fees")
            )
        );
        bytes32 liquidityCommitment = keccak256(
            abi.encode(
                uint256(1_000_000_000 ether),
                uint256(800_000_000 ether),
                uint256(200_000_000 ether),
                int256(EXPECTED_INITIAL_TICK),
                int256(EXPECTED_DEEP30_TICK_LOWER),
                int256(EXPECTED_FINAL_TICK_LOWER),
                int256(EXPECTED_FINAL_TICK_UPPER),
                uint256(0),
                uint256(1),
                keccak256("standard-permanent-or-bonding-then-same-pool-permanent-position"),
                keccak256("bonding-freezes-at-endpoint-and-graduates-permissionlessly")
            )
        );
        return keccak256(abi.encode(feeCommitment, liquidityCommitment));
    }

    function _validateDeployedStack(
        DeploymentResult memory result,
        OfficialDependencies memory dependencies,
        Inputs memory inputs
    ) private view {
        _assertCodeHash(address(result.hookFactory), keccak256(type(EthCreatorFeeHookFactoryV4).runtimeCode));
        _assertCodeHash(address(result.positionPlanner), keccak256(type(ClassicPositionPlannerV1).runtimeCode));
        if (address(result.graduationVaultFactory).code.length == 0) {
            revert UnexpectedValue(keccak256("graduationVaultFactory.runtimeBytes"), 0, 1);
        }
        if (address(result.feeHook).code.length == 0) {
            revert UnexpectedValue(keccak256("feeHook.runtimeBytes"), 0, 1);
        }
        if (address(result.launcher).code.length == 0) {
            revert UnexpectedValue(keccak256("launcher.runtimeBytes"), 0, 1);
        }
        if (address(result.launcher).code.length > MAX_LAUNCHER_RUNTIME_BYTES) {
            revert UnexpectedValue(
                keccak256("launcher.runtimeBytes"), address(result.launcher).code.length, MAX_LAUNCHER_RUNTIME_BYTES
            );
        }

        _assertAddress(keccak256("hook.poolManager"), address(result.feeHook.poolManager()), dependencies.poolManager);
        _assertAddress(
            keccak256("hook.launcherFeeRecipient"),
            result.feeHook.launcherFeeRecipient(),
            expectedLauncherFeeRecipient()
        );
        _assertAddress(
            keccak256("hook.feeSplitVaultFactory"),
            address(result.feeHook.feeSplitVaultFactory()),
            inputs.rewardVaultFactory
        );
        uint160 actualFlags = uint160(address(result.feeHook)) & result.hookFactory.ALL_HOOK_MASK();
        if (actualFlags != REQUIRED_HOOK_FLAGS) revert UnexpectedHookFlags(actualFlags, REQUIRED_HOOK_FLAGS);
        if (!result.hookFactory.isFactoryHook(address(result.feeHook))) {
            revert UnexpectedAddress(keccak256("hookFactory.provenance"), address(0), address(result.feeHook));
        }
        _validateHookPermissions(result.feeHook);

        _assertValue(keccak256("hook.launcherFeeBps"), result.feeHook.LAUNCHER_FEE_BPS(), 10);
        _assertValue(keccak256("hook.minimumFeeBps"), result.feeHook.MIN_TOTAL_SWAP_FEE_BPS(), 10);
        _assertValue(keccak256("hook.maximumFeeBps"), result.feeHook.MAX_TOTAL_SWAP_FEE_BPS(), 1000);
        _assertValue(keccak256("hook.feeStepBps"), result.feeHook.TOTAL_SWAP_FEE_STEP_BPS(), 10);
        _assertValue(keccak256("hook.transferTaxBps"), result.feeHook.TRANSFER_TAX_BPS(), 0);
        _assertValue(keccak256("hook.lpFeePips"), result.feeHook.LP_FEE_PIPS(), 0);
        _assertValue(keccak256("hook.tickSpacing"), uint24(result.feeHook.TICK_SPACING()), 200);

        _assertValue(keccak256("planner.standardPreset"), result.positionPlanner.STANDARD_PRESET(), 0);
        _assertValue(keccak256("planner.deep30Preset"), result.positionPlanner.DEEP30_PRESET(), 1);
        _assertValue(keccak256("planner.tokenSupply"), result.positionPlanner.TOKEN_SUPPLY(), 1_000_000_000 ether);
        _assertSignedValue(
            keccak256("planner.initialTick"), result.positionPlanner.INITIAL_TICK(), EXPECTED_INITIAL_TICK
        );
        _assertSignedValue(
            keccak256("planner.deep30TickLower"), result.positionPlanner.DEEP30_TICK_LOWER(), EXPECTED_DEEP30_TICK_LOWER
        );
        _assertSignedValue(keccak256("planner.tickSpacing"), result.positionPlanner.TICK_SPACING(), 200);
        _assertValue(
            keccak256("planner.bondingAllocation"), result.positionPlanner.BONDING_TOKEN_ALLOCATION(), 800_000_000 ether
        );
        _assertValue(
            keccak256("planner.graduationReserve"), result.positionPlanner.GRADUATION_TOKEN_RESERVE(), 200_000_000 ether
        );

        _assertAddress(
            keccak256("graduationVaultFactory.positionManager"),
            address(result.graduationVaultFactory.positionManager()),
            dependencies.positionManager
        );
        _assertAddress(
            keccak256("graduationVaultFactory.positionForwarderFactory"),
            address(result.graduationVaultFactory.positionForwarderFactory()),
            inputs.positionForwarderFactory
        );

        _assertAddress(
            keccak256("launcher.poolManager"), address(result.launcher.poolManager()), dependencies.poolManager
        );
        _assertAddress(
            keccak256("launcher.positionManager"),
            address(result.launcher.positionManager()),
            dependencies.positionManager
        );
        _assertAddress(
            keccak256("launcher.tokenFactory"), address(result.launcher.tokenFactory()), dependencies.uerc20Factory
        );
        _assertAddress(keccak256("launcher.feeHook"), address(result.launcher.feeHook()), address(result.feeHook));
        _assertAddress(
            keccak256("launcher.positionPlanner"),
            address(result.launcher.positionPlanner()),
            address(result.positionPlanner)
        );
        _assertAddress(
            keccak256("launcher.rewardVaultFactory"),
            address(result.launcher.rewardVaultFactory()),
            inputs.rewardVaultFactory
        );
        _assertAddress(
            keccak256("launcher.initialBuyVestingWalletFactory"),
            address(result.launcher.initialBuyVestingWalletFactory()),
            inputs.initialBuyVestingWalletFactory
        );
        _assertAddress(keccak256("launcher.launchPolicy"), address(result.launcher.launchPolicy()), inputs.launchPolicy);
        _assertAddress(
            keccak256("launcher.positionForwarderFactory"),
            address(result.launcher.positionForwarderFactory()),
            inputs.positionForwarderFactory
        );
        _assertAddress(
            keccak256("launcher.graduationVaultFactory"),
            address(result.launcher.graduationVaultFactory()),
            address(result.graduationVaultFactory)
        );
        _assertValue(keccak256("launcher.standardPreset"), result.launcher.STANDARD_LIQUIDITY_PRESET(), 0);
        _assertValue(keccak256("launcher.deep30Preset"), result.launcher.DEEP30_LIQUIDITY_PRESET(), 1);
        _assertValue(keccak256("launcher.minimumInitialBuyWei"), result.launcher.MIN_INITIAL_BUY_WEI(), 0.0006 ether);
        _assertValue(keccak256("launcher.tokenSupply"), result.launcher.TOKEN_SUPPLY(), 1_000_000_000 ether);
        _assertSignedValue(keccak256("launcher.initialTick"), result.launcher.INITIAL_TICK(), EXPECTED_INITIAL_TICK);
        _assertSignedValue(keccak256("launcher.tickSpacing"), result.launcher.TICK_SPACING(), 200);
        _assertValue(keccak256("launcher.lpFeePips"), result.launcher.LP_FEE_PIPS(), 0);
    }

    function _deployLauncher(
        OfficialDependencies memory dependencies,
        Inputs memory inputs,
        EthCreatorFeeHookV4 feeHook,
        ClassicPositionPlannerV1 positionPlanner,
        ClassicGraduationVaultFactoryV1 graduationVaultFactory
    ) private returns (MemeLaunchV3 launcher) {
        launcher = new MemeLaunchV3(
            IPoolManager(dependencies.poolManager),
            IPositionManager(dependencies.positionManager),
            UERC20Factory(dependencies.uerc20Factory),
            feeHook,
            positionPlanner,
            ClassicRewardVaultFactoryV1(inputs.rewardVaultFactory),
            ClassicInitialBuyVestingWalletFactoryV1(inputs.initialBuyVestingWalletFactory),
            ClassicLaunchPolicyV1(inputs.launchPolicy),
            LockedPositionFeeForwarderFactoryV1(inputs.positionForwarderFactory),
            graduationVaultFactory
        );
    }

    function _validateHookPermissions(EthCreatorFeeHookV4 hook) private pure {
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        if (
            !permissions.beforeInitialize || permissions.afterInitialize || !permissions.beforeAddLiquidity
                || !permissions.afterAddLiquidity || !permissions.beforeRemoveLiquidity
                || !permissions.afterRemoveLiquidity || !permissions.beforeSwap || !permissions.afterSwap
                || permissions.beforeDonate || permissions.afterDonate || !permissions.beforeSwapReturnDelta
                || !permissions.afterSwapReturnDelta || permissions.afterAddLiquidityReturnDelta
                || permissions.afterRemoveLiquidityReturnDelta
        ) {
            revert UnexpectedHookPermissions();
        }
    }

    function _requireExplicitApproval(
        Inputs memory inputs,
        address broadcaster,
        uint64 startingNonce,
        address configuredLauncherFeeRecipient
    ) private view {
        if (!vm.envOr(_environmentKey("OWNER_APPROVED"), false)) {
            revert ExplicitOwnerApprovalRequired();
        }
        address approvedBroadcaster = vm.envAddress(_environmentKey("DEPLOYER"));
        _assertAddress(keccak256("approvedBroadcaster"), broadcaster, approvedBroadcaster);
        uint256 approvedNonce = vm.envUint(_environmentKey("START_NONCE"));
        if (approvedNonce > type(uint64).max) {
            revert UnexpectedValue(keccak256("approvedStartingNonce"), approvedNonce, type(uint64).max);
        }
        _assertValue(keccak256("approvedStartingNonce"), startingNonce, approvedNonce);
        _assertAddress(
            keccak256("approvedLauncherFeeRecipient"),
            configuredLauncherFeeRecipient,
            vm.envAddress(_environmentKey("LAUNCHER_FEE_RECIPIENT"))
        );
        bytes32 actualCommitment = deploymentSourceCommitment(inputs);
        bytes32 approvedCommitment = vm.envBytes32(_environmentKey("SOURCE_COMMITMENT"));
        if (actualCommitment != approvedCommitment) {
            revert UnexpectedCommitment(keccak256("sourceCommitment"), actualCommitment, approvedCommitment);
        }
    }

    function _environmentKey(string memory suffix) private view returns (string memory) {
        if (block.chainid == MAINNET_CHAIN_ID) return string.concat("CLASSIC_V4_MAINNET_", suffix);
        if (block.chainid == SEPOLIA_CHAIN_ID) return string.concat("CLASSIC_V4_SEPOLIA_", suffix);
        revert UnexpectedChain(block.chainid);
    }

    function _assertExpectedInputs(Inputs memory inputs) private view {
        Inputs memory expected = expectedInputs();
        _assertAddress(keccak256("ctoAuthority"), inputs.ctoAuthority, expected.ctoAuthority);
        _assertAddress(keccak256("rewardVaultFactory"), inputs.rewardVaultFactory, expected.rewardVaultFactory);
        _assertAddress(
            keccak256("initialBuyVestingWalletFactory"),
            inputs.initialBuyVestingWalletFactory,
            expected.initialBuyVestingWalletFactory
        );
        _assertAddress(keccak256("launchPolicy"), inputs.launchPolicy, expected.launchPolicy);
        _assertAddress(
            keccak256("positionForwarderFactory"), inputs.positionForwarderFactory, expected.positionForwarderFactory
        );
    }

    function _officialDependencies() private view returns (OfficialDependencies memory dependencies) {
        if (block.chainid == MAINNET_CHAIN_ID) {
            return OfficialDependencies({
                poolManager: 0x000000000004444c5dc75cB358380D2e3dE08A90,
                positionManager: 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e,
                stateView: 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227,
                v4Quoter: 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203,
                uerc20Factory: 0x000000e200088D55C39a11F609E5F667729ad49b,
                permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
                universalRouter: 0xd92A36B0000531EF3063dEd4De20A0783308446C,
                poolManagerCodeHash: 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293,
                positionManagerCodeHash: 0x77e36c08b19959a30dde46dec9abe6208e371ff2f56884a56fe1e1a53615528b,
                stateViewCodeHash: 0xd7947778589cf4aac9a092a4451292a2056380941635ab7006d3c691d8dfd878,
                v4QuoterCodeHash: 0x06de58fa119c5deaa7a667fb92d3894e25d9160e62fb82c8d86d43b47eefe441,
                uerc20FactoryCodeHash: 0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb,
                permit2CodeHash: 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131,
                universalRouterCodeHash: 0x41ccd905c8e4de29ce9536ff49233b79e3085a0987d490664e703ee1e7b1dc49
            });
        }
        if (block.chainid == SEPOLIA_CHAIN_ID) {
            return OfficialDependencies({
                poolManager: 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543,
                positionManager: 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4,
                stateView: 0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C,
                v4Quoter: 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227,
                uerc20Factory: 0x000000e200088D55C39a11F609E5F667729ad49b,
                permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3,
                universalRouter: 0x470FFC67b1feEEC31D16C46AC7545C98716a194c,
                poolManagerCodeHash: 0x09930125a49f5b95caf8052991cc14d1240dca8b43f42b899115b86867e4bce1,
                positionManagerCodeHash: 0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab,
                stateViewCodeHash: 0xaaed3db8eb8ebde8014ce4c8a3938496687f4c6374e17a7d735288f6c65ceb9e,
                v4QuoterCodeHash: 0xf481a751ac453d40c46d12360b85b05472028c1b113ab63749d69a5f8b0e47d1,
                uerc20FactoryCodeHash: 0x9f042af1533641f048ced56b55898d9e87b2ccb0ec6854292e2cd8ea733e6aeb,
                permit2CodeHash: 0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751,
                universalRouterCodeHash: 0x14b733fce7cfcca643ef884ed59d2cb2d23b3fead8692613dcee311d65555caf
            });
        }
        revert UnexpectedChain(block.chainid);
    }

    function _sharedCodeHashes() private view returns (SharedCodeHashes memory hashes) {
        if (block.chainid == MAINNET_CHAIN_ID) {
            return SharedCodeHashes({
                ctoAuthority: 0x7beafb575fba4ffce22da7b3f927df8248eebc6c33e77cb43ed967a91a36984c,
                rewardVaultFactory: 0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee,
                initialBuyVestingWalletFactory: 0x13b7578a8abd0bc0ba724b5815d9bd0aff0d07c2677c00d2577004e8c1f6d5f4,
                launchPolicy: 0xb6b31b6cf326784774e13f6d60f9b251dde118469a506fa3b1c124c9f11b49be,
                positionForwarderFactory: 0xcefd10b60f990984bb60c98eb53e66048bfd36da9b48200e8535f5ca39d58fb2
            });
        }
        if (block.chainid == SEPOLIA_CHAIN_ID) {
            return SharedCodeHashes({
                ctoAuthority: 0x7beafb575fba4ffce22da7b3f927df8248eebc6c33e77cb43ed967a91a36984c,
                rewardVaultFactory: 0x89f07bb8a3158631e10177259699a4cbf88a54e18901de90592042a211861c73,
                initialBuyVestingWalletFactory: 0x13b7578a8abd0bc0ba724b5815d9bd0aff0d07c2677c00d2577004e8c1f6d5f4,
                launchPolicy: 0xb6b31b6cf326784774e13f6d60f9b251dde118469a506fa3b1c124c9f11b49be,
                positionForwarderFactory: 0x49e040806b0664b2fa4f41c5abc11241cdb8f847c538c13d6874c32804b74ebc
            });
        }
        revert UnexpectedChain(block.chainid);
    }

    function _assertVacant(address target) private view {
        if (target.code.length != 0) revert DeploymentAddressOccupied(target);
    }

    function _assertCodeHash(address target, bytes32 expected) private view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert UnexpectedCodeHash(target, actual, expected);
    }

    function _assertAddress(bytes32 field, address actual, address expected) private pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }

    function _assertValue(bytes32 field, uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert UnexpectedValue(field, actual, expected);
    }

    function _assertSignedValue(bytes32 field, int256 actual, int256 expected) private pure {
        if (actual != expected) {
            revert UnexpectedValue(
                field, uint256(actual < 0 ? -actual : actual), uint256(expected < 0 ? -expected : expected)
            );
        }
    }
}
