// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { Test } from "forge-std/Test.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "../src/AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "../src/AdaptiveCurveFeeHookV1.sol";
import { AdaptiveCurveLaunchV1 } from "../src/AdaptiveCurveLaunchV1.sol";
import { AdaptiveCurvePositionPlannerV1 } from "../src/AdaptiveCurvePositionPlannerV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

interface IAdaptiveLaunchUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IAdaptiveLaunchPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IAdaptiveLaunchStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

struct AdaptiveLaunchExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

contract AdaptiveCurveLaunchMainnetForkTest is Test {
    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    uint256 internal constant BUY_AMOUNT = 0.003 ether;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;
    uint8 internal constant UR_V4_SWAP = 0x10;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address internal constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    IPoolManager internal poolManager;
    IPositionManager internal positionManager;
    AdaptiveCurveFeeHookFactoryV1 internal hookFactory;
    AdaptiveCurvePositionPlannerV1 internal positionPlanner;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    AdaptiveCurveLaunchV1 internal launcher;

    address internal creator;
    address internal launcherTreasury;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        poolManager = IPoolManager(POOL_MANAGER);
        positionManager = IPositionManager(POSITION_MANAGER);
        hookFactory = new AdaptiveCurveFeeHookFactoryV1();
        positionPlanner = new AdaptiveCurvePositionPlannerV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        launcherTreasury = makeAddr("adaptiveLaunchForkTreasury");
        launcher = new AdaptiveCurveLaunchV1(
            poolManager,
            positionManager,
            UERC20Factory(UERC20_FACTORY),
            hookFactory,
            positionPlanner,
            positionForwarderFactory,
            launcherTreasury
        );

        creator = makeAddr("adaptiveLaunchForkCreator");
        vm.deal(creator, 10 ether);
    }

    function test_atomicLaunchWorksWithOfficialMainnetDeploymentAndEmptyHookDataTrading() public {
        AdaptiveCurveLaunchV1.LaunchParameters memory parameters = _parameters();

        vm.prank(creator);
        AdaptiveCurveLaunchV1.LaunchResult memory result = launcher.launch(abi.encode(parameters));
        AdaptiveCurveFeeHookV1 hook = AdaptiveCurveFeeHookV1(result.feeHook);
        PoolKey memory key = launcher.poolKey(result.token, result.feeHook);

        (uint160 sqrtPriceBefore, int24 tickBefore,, uint24 lpFee) =
            IAdaptiveLaunchStateView(STATE_VIEW).getSlot0(result.poolId);
        assertGt(sqrtPriceBefore, 0);
        assertEq(tickBefore, launcher.INITIAL_TICK());
        assertEq(lpFee, 0);
        assertEq(result.initialBuyNativeAmount, 0);
        assertEq(result.initialBuyTokenAmount, 0);
        assertEq(address(launcher).balance, 0);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(IERC20(result.token).balanceOf(POSITION_MANAGER), 0);

        _tradeAndClaim(result, key, hook);
    }

    function _tradeAndClaim(
        AdaptiveCurveLaunchV1.LaunchResult memory result,
        PoolKey memory key,
        AdaptiveCurveFeeHookV1 hook
    ) private {
        uint256 quotedBuyOutput = _quoteExactInput(key, true, BUY_AMOUNT);
        uint256 minimumBuyOutput = (quotedBuyOutput * 99) / 100;
        _executeExactInput(key, creator, result.token, true, BUY_AMOUNT, minimumBuyOutput, BUY_AMOUNT);
        uint256 creatorTokens = IERC20(result.token).balanceOf(creator);
        assertGe(creatorTokens, minimumBuyOutput);

        vm.startPrank(creator);
        assertTrue(IERC20(result.token).approve(PERMIT2, type(uint256).max));
        IAdaptiveLaunchPermit2(PERMIT2).approve(result.token, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();

        uint256 sellAmount = creatorTokens / 3;
        uint256 quotedSellOutput = _quoteExactInput(key, false, sellAmount);
        uint256 minimumSellOutput = (quotedSellOutput * 99) / 100;
        uint256 creatorEthBefore = creator.balance;
        _executeExactInput(key, creator, result.token, false, sellAmount, minimumSellOutput, 0);
        assertGe(creator.balance - creatorEthBefore, minimumSellOutput);

        (,,,,,, uint256 creatorFees) = hook.poolFeeConfig(result.poolId);
        uint256 launcherFees = hook.launcherFeesAccrued();
        assertGt(creatorFees, 0);
        assertGt(launcherFees, 0);
        assertEq(hook.totalNativeFeesAccrued(), creatorFees + launcherFees);

        uint256 claimCreatorBefore = creator.balance;
        uint256 treasuryBefore = launcherTreasury.balance;
        vm.prank(creator);
        hook.claimCreatorFees(result.poolId);
        hook.claimLauncherFees();
        assertEq(creator.balance, claimCreatorBefore + creatorFees);
        assertEq(launcherTreasury.balance, treasuryBefore + launcherFees);
        assertEq(hook.totalNativeFeesAccrued(), 0);
    }

    function _parameters() private view returns (AdaptiveCurveLaunchV1.LaunchParameters memory parameters) {
        bytes32 creatorSalt = keccak256("programmable-adaptive-launch-mainnet-fork-v1");
        int24[] memory indexes = new int24[](4);
        indexes[0] = launcher.MIN_FDV_INDEX();
        indexes[1] = -204_200;
        indexes[2] = -160_000;
        indexes[3] = launcher.MAX_FDV_INDEX();

        uint16[] memory fees = new uint16[](4);
        fees[0] = 500;
        fees[1] = 500;
        fees[2] = 200;
        fees[3] = 100;

        parameters = AdaptiveCurveLaunchV1.LaunchParameters({
            name: "Programmable Adaptive Fork Launch",
            symbol: "PAFL",
            creatorSalt: creatorSalt,
            metadata: UERC20Metadata({
                description: "Official mainnet deployment integration fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            }),
            curve: AdaptiveCurveLaunchV1.CurveConfiguration({
                hookSaltNonce: _mineHookSaltNonce(creator, creatorSalt), fdvIndexes: indexes, totalSwapFeeBps: fees
            })
        });
    }

    function _mineHookSaltNonce(address creator_, bytes32 creatorSalt_) private view returns (bytes32 nonce) {
        uint160 requiredFlags = hookFactory.REQUIRED_HOOK_FLAGS();
        uint160 allFlags = hookFactory.ALL_HOOK_MASK();
        for (uint256 candidate;; ++candidate) {
            nonce = bytes32(candidate);
            address predicted = launcher.predictFeeHook(creator_, creatorSalt_, nonce);
            if ((uint160(predicted) & allFlags) == requiredFlags) return nonce;
        }
    }

    function _quoteExactInput(PoolKey memory key, bool zeroForOne, uint256 amountIn)
        private
        returns (uint256 amountOut)
    {
        (amountOut,) = IV4Quoter(V4_QUOTER)
            .quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: _asUint128(amountIn), hookData: ""
            })
            );
        assertGt(amountOut, 0);
    }

    function _executeExactInput(
        PoolKey memory key,
        address caller,
        address token,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint256 value
    ) private {
        AdaptiveLaunchExactInputSingleParams memory swap = AdaptiveLaunchExactInputSingleParams({
            poolKey: key,
            zeroForOne: zeroForOne,
            amountIn: _asUint128(amountIn),
            amountOutMinimum: _asUint128(amountOutMinimum),
            minHopPriceX36: 0,
            hookData: ""
        });

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(swap);
        actionParameters[1] = abi.encode(zeroForOne ? address(0) : token, amountIn);
        actionParameters[2] = abi.encode(zeroForOne ? token : address(0), amountOutMinimum);

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParameters);

        vm.prank(caller);
        IAdaptiveLaunchUniversalRouter(UNIVERSAL_ROUTER).execute{ value: value }(
            abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + 1 hours
        );
    }

    function _asUint128(uint256 value) private pure returns (uint128 narrowed) {
        require(value <= type(uint128).max, "uint128 overflow");
        // forge-lint: disable-next-line(unsafe-typecast)
        narrowed = uint128(value);
    }
}
