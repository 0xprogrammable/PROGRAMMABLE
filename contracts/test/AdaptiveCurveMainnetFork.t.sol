// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { AdaptiveCurveFeeHookFactoryV1 } from "../src/AdaptiveCurveFeeHookFactoryV1.sol";
import { AdaptiveCurveFeeHookV1 } from "../src/AdaptiveCurveFeeHookV1.sol";

interface IAdaptiveMainnetUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IAdaptivePermit2Allowance {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IAdaptiveMainnetStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

struct AdaptiveExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

contract AdaptiveCurveMainnetForkTest is Test {
    using CurrencyLibrary for Currency;

    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    uint256 internal constant FIXED_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant BUY_AMOUNT = 0.01 ether;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;
    uint8 internal constant UR_V4_SWAP = 0x10;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address internal constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;
    address internal constant UERC20_FACTORY = 0x000000e200088D55C39a11F609E5F667729ad49b;

    IPoolManager internal poolManager;
    PoolModifyLiquidityTest internal liquidityRouter;
    AdaptiveCurveFeeHookFactoryV1 internal hookFactory;
    AdaptiveCurveFeeHookV1 internal hook;
    UERC20 internal token;
    PoolKey internal key;
    bytes32 internal poolId;

    address internal creatorRecipient;
    address internal launcherTreasury;
    address internal trader;

    receive() external payable { }

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        vm.deal(address(this), 10_000 ether);
        creatorRecipient = makeAddr("adaptiveForkCreator");
        launcherTreasury = makeAddr("adaptiveForkTreasury");
        trader = makeAddr("adaptiveForkTrader");
        vm.deal(trader, 10 ether);

        poolManager = IPoolManager(POOL_MANAGER);
        liquidityRouter = new PoolModifyLiquidityTest(poolManager);
        hookFactory = new AdaptiveCurveFeeHookFactoryV1();
        hook = _deployHook();
        token = UERC20(_createOfficialToken());
        assertEq(token.creator(), address(this));
        assertEq(token.totalSupply(), FIXED_SUPPLY);

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        (int24[] memory indexes, uint16[] memory fees) = _curve();
        poolId = hook.registerPool(key, creatorRecipient, indexes, fees);
        poolManager.initialize(key, uint160(1 << 96));

        assertTrue(token.approve(address(liquidityRouter), type(uint256).max));
        liquidityRouter.modifyLiquidity{ value: 1000 ether }(
            key,
            ModifyLiquidityParams({
                tickLower: -20_000, tickUpper: 20_000, liquidityDelta: 1000 ether, salt: bytes32(0)
            }),
            ""
        );
    }

    function test_officialMainnetPoolManagerQuoterRouterAndStateViewSupportAdaptiveCurve() public {
        (uint160 sqrtPriceBefore, int24 tickBefore,, uint24 lpFee) =
            IAdaptiveMainnetStateView(STATE_VIEW).getSlot0(poolId);
        assertGt(sqrtPriceBefore, 0);
        assertEq(tickBefore, 0);
        assertEq(lpFee, 0);

        uint256 quotedBuyOutput = _quoteExactInput(true, BUY_AMOUNT);
        uint256 minimumBuyOutput = (quotedBuyOutput * 99) / 100;
        _executeExactInput(trader, true, _asUint128(BUY_AMOUNT), _asUint128(minimumBuyOutput), BUY_AMOUNT);
        uint256 traderTokens = token.balanceOf(trader);
        assertGe(traderTokens, minimumBuyOutput);

        vm.startPrank(trader);
        assertTrue(token.approve(PERMIT2, type(uint256).max));
        IAdaptivePermit2Allowance(PERMIT2)
            .approve(address(token), UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();

        uint256 sellAmount = traderTokens / 2;
        uint256 quotedSellOutput = _quoteExactInput(false, sellAmount);
        uint256 minimumSellOutput = (quotedSellOutput * 99) / 100;
        uint256 traderEthBefore = trader.balance;
        _executeExactInput(trader, false, _asUint128(sellAmount), _asUint128(minimumSellOutput), 0);
        assertGe(trader.balance - traderEthBefore, minimumSellOutput);

        (,,,,,, uint256 creatorFees) = hook.poolFeeConfig(poolId);
        uint256 launcherFees = hook.launcherFeesAccrued();
        assertGt(creatorFees, 0);
        assertGt(launcherFees, 0);
        assertEq(hook.totalNativeFeesAccrued(), creatorFees + launcherFees);
        assertEq(poolManager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()), creatorFees + launcherFees);
        assertEq(poolManager.balanceOf(address(hook), key.currency1.toId()), 0);

        uint256 creatorBefore = creatorRecipient.balance;
        uint256 treasuryBefore = launcherTreasury.balance;
        hook.claimCreatorFees(poolId);
        hook.claimLauncherFees();
        assertEq(creatorRecipient.balance, creatorBefore + creatorFees);
        assertEq(launcherTreasury.balance, treasuryBefore + launcherFees);
        assertEq(hook.totalNativeFeesAccrued(), 0);
    }

