// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Vm } from "forge-std/Vm.sol";

import { ClassicCtoAuthorityV1 } from "../src/ClassicCtoAuthorityV1.sol";
import {
    ClassicInitialBuyCustodyConfig,
    ClassicInitialBuyCustodyMode,
    ClassicInitialBuyVestingWalletV1
} from "../src/ClassicInitialBuyVestingWalletV1.sol";
import { ClassicInitialBuyVestingWalletFactoryV1 } from "../src/ClassicInitialBuyVestingWalletFactoryV1.sol";
import { ClassicLaunchPolicyV1 } from "../src/ClassicLaunchPolicyV1.sol";
import { ClassicRewardVaultFactoryV1 } from "../src/ClassicRewardVaultFactoryV1.sol";
import { EthCreatorFeeHookFactoryV3 } from "../src/EthCreatorFeeHookFactoryV3.sol";
import { EthCreatorFeeHookV3 } from "../src/EthCreatorFeeHookV3.sol";
import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV2 } from "../src/MemeLaunchV2.sol";
import { MemeLaunchV3 } from "../src/MemeLaunchV3.sol";

contract MemeLaunchV3Test is Deployers {
    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;

    bytes32 private constant TOKEN_LAUNCHED_TOPIC = keccak256(
        "MemeTokenLaunchedV3(address,address,bytes32,address,address,address,uint256,uint16,uint16,bytes32,bytes32)"
    );
    bytes32 private constant INITIAL_BUY_TOPIC =
        keccak256("MemeCreatorInitialBuyV3(address,address,bytes32,uint256,uint256,bytes32)");
    bytes32 private constant CUSTODY_TOPIC =
        keccak256("MemeCreatorInitialBuyCustodyV3(address,address,address,uint8,uint16,uint16,bytes32,bytes32)");

    struct PredictedArtifacts {
        address token;
        bytes32 graffiti;
        address rewardVault;
        address positionForwarder;
        address initialBuyCustody;
    }

    PositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    EthCreatorFeeHookFactoryV3 internal hookFactory;
    EthCreatorFeeHookV3 internal feeHook;
    ClassicRewardVaultFactoryV1 internal vaultFactory;
    ClassicInitialBuyVestingWalletFactoryV1 internal initialBuyVestingWalletFactory;
    ClassicLaunchPolicyV1 internal launchPolicy;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    MemeLaunchV3 internal launcher;

    address internal launchWallet;
    address internal externalBeneficiary;
    address internal treasury;

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = PositionManager(payable(CANONICAL_POSITION_MANAGER));

        tokenFactory = new UERC20Factory();
        hookFactory = new EthCreatorFeeHookFactoryV3();
        ClassicCtoAuthorityV1 ctoAuthority = new ClassicCtoAuthorityV1(makeAddr("ctoController"));
        vaultFactory = new ClassicRewardVaultFactoryV1(ctoAuthority);
        initialBuyVestingWalletFactory = new ClassicInitialBuyVestingWalletFactoryV1();
        launchPolicy = new ClassicLaunchPolicyV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        treasury = makeAddr("programmableTreasury");
        feeHook = _deployHook();
        launcher = _newLauncher(address(this));

        launchWallet = makeAddr("launchWallet");
        externalBeneficiary = makeAddr("externalBeneficiary");
        vm.deal(address(this), 20 ether);
        vm.deal(launchWallet, 1 ether);
    }

    function test_constructorPinsCodeBearingRouterAndRuntimeDependencies() public view {
        assertEq(launcher.ROUTER(), address(this));
        assertGt(launcher.ROUTER().code.length, 0);
        assertEq(address(launcher.poolManager()), address(manager));
        assertEq(address(launcher.positionManager()), address(positionManager));
        assertEq(address(launcher.tokenFactory()), address(tokenFactory));
        assertEq(address(launcher.feeHook()), address(feeHook));
        assertEq(address(launcher.rewardVaultFactory()), address(vaultFactory));
        assertEq(address(launcher.initialBuyVestingWalletFactory()), address(initialBuyVestingWalletFactory));
        assertEq(address(launcher.launchPolicy()), address(launchPolicy));
        assertEq(address(launcher.positionForwarderFactory()), address(positionForwarderFactory));
        assertGt(address(launcher).code.length, 0);
        assertEq(address(launcher).codehash, keccak256(address(launcher).code));
    }

    function test_constructorRejectsZeroOrCodeLessRouter() public {
        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV3.InvalidDependency.selector, address(0)));
        _newLauncher(address(0));

        address codeLess = makeAddr("codeLessRouter");
        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV3.InvalidDependency.selector, codeLess));
        _newLauncher(codeLess);
    }

    function test_onlyRouterCanLaunchForWallet() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("unauthorized"));
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, launchWallet, parameters.creatorSalt);
        address attacker = makeAddr("attacker");
        vm.deal(attacker, MIN_INITIAL_BUY_WEI);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV3.UnauthorizedRouter.selector, attacker, address(this)));
        launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(launchWallet, parameters);

        assertEq(predicted.code.length, 0);
    }

    function test_routerCannotLaunchForZeroWallet() public {
        vm.expectRevert(MemeLaunchV3.ZeroLaunchWallet.selector);
        launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(address(0), _parameters(bytes32("zero-wallet")));
    }

    function test_legacyPermissionlessLaunchSelectorIsAbsent() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("no-legacy-selector"));
        (address predicted,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, launchWallet, parameters.creatorSalt);

        (bool success,) = address(launcher).call{ value: MIN_INITIAL_BUY_WEI }(
            abi.encodeWithSelector(MemeLaunchV2.launch.selector, parameters)
        );

        assertFalse(success);
        assertEq(predicted.code.length, 0);
    }

    function test_launchWalletBindsPredictionsOwnershipVaultForwarderCustodyEventsAndHash() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("wallet-bound"));
        parameters.initialBuyCustody = ClassicInitialBuyCustodyConfig({
            mode: ClassicInitialBuyCustodyMode.FixedLock, durationDays: 30, cliffDays: 0
        });

        PredictedArtifacts memory expected = _predictArtifacts(parameters, launchWallet);
        PredictedArtifacts memory routerBound = _predictArtifacts(parameters, address(this));

        assertEq(expected.graffiti, keccak256(abi.encode(launchWallet, parameters.creatorSalt)));
        assertNotEq(expected.graffiti, routerBound.graffiti);
        assertNotEq(expected.token, routerBound.token);
        assertNotEq(expected.rewardVault, routerBound.rewardVault);

        vm.recordLogs();
        MemeLaunchV3.LaunchResult memory result =
            launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(launchWallet, parameters);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        assertEq(result.token, expected.token);
        assertEq(result.rewardVault, expected.rewardVault);
        assertEq(result.positionRecipient, expected.positionForwarder);
        assertEq(result.initialBuyCustody, expected.initialBuyCustody);
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
        assertEq(launcher.rewardVaultOf(result.token), expected.rewardVault);
        assertEq(launcher.initialBuyCustodyOf(result.token), expected.initialBuyCustody);
        assertEq(UERC20(result.token).creator(), address(launcher));
        assertEq(PositionFeesForwarder(payable(result.positionRecipient)).feeRecipient(), launchWallet);

        ClassicInitialBuyVestingWalletV1 custody = ClassicInitialBuyVestingWalletV1(payable(result.initialBuyCustody));
        assertEq(custody.owner(), launchWallet);
        assertEq(IERC20(result.token).balanceOf(address(custody)), result.initialBuyTokenAmount);
        assertEq(IERC20(result.token).balanceOf(address(this)), 0);
        _assertWalletBoundEvents(entries, launchWallet);
    }

    function test_twoWalletsCanLaunchThroughOneRouterAndSharedHook() public {
        address secondWallet = makeAddr("secondWallet");
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("shared-hook"));

        MemeLaunchV3.LaunchResult memory first =
            launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(launchWallet, parameters);
        MemeLaunchV3.LaunchResult memory second =
            launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(secondWallet, parameters);

        assertNotEq(first.token, second.token);
        assertNotEq(first.poolId, second.poolId);
        assertNotEq(first.launchHash, second.launchHash);
        assertEq(IERC20(first.token).balanceOf(launchWallet), first.initialBuyTokenAmount);
        assertEq(IERC20(second.token).balanceOf(secondWallet), second.initialBuyTokenAmount);
        assertEq(PositionFeesForwarder(payable(first.positionRecipient)).feeRecipient(), launchWallet);
        assertEq(PositionFeesForwarder(payable(second.positionRecipient)).feeRecipient(), secondWallet);
        assertEq(UERC20(first.token).creator(), address(launcher));
        assertEq(UERC20(second.token).creator(), address(launcher));

        PoolKey memory firstKey = launcher.poolKey(first.token);
        PoolKey memory secondKey = launcher.poolKey(second.token);
        assertEq(address(firstKey.hooks), address(feeHook));
        assertEq(address(secondKey.hooks), address(feeHook));
        (,,,, bool firstRegistered,) = feeHook.poolFeeConfig(first.poolId);
        (,,,, bool secondRegistered,) = feeHook.poolFeeConfig(second.poolId);
        assertTrue(firstRegistered);
        assertTrue(secondRegistered);
    }

    function test_postDeploymentFailureRollsBackEveryWalletBoundArtifact() public {
        MemeLaunchV3.LaunchParameters memory parameters = _parameters(bytes32("rollback"));
        parameters.buySwapFeeBps = 150;
        (address predictedToken,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, launchWallet, parameters.creatorSalt);
        address predictedVault = launcher.predictRewardVault(
            predictedToken, launchWallet, parameters.rewardBeneficiaries, parameters.rewardSharesBps
        );
        bytes32 positionSalt = keccak256(abi.encode("launcher.meme-position.v1", predictedToken, launchWallet));
        address predictedForwarder = positionForwarderFactory.predict(positionSalt, launchWallet);
        bytes32 predictedPoolId = PoolId.unwrap(launcher.poolKey(predictedToken).toId());

        vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV3.InvalidTotalSwapFee.selector, 150));
        launcher.launchFor{ value: MIN_INITIAL_BUY_WEI }(launchWallet, parameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(predictedVault.code.length, 0);
        assertEq(predictedForwarder.code.length, 0);
        assertEq(launcher.launchHashOf(predictedToken), bytes32(0));
        assertEq(launcher.rewardVaultOf(predictedToken), address(0));
        (,,,, bool registered,) = feeHook.poolFeeConfig(predictedPoolId);
        assertFalse(registered);
    }

    function test_onlyPoolManagerCanCallInitialBuyUnlockCallback() public {
        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV3.UnauthorizedUnlockCallback.selector, address(this)));
        launcher.unlockCallback("");
    }

    function _newLauncher(address router) private returns (MemeLaunchV3) {
        return new MemeLaunchV3(
            manager,
            positionManager,
            tokenFactory,
            feeHook,
            vaultFactory,
            initialBuyVestingWalletFactory,
            launchPolicy,
            positionForwarderFactory,
            router
        );
    }

    function _deployHook() private returns (EthCreatorFeeHookV3 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV3).creationCode,
            abi.encode(manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)))
        );
        deployed = hookFactory.deploy(salt, manager, treasury, FeeSplitVaultFactoryV1(address(vaultFactory)));
    }

    function _predictArtifacts(MemeLaunchV3.LaunchParameters memory parameters, address wallet)
        private
        view
        returns (PredictedArtifacts memory predicted)
    {
        (predicted.token, predicted.graffiti) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, wallet, parameters.creatorSalt);
        predicted.rewardVault = launcher.predictRewardVault(
            predicted.token, wallet, parameters.rewardBeneficiaries, parameters.rewardSharesBps
        );
        predicted.positionForwarder = positionForwarderFactory.predict(
            keccak256(abi.encode("launcher.meme-position.v1", predicted.token, wallet)), wallet
        );
        predicted.initialBuyCustody = initialBuyVestingWalletFactory.predict(
            keccak256(abi.encode("programmable.classic-initial-buy-custody.v1", predicted.token, wallet)),
            IERC20(predicted.token),
            wallet,
            uint64(block.timestamp),
            parameters.initialBuyCustody
        );
    }

    function _parameters(bytes32 salt) private view returns (MemeLaunchV3.LaunchParameters memory parameters) {
        address[] memory beneficiaries = new address[](1);
        beneficiaries[0] = externalBeneficiary;
        uint16[] memory shares = new uint16[](1);
        shares[0] = 10_000;
        parameters = MemeLaunchV3.LaunchParameters({
            name: string.concat("Classic ", _hexNibble(uint8(uint256(salt) & 0xf))),
            symbol: string.concat("CV", _hexNibble(uint8(uint256(salt) & 0xf))),
            buySwapFeeBps: 200,
            sellSwapFeeBps: 700,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Classic V3 router fixture",
                website: "https://programmable.family",
                image: "ipfs://classic-v3",
                extraData: bytes("")
            }),
            rewardBeneficiaries: beneficiaries,
            rewardSharesBps: shares,
            initialBuyCustody: ClassicInitialBuyCustodyConfig({
                mode: ClassicInitialBuyCustodyMode.Unlocked, durationDays: 0, cliffDays: 0
            })
        });
    }

    function _assertWalletBoundEvents(Vm.Log[] memory entries, address expectedWallet) private view {
        bytes32 encodedWallet = bytes32(uint256(uint160(expectedWallet)));
        uint256 matched;
        for (uint256 index; index < entries.length; index++) {
            Vm.Log memory entry = entries[index];
            if (
                entry.emitter == address(launcher) && entry.topics.length > 1
                    && (entry.topics[0] == TOKEN_LAUNCHED_TOPIC
                        || entry.topics[0] == INITIAL_BUY_TOPIC
                        || entry.topics[0] == CUSTODY_TOPIC)
            ) {
                assertEq(entry.topics[1], encodedWallet);
                matched++;
            }
        }
        assertEq(matched, 3);
    }

    function _hexNibble(uint8 value) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory output = new bytes(1);
        output[0] = alphabet[value];
        return string(output);
    }
}
