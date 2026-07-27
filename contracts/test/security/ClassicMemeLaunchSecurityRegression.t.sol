// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { FullMath } from "@uniswap/v4-core/src/libraries/FullMath.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { BalanceDeltaLibrary } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { PositionInfo } from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { EthCreatorFeeHookFactoryV1 } from "../../src/EthCreatorFeeHookFactoryV1.sol";
import { EthCreatorFeeHookV1 } from "../../src/EthCreatorFeeHookV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../../src/LockedPositionFeeForwarderFactoryV1.sol";
import { MemeLaunchV1 } from "../../src/MemeLaunchV1.sol";

/// @dev Receives a legitimate creator fee payout and attempts to claim the same pool again
///      before the first claim returns. The low-level call lets the outer payout complete while
///      preserving the exact inner revert selector for the regression assertion.
contract ClassicReentrantCreator {
    EthCreatorFeeHookV1 public feeHook;
    bytes32 public poolId;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    uint256 public receivedNative;

    function launch(MemeLaunchV1 launcher, MemeLaunchV1.LaunchParameters calldata parameters)
        external
        payable
        returns (MemeLaunchV1.LaunchResult memory)
    {
        return launcher.launch{ value: msg.value }(parameters);
    }

    function arm(EthCreatorFeeHookV1 feeHook_, bytes32 poolId_) external {
        feeHook = feeHook_;
        poolId = poolId_;
    }

    receive() external payable {
        receivedNative += msg.value;
        reentryAttempted = true;

        (bool success, bytes memory revertData) =
            address(feeHook).call(abi.encodeCall(EthCreatorFeeHookV1.claimCreatorFees, (poolId)));
        reentrySucceeded = success;
        if (!success && revertData.length >= 4) {
            bytes4 selector;
            assembly ("memory-safe") {
                selector := mload(add(revertData, 0x20))
            }
            reentryError = selector;
        }
    }
}