    function _createOfficialToken() private returns (address tokenAddress) {
        UERC20Metadata memory metadata = UERC20Metadata({
            description: "Adaptive Curve mainnet fork fixture",
            website: "https://programmable.family",
            image: "",
            extraData: ""
        });
        tokenAddress = UERC20Factory(UERC20_FACTORY)
            .createToken(
                "Programmable Adaptive Fork",
                "PAF",
                18,
                FIXED_SUPPLY,
                address(this),
                abi.encode(metadata),
                keccak256("programmable-adaptive-curve-mainnet-fork-v1")
            );
    }

    function _deployHook() private returns (AdaptiveCurveFeeHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(AdaptiveCurveFeeHookV1).creationCode,
            abi.encode(poolManager, launcherTreasury)
        );
        deployed = hookFactory.deploy(salt, poolManager, launcherTreasury);
    }

    function _curve() private view returns (int24[] memory indexes, uint16[] memory fees) {
        indexes = new int24[](5);
        indexes[0] = hook.MIN_FDV_INDEX();
        indexes[1] = -10_000;
        indexes[2] = 0;
        indexes[3] = 10_000;
        indexes[4] = hook.MAX_FDV_INDEX();

        fees = new uint16[](5);
        fees[0] = 1000;
        fees[1] = 800;
        fees[2] = 500;
        fees[3] = 300;
        fees[4] = 100;
    }

    function _quoteExactInput(bool zeroForOne, uint256 amountIn) private returns (uint256 amountOut) {
        (amountOut,) = IV4Quoter(V4_QUOTER)
            .quoteExactInputSingle(
                IV4Quoter.QuoteExactSingleParams({
                poolKey: key, zeroForOne: zeroForOne, exactAmount: _asUint128(amountIn), hookData: ""
            })
            );
        assertGt(amountOut, 0);
    }

    function _executeExactInput(
        address caller,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        uint256 value
    ) private {
        AdaptiveExactInputSingleParams memory swap = AdaptiveExactInputSingleParams({
            poolKey: key,
            zeroForOne: zeroForOne,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            minHopPriceX36: 0,
            hookData: ""
        });

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory actionParameters = new bytes[](3);
        actionParameters[0] = abi.encode(swap);
        actionParameters[1] = abi.encode(zeroForOne ? address(0) : address(token), uint256(amountIn));
        actionParameters[2] = abi.encode(zeroForOne ? address(token) : address(0), uint256(amountOutMinimum));

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParameters);

        vm.prank(caller);
        IAdaptiveMainnetUniversalRouter(UNIVERSAL_ROUTER).execute{ value: value }(
            abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + 1 hours
        );
    }

    function _asUint128(uint256 value) private pure returns (uint128 narrowed) {
        require(value <= type(uint128).max, "uint128 overflow");
        // The bound above makes the conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        narrowed = uint128(value);
    }
}
