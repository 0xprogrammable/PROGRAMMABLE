// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionDescriptor } from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IWETH9 } from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "../src/AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "../src/AdaptiveCurveFeeHookV1.sol";
import { AdaptiveCurveLaunchV1 } from "../src/AdaptiveCurveLaunchV1.sol";
import { AdaptiveCurvePositionPlannerV1 } from "../src/AdaptiveCurvePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract AdaptivePlannerImpostor { }

contract AdaptiveCurveLaunchV1Test is Deployers {
    using StateLibrary for IPoolManager;

    bytes32 internal constant CREATOR_SALT = keccak256("adaptive-launch-fixture");

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    AdaptiveCurveFeeHookFactoryV1 internal hookFactory;
    AdaptiveCurvePositionPlannerV1 internal positionPlanner;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    AdaptiveCurveLaunchV1 internal launcher;

    address internal creator;
    address internal launcherTreasury;
    bytes32 internal hookSalt;

    function setUp() public {
        deployFreshManagerAndRouters();
        positionManager = IPositionManager(
            address(
                new PositionManager(
                    manager,
                    IAllowanceTransfer(address(0)),
                    uint256(0),
                    IPositionDescriptor(address(0)),
                    IWETH9(address(0))
                )
            )
        );

        tokenFactory = new UERC20Factory();
        hookFactory = new AdaptiveCurveFeeHookFactoryV1();
        positionPlanner = new AdaptiveCurvePositionPlannerV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        launcherTreasury = makeAddr("adaptiveLauncherTreasury");
        launcher = new AdaptiveCurveLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            hookFactory,
            positionPlanner,
            positionForwarderFactory,
            launcherTreasury
        );

        creator = makeAddr("adaptiveCreator");
        vm.deal(creator, 10 ether);
        hookSalt = _mineHookSalt();
    }

    function test_launchesWithoutLiquidityDepositOrInitialBuyAndRecordsCompleteProvenance() public {
        AdaptiveCurveLaunchV1.LaunchParameters memory parameters = _parameters();
        (address predictedToken, bytes32 graffiti) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        address predictedHook = launcher.predictFeeHook(hookSalt);

        AdaptiveCurveLaunchV1.LaunchResult memory result = _launch(parameters, 0);
        AdaptiveCurveLaunchV1.LaunchRecord memory record = launcher.launchRecord(result.token);
        AdaptiveCurveFeeHookV1 hook = AdaptiveCurveFeeHookV1(result.feeHook);
        PoolKey memory key = launcher.poolKey(result.token, result.feeHook);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(result.token, predictedToken);
        assertEq(result.feeHook, predictedHook);
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(result.initialBuyNativeAmount, 0);
        assertEq(result.initialBuyTokenAmount, 0);
        assertEq(result.launchHash, launcher.launchHashOf(result.token));
        assertEq(launcher.tokenOfHook(result.feeHook), result.token);
        assertEq(address(launcher).balance, 0);

        assertEq(UERC20(result.token).creator(), address(launcher));
        assertEq(UERC20(result.token).graffiti(), graffiti);
        assertEq(IERC20(result.token).totalSupply(), launcher.TOKEN_SUPPLY());
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);

        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertTrue(positionForwarderFactory.isFactoryForwarder(result.positionRecipient));
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        (
            address feeCreator,
            address registrar,
            uint256 fixedSupply,
            bytes32 curveHash,
            uint8 curvePointCount,
            bool registered,
            uint256 creatorFees
        ) = hook.poolFeeConfig(result.poolId);
        assertEq(feeCreator, creator);
        assertEq(registrar, address(launcher));
        assertEq(fixedSupply, launcher.TOKEN_SUPPLY());
        assertEq(curveHash, result.curveHash);
        assertEq(curvePointCount, 4);
        assertTrue(registered);
        assertEq(creatorFees, 0);
        assertTrue(hookFactory.isFactoryHook(result.feeHook));

        assertEq(record.creator, creator);
        assertEq(record.feeHook, result.feeHook);
        assertEq(record.positionRecipient, result.positionRecipient);
        assertEq(record.positionTokenId, result.positionTokenId);
        assertEq(record.poolId, result.poolId);
        assertEq(record.curveHash, result.curveHash);
        assertTrue(record.metadataHash != bytes32(0));
        assertEq(record.launchHash, result.launchHash);

        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(key.toId());
        assertEq(sqrtPriceX96, TickMath.getSqrtPriceAtTick(launcher.INITIAL_TICK()));
        assertEq(tick, launcher.INITIAL_TICK());
    }

    function test_launcherPinsPlannerBytecodeAndMaintainsReleaseHeadroom() public view {
        assertEq(address(launcher.positionPlanner()), address(positionPlanner));
        assertEq(address(positionPlanner).codehash, keccak256(type(AdaptiveCurvePositionPlannerV1).runtimeCode));
        assertLe(address(launcher).code.length, 23_000);
    }

    function test_rejectsPlannerWithUnexpectedRuntimeBytecode() public {
        AdaptivePlannerImpostor impostor = new AdaptivePlannerImpostor();
        bytes32 actualCodeHash = address(impostor).codehash;
        bytes32 expectedCodeHash = keccak256(type(AdaptiveCurvePositionPlannerV1).runtimeCode);

        vm.expectRevert(
            abi.encodeWithSelector(
                AdaptiveCurveLaunchV1.InvalidPositionPlanner.selector,
                address(impostor),
                actualCodeHash,
                expectedCodeHash
            )
        );
        new AdaptiveCurveLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            hookFactory,
            AdaptiveCurvePositionPlannerV1(address(impostor)),
            positionForwarderFactory,
            launcherTreasury
        );
    }

    function test_optionalCreatorBuyExecutesAtomicallyAndLeavesNoCustody() public {
        uint256 buyAmount = 0.002 ether;
        uint256 creatorEthBefore = creator.balance;
        AdaptiveCurveLaunchV1.LaunchResult memory result = _launch(_parameters(), buyAmount);

        assertEq(result.initialBuyNativeAmount, buyAmount);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(IERC20(result.token).balanceOf(creator), result.initialBuyTokenAmount);
        assertEq(creator.balance, creatorEthBefore - buyAmount);
        assertEq(address(launcher).balance, 0);

        AdaptiveCurveFeeHookV1 hook = AdaptiveCurveFeeHookV1(result.feeHook);
        (,,,,,, uint256 creatorFees) = hook.poolFeeConfig(result.poolId);
        assertGt(creatorFees, 0);
        assertGt(hook.launcherFeesAccrued(), 0);
        assertEq(hook.totalNativeFeesAccrued(), creatorFees + hook.launcherFeesAccrued());
    }

    function test_firstPublicBuyWorksAfterAZeroBuyLaunch() public {
        AdaptiveCurveLaunchV1.LaunchResult memory result = _launch(_parameters(), 0);
        PoolKey memory key = launcher.poolKey(result.token, result.feeHook);
        PoolSwapTest router = new PoolSwapTest(manager);
        address trader = makeAddr("adaptiveTrader");
        vm.deal(trader, 1 ether);

        vm.prank(trader);
        router.swap{ value: 0.001 ether }(
            key,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.001 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );

        assertGt(IERC20(result.token).balanceOf(trader), 0);
        assertEq(address(launcher).balance, 0);
        assertEq(
            manager.balanceOf(result.feeHook, CurrencyLibrary.ADDRESS_ZERO.toId()),
            AdaptiveCurveFeeHookV1(result.feeHook).totalNativeFeesAccrued()
        );
    }

    function test_rejectsMalformedCurveBeforeDeployingAnyLaunchComponent() public {
        AdaptiveCurveLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.curve.fdvIndexes[0] = -100;
        (address token,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);
        address hook = launcher.predictFeeHook(parameters.curve.hookSalt);

        vm.expectRevert(
            abi.encodeWithSelector(
                AdaptiveCurveLaunchV1.InvalidCurveEndpoint.selector,
                int24(-100),
                launcher.MAX_FDV_INDEX(),
                launcher.MIN_FDV_INDEX(),
                launcher.MAX_FDV_INDEX()
            )
        );
        vm.prank(creator);
        launcher.launch(abi.encode(parameters));

        assertEq(token.code.length, 0);
        assertEq(hook.code.length, 0);
        assertEq(address(launcher).balance, 0);
    }

    function test_rejectsReusingAOneTokenHookAndKeepsSecondLaunchAtomic() public {
        _launch(_parameters(), 0);
        AdaptiveCurveLaunchV1.LaunchParameters memory second = _parameters();
        second.name = "Second Adaptive Token";
        second.symbol = "ADAPT2";
        second.creatorSalt = keccak256("second-adaptive-launch");
        (address secondToken,) = launcher.predictTokenAddress(second.name, second.symbol, creator, second.creatorSalt);

        vm.expectRevert(
            abi.encodeWithSelector(
                AdaptiveCurveLaunchV1.AlreadyAssignedHook.selector,
                launcher.predictFeeHook(hookSalt),
                launcher.tokenOfHook(launcher.predictFeeHook(hookSalt))
            )
        );
        vm.prank(creator);
        launcher.launch(abi.encode(second));

        assertEq(secondToken.code.length, 0);
        assertEq(launcher.launchHashOf(secondToken), bytes32(0));
    }

    function testFuzz_optionalBuyNeverLeavesNativeOrTokenCustody(uint96 rawBuy) public {
        uint256 buyAmount = bound(uint256(rawBuy), 0.0001 ether, 0.02 ether);
        AdaptiveCurveLaunchV1.LaunchResult memory result = _launch(_parameters(), buyAmount);

        assertEq(address(launcher).balance, 0);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(address(positionManager)), 0);
        assertGt(result.initialBuyTokenAmount, 0);
    }

    function testFuzz_rejectsEveryOutOfRangeFeeAtomically(uint16 fee) public {
        vm.assume(fee < launcher.MIN_TOTAL_SWAP_FEE_BPS() || fee > launcher.MAX_TOTAL_SWAP_FEE_BPS());
        AdaptiveCurveLaunchV1.LaunchParameters memory parameters = _parameters();
        parameters.curve.totalSwapFeeBps[1] = fee;
        (address token,) =
            launcher.predictTokenAddress(parameters.name, parameters.symbol, creator, parameters.creatorSalt);

        vm.expectRevert(abi.encodeWithSelector(AdaptiveCurveLaunchV1.InvalidTotalSwapFee.selector, fee));
        vm.prank(creator);
        launcher.launch(abi.encode(parameters));

        assertEq(token.code.length, 0);
        assertEq(launcher.predictFeeHook(hookSalt).code.length, 0);
    }

    function _launch(AdaptiveCurveLaunchV1.LaunchParameters memory parameters, uint256 value)
        private
        returns (AdaptiveCurveLaunchV1.LaunchResult memory result)
    {
        vm.prank(creator);
        result = launcher.launch{ value: value }(abi.encode(parameters));
    }

    function _parameters() private view returns (AdaptiveCurveLaunchV1.LaunchParameters memory parameters) {
        (int24[] memory indexes, uint16[] memory fees) = _curve();
        parameters = AdaptiveCurveLaunchV1.LaunchParameters({
            name: "Adaptive Launch Token",
            symbol: "ADAPT",
            creatorSalt: CREATOR_SALT,
            metadata: UERC20Metadata({
                description: "An immutable ETH-denominated adaptive v4 fee curve",
                website: "https://programmable.family",
                image: "ipfs://programmable-adaptive",
                extraData: bytes('{"x":"https://x.com/0xprogrammable"}')
            }),
            curve: AdaptiveCurveLaunchV1.CurveConfiguration({
                hookSalt: hookSalt, fdvIndexes: indexes, totalSwapFeeBps: fees
            })
        });
    }

    function _curve() private view returns (int24[] memory indexes, uint16[] memory fees) {
        indexes = new int24[](4);
        indexes[0] = launcher.MIN_FDV_INDEX();
        indexes[1] = -204_200;
        indexes[2] = -160_000;
        indexes[3] = launcher.MAX_FDV_INDEX();

        fees = new uint16[](4);
        fees[0] = 500;
        fees[1] = 500;
        fees[2] = 200;
        fees[3] = 100;
    }

    function _mineHookSalt() private view returns (bytes32 salt) {
        (, salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(AdaptiveCurveFeeHookV1).creationCode,
            abi.encode(manager, launcherTreasury)
        );
    }
}