/// @notice Independent security regressions for the fixed-supply Classic launch.
/// @dev Mirrors the official DirectLaunchStrategy's core accounting checks: exact supply,
///      single-sided position bounds, permanent NFT custody and zero transient token balances.
contract ClassicMemeLaunchSecurityRegressionTest is Deployers {
    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant BASIS_POINTS = 10_000;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    EthCreatorFeeHookFactoryV1 internal hookFactory;
    EthCreatorFeeHookV1 internal feeHook;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    MemeLaunchV1 internal launcher;

    address internal creator;
    address internal launcherTreasury;

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = IPositionManager(CANONICAL_POSITION_MANAGER);

        tokenFactory = new UERC20Factory();
        hookFactory = new EthCreatorFeeHookFactoryV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        launcherTreasury = makeAddr("classicLauncherTreasury");
        feeHook = _deployHook();
        launcher = new MemeLaunchV1(manager, positionManager, tokenFactory, feeHook, positionForwarderFactory);
        swapRouter = new PoolSwapTest(manager);

        creator = makeAddr("classicCreator");
        vm.deal(address(this), 100 ether);
    }

    function test_feeBoundariesLaunchAndRecordExactlyOneAndTenPercent() public {
        MemeLaunchV1.LaunchResult memory onePercent =
            _launchAs(creator, _parameters("Classic One", "ONE", 100, bytes32(uint256(1)), hex"01"));
        MemeLaunchV1.LaunchResult memory tenPercent =
            _launchAs(creator, _parameters("Classic Ten", "TEN", 1000, bytes32(uint256(10)), hex"10"));

        (address oneCreator, address oneRegistrar, uint16 oneFee, bool oneRegistered,) =
            feeHook.poolFeeConfig(onePercent.poolId);
        (address tenCreator, address tenRegistrar, uint16 tenFee, bool tenRegistered,) =
            feeHook.poolFeeConfig(tenPercent.poolId);

        assertTrue(oneRegistered);
        assertTrue(tenRegistered);
        assertEq(oneCreator, creator);
        assertEq(tenCreator, creator);
        assertEq(oneRegistrar, address(launcher));
        assertEq(tenRegistrar, address(launcher));
        assertEq(oneFee, 100);
        assertEq(tenFee, 1000);
    }

    /// forge-config: default.fuzz.runs = 64
    /// forge-config: ci.fuzz.runs = 256
    function testFuzz_launchAcceptsEveryWholePercentAndNothingIsAddedToIt(uint8 rawPercent) public {
        uint16 selectedTotalFeeBps = uint16(bound(uint256(rawPercent), 1, 10) * 100);
        MemeLaunchV1.LaunchResult memory result = _launchAs(
            creator,
            _parameters(
                "Classic Fuzz",
                "CFZ",
                selectedTotalFeeBps,
                keccak256(abi.encode("fee-selection", selectedTotalFeeBps)),
                hex"c1a551c0"
            )
        );

        (address recordedCreator, address registrar, uint16 recordedTotalFeeBps, bool registered,) =
            feeHook.poolFeeConfig(result.poolId);
        assertTrue(registered);
        assertEq(recordedCreator, creator);
        assertEq(registrar, address(launcher));
        assertEq(recordedTotalFeeBps, selectedTotalFeeBps);

        (uint256 creatorFee, uint256 launcherFee) = feeHook.quoteGrossFees(1 ether, selectedTotalFeeBps);
        assertEq(launcherFee, 0.001 ether);
        assertEq(creatorFee + launcherFee, uint256(selectedTotalFeeBps) * 0.0001 ether);
        assertEq(creatorFee, uint256(selectedTotalFeeBps - feeHook.LAUNCHER_FEE_BPS()) * 0.0001 ether);
    }

    function test_rejectsFeesBelowAboveAndBetweenWholePercentSelections() public {
        uint16[7] memory invalid = [uint16(0), 1, 99, 101, 150, 999, 1001];

        for (uint256 i; i < invalid.length; ++i) {
            MemeLaunchV1.LaunchParameters memory parameters =
                _parameters("Invalid Fee", "BAD", invalid[i], bytes32(i + 1), hex"ff");
            vm.expectRevert(abi.encodeWithSelector(MemeLaunchV1.InvalidTotalSwapFee.selector, invalid[i]));
            vm.prank(creator);
            launcher.launch(parameters);
        }
    }

    function testFuzz_launcherPointOnePercentIsIncludedNotAdded(uint96 rawGross, uint8 rawPercent) public view {
        uint256 grossNative = bound(uint256(rawGross), 1000, 100_000 ether);
        uint16 selectedTotalFeeBps = uint16(bound(uint256(rawPercent), 1, 10) * 100);

        (uint256 creatorFee, uint256 launcherFee) = feeHook.quoteGrossFees(grossNative, selectedTotalFeeBps);
        uint256 selectedTotalFee = FullMath.mulDiv(grossNative, selectedTotalFeeBps, BASIS_POINTS);
        uint256 fixedLauncherShare = FullMath.mulDiv(grossNative, feeHook.LAUNCHER_FEE_BPS(), BASIS_POINTS);

        assertEq(creatorFee + launcherFee, selectedTotalFee);
        assertEq(launcherFee, fixedLauncherShare);
        assertEq(creatorFee, selectedTotalFee - fixedLauncherShare);
        assertLt(creatorFee + launcherFee, grossNative);
    }

    function test_launchRequiresTheMinimumCreatorDevBuy() public {
        MemeLaunchV1.LaunchResult memory result =
            _launchAs(creator, _parameters("Initial Buy", "BUY", 100, bytes32(uint256(11)), hex"11"));

        assertTrue(result.token.code.length > 0);
        assertEq(result.initialBuyNativeAmount, MIN_INITIAL_BUY_WEI);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(creator.balance, 0);
        assertEq(address(launcher).balance, 0);

        uint256 invalidValue = MIN_INITIAL_BUY_WEI - 1;
        address valueSender = makeAddr("belowMinimumValueSender");
        vm.deal(valueSender, invalidValue);
        MemeLaunchV1.LaunchParameters memory paidParameters =
            _parameters("Wrong Initial Buy", "WRONG", 100, bytes32(uint256(12)), hex"12");
        (address predictedToken,) = launcher.predictTokenAddress(
            paidParameters.name, paidParameters.symbol, valueSender, paidParameters.creatorSalt
        );

        vm.expectRevert(
            abi.encodeWithSelector(MemeLaunchV1.InitialBuyBelowMinimum.selector, invalidValue, MIN_INITIAL_BUY_WEI)
        );
        vm.prank(valueSender);
        launcher.launch{ value: invalidValue }(paidParameters);

        assertEq(predictedToken.code.length, 0);
        assertEq(address(launcher).balance, 0);
    }

    function test_largerCreatorDevBuyExecutesInFullAndReturnsMoreTokens() public {
        MemeLaunchV1.LaunchResult memory minimumResult =
            _launchAs(creator, _parameters("Minimum Buy", "MIN", 100, bytes32(uint256(13)), hex"13"));
        address largerBuyer = makeAddr("largerDevBuyer");
        uint256 largerBuy = 0.002 ether;
        vm.deal(largerBuyer, largerBuy);
        vm.prank(largerBuyer);
        MemeLaunchV1.LaunchResult memory largerResult = launcher.launch{ value: largerBuy }(
            _parameters("Larger Buy", "MORE", 100, bytes32(uint256(14)), hex"14")
        );

        assertEq(largerResult.initialBuyNativeAmount, largerBuy);
        assertGt(largerResult.initialBuyTokenAmount, minimumResult.initialBuyTokenAmount);
        assertEq(IERC20(largerResult.token).balanceOf(largerBuyer), largerResult.initialBuyTokenAmount);
        assertEq(largerBuyer.balance, 0);
        assertEq(address(launcher).balance, 0);
    }

    function test_exactSupplyIsAccountedForInOneSidedPermanentlyCustodiedPosition() public {
        MemeLaunchV1.LaunchResult memory result =
            _launchAs(creator, _parameters("Custody", "LOCK", 100, bytes32(uint256(21)), hex"21"));
        IERC20 token = IERC20(result.token);
        PoolKey memory launchKey = launcher.poolKey(result.token);
        (PoolKey memory positionKey, PositionInfo positionInfo) =
            positionManager.getPoolAndPositionInfo(result.positionTokenId);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(token.totalSupply(), launcher.TOKEN_SUPPLY());
        assertLt(token.balanceOf(address(manager)), result.tokenLiquidityAmount);
        assertEq(token.balanceOf(result.positionRecipient), result.lockedTokenDust);
        assertEq(
            token.balanceOf(address(manager)) + token.balanceOf(result.positionRecipient) + token.balanceOf(creator),
            token.totalSupply()
        );
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, token.totalSupply());

        assertEq(token.balanceOf(address(launcher)), 0);
        assertEq(token.balanceOf(address(positionManager)), 0);
        assertEq(token.balanceOf(address(feeHook)), 0);
        assertEq(token.balanceOf(creator), result.initialBuyTokenAmount);

        assertEq(PoolId.unwrap(positionKey.toId()), PoolId.unwrap(launchKey.toId()));
        assertEq(positionInfo.tickLower(), TickMath.minUsableTick(launcher.TICK_SPACING()));
        assertEq(positionInfo.tickUpper(), launcher.INITIAL_TICK());
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);

        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertTrue(positionForwarderFactory.isFactoryForwarder(result.positionRecipient));

        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        vm.prank(creator);
        vm.expectRevert();
        IERC721(address(positionManager)).transferFrom(result.positionRecipient, creator, result.positionTokenId);

        uint128 liquidityBefore = positionManager.getPositionLiquidity(result.positionTokenId);
        vm.prank(makeAddr("permissionlessFeeCollector"));
        forwarder.collectFees(result.positionTokenId);
        assertEq(positionManager.getPositionLiquidity(result.positionTokenId), liquidityBefore);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
    }

    /// forge-config: default.fuzz.runs = 64
    /// forge-config: ci.fuzz.runs = 256
    function testFuzz_metadataBytesRoundTripThroughOfficialFactory(bytes32 left, bytes32 right) public {
        bytes memory extraData = abi.encodePacked(bytes4(0xfeedbeef), left, right);
        MemeLaunchV1.LaunchParameters memory parameters =
            _parameters("Metadata", "META", 100, keccak256(extraData), extraData);
        MemeLaunchV1.LaunchResult memory result = _launchAs(creator, parameters);

        (string memory description, string memory website, string memory image, bytes memory storedExtraData) =
            UERC20(result.token).metadata();

        assertEq(description, parameters.metadata.description);
        assertEq(website, parameters.metadata.website);
        assertEq(image, parameters.metadata.image);
        assertEq(storedExtraData, extraData);
        assertGt(storedExtraData.length, 0);
    }

    function test_unregisteredPoolCannotBeClaimedAndPermissionlessClaimCannotRedirect() public {
        bytes32 unregisteredPoolId = keccak256("unregistered-classic-pool");
        vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV1.PoolNotRegistered.selector, unregisteredPoolId));
        feeHook.claimCreatorFees(unregisteredPoolId);

        MemeLaunchV1.LaunchResult memory result =
            _launchAs(creator, _parameters("Claims", "CLM", 100, bytes32(uint256(31)), hex"31"));
        _buy(result.token, 0.1 ether);

        (,,,, uint256 creatorFee) = feeHook.poolFeeConfig(result.poolId);
        uint256 accountedBefore = feeHook.totalNativeFeesAccrued();
        address attacker = makeAddr("claimRedirectAttacker");
        uint256 creatorBalanceBefore = creator.balance;

        vm.prank(attacker);
        feeHook.claimCreatorFees(result.poolId);

        assertGt(creatorFee, 0);
        assertEq(creator.balance, creatorBalanceBefore + creatorFee);
        assertEq(attacker.balance, 0);
        assertEq(feeHook.totalNativeFeesAccrued(), accountedBefore - creatorFee);

        vm.expectRevert(abi.encodeWithSelector(EthCreatorFeeHookV1.PoolNotRegistered.selector, unregisteredPoolId));
        vm.prank(attacker);
        feeHook.claimCreatorFees(unregisteredPoolId);
        assertEq(feeHook.totalNativeFeesAccrued(), accountedBefore - creatorFee);
    }

    function test_hookPermissionsAreExactAndExternalCallersCannotInvokeFundMovingCallbacks() public {
        Hooks.Permissions memory permissions = feeHook.getHookPermissions();
        assertTrue(permissions.beforeInitialize);
        assertTrue(permissions.beforeSwap);
        assertTrue(permissions.afterSwap);
        assertTrue(permissions.beforeSwapReturnDelta);
        assertTrue(permissions.afterSwapReturnDelta);
        assertFalse(permissions.afterInitialize);
        assertFalse(permissions.beforeAddLiquidity);
        assertFalse(permissions.afterAddLiquidity);
        assertFalse(permissions.beforeRemoveLiquidity);
        assertFalse(permissions.afterRemoveLiquidity);
        assertFalse(permissions.beforeDonate);
        assertFalse(permissions.afterDonate);
        assertFalse(permissions.afterAddLiquidityReturnDelta);
        assertFalse(permissions.afterRemoveLiquidityReturnDelta);

        MemeLaunchV1.LaunchResult memory result =
            _launchAs(creator, _parameters("Callbacks", "CALL", 100, bytes32(uint256(41)), hex"41"));
        PoolKey memory key = launcher.poolKey(result.token);
        SwapParams memory swapParams = SwapParams({
            zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        });
        uint160 initialSqrtPriceX96 = TickMath.getSqrtPriceAtTick(launcher.INITIAL_TICK());

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        feeHook.beforeInitialize(address(launcher), key, initialSqrtPriceX96);

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        feeHook.beforeSwap(address(swapRouter), key, swapParams, "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        feeHook.afterSwap(address(swapRouter), key, swapParams, BalanceDeltaLibrary.ZERO_DELTA, "");

        vm.expectRevert(BaseHook.NotPoolManager.selector);
        feeHook.unlockCallback(abi.encode(creator, 1));

        vm.expectRevert(abi.encodeWithSelector(MemeLaunchV1.UnauthorizedUnlockCallback.selector, address(this)));
        launcher.unlockCallback("");
    }

    function test_creatorClaimBlocksReceiveReentrancyWithoutBlockingPayout() public {
        ClassicReentrantCreator reentrantCreator = new ClassicReentrantCreator();
        MemeLaunchV1.LaunchResult memory result = reentrantCreator.launch{ value: MIN_INITIAL_BUY_WEI }(
            launcher, _parameters("Reentrant Creator", "RENT", 100, bytes32(uint256(51)), hex"51")
        );
        _buy(result.token, 0.1 ether);

        (,,,, uint256 creatorFee) = feeHook.poolFeeConfig(result.poolId);
        assertGt(creatorFee, 0);
        reentrantCreator.arm(feeHook, result.poolId);

        feeHook.claimCreatorFees(result.poolId);

        assertEq(reentrantCreator.receivedNative(), creatorFee);
        assertTrue(reentrantCreator.reentryAttempted());
        assertFalse(reentrantCreator.reentrySucceeded());
        assertEq(reentrantCreator.reentryError(), ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        (,,,, uint256 remainingCreatorFees) = feeHook.poolFeeConfig(result.poolId);
        assertEq(remainingCreatorFees, 0);
    }

    function _deployHook() private returns (EthCreatorFeeHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(EthCreatorFeeHookV1).creationCode,
            abi.encode(manager, launcherTreasury)
        );
        deployed = hookFactory.deploy(salt, manager, launcherTreasury);
    }

    function _launchAs(address caller, MemeLaunchV1.LaunchParameters memory parameters)
        private
        returns (MemeLaunchV1.LaunchResult memory result)
    {
        vm.deal(caller, MIN_INITIAL_BUY_WEI);
        vm.prank(caller);
        result = launcher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
    }

    function _buy(address token, uint256 grossNativeInput) private {
        address trader = makeAddr(string.concat("classicTrader", vm.toString(token)));
        vm.deal(trader, grossNativeInput);
        vm.prank(trader);
        swapRouter.swap{ value: grossNativeInput }(
            launcher.poolKey(token),
            SwapParams({
                zeroForOne: true,
                // The caller bounds this amount to the funded test balance.
                // forge-lint: disable-next-line(unsafe-typecast)
                amountSpecified: -int256(grossNativeInput),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
    }

    function _parameters(
        string memory name,
        string memory symbol,
        uint16 totalSwapFeeBps,
        bytes32 creatorSalt,
        bytes memory extraData
    ) private pure returns (MemeLaunchV1.LaunchParameters memory parameters) {
        parameters = MemeLaunchV1.LaunchParameters({
            name: name,
            symbol: symbol,
            totalSwapFeeBps: totalSwapFeeBps,
            creatorSalt: creatorSalt,
            metadata: UERC20Metadata({
                description: "A fixed-supply Classic launch",
                website: "https://example.invalid/classic",
                image: "ipfs://classic-image",
                extraData: extraData
            })
        });
    }
}
