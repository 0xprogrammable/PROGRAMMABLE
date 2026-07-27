// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { IV4Quoter } from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import { Test } from "forge-std/Test.sol";

import { DeployMainnetMemeInfrastructureV1 } from "../script/DeployMainnetMemeInfrastructureV1.s.sol";
import { EthCreatorFeeHookV1 } from "../src/EthCreatorFeeHookV1.sol";
import { MemeLaunchV1 } from "../src/MemeLaunchV1.sol";

interface IMainnetUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2Allowance {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IMainnetStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/// @dev Current official Universal Router layout. `minHopPriceX36` was added after the original v2.0 layout.
struct ExactInputSingleParams {
    PoolKey poolKey;
    bool zeroForOne;
    uint128 amountIn;
    uint128 amountOutMinimum;
    uint256 minHopPriceX36;
    bytes hookData;
}

contract MainnetMemeLifecycleForkTest is Test {
    using CurrencyLibrary for Currency;

    uint256 internal constant SNAPSHOT_BLOCK = 25_612_664;
    uint256 internal constant BUY_AMOUNT = 0.01 ether;
    uint256 internal constant MIN_INITIAL_BUY_WEI = 0.0006 ether;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;
    uint8 internal constant UR_V4_SWAP = 0x10;

    address internal constant DEPLOYER = 0xdEcAf00000000000000000000000000000000001;
    address internal constant TREASURY = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address internal constant STATE_VIEW = 0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227;
    address internal constant V4_QUOTER = 0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant UNIVERSAL_ROUTER = 0xd92A36B0000531EF3063dEd4De20A0783308446C;

    IPoolManager internal poolManager;
    IPositionManager internal positionManager;
    EthCreatorFeeHookV1 internal feeHook;
    MemeLaunchV1 internal memeLauncher;

    address internal creator;
    address internal trader;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        vm.deal(DEPLOYER, 100 ether);
        DeployMainnetMemeInfrastructureV1 deployment = new DeployMainnetMemeInfrastructureV1();
        DeployMainnetMemeInfrastructureV1.DeploymentResult memory infrastructure =
            deployment.deployReviewed(DEPLOYER, 0, TREASURY);

        poolManager = IPoolManager(POOL_MANAGER);
        positionManager = IPositionManager(POSITION_MANAGER);
        feeHook = infrastructure.feeHook;
        memeLauncher = infrastructure.memeLauncher;
        creator = makeAddr("mainnetForkMemeCreator");
        trader = makeAddr("mainnetForkMemeTrader");
        vm.deal(creator, 1 ether);
        vm.deal(trader, 10 ether);
    }

    function test_fullMainnetForkLifecycleUsesCurrentOfficialRouterAndLeavesLockedCustody() public {
        MemeLaunchV1.LaunchResult memory launchResult = _launch();
        PoolKey memory key = memeLauncher.poolKey(launchResult.token);

        _assertLaunchState(launchResult, key);

        uint256 quotedBuyOutput = _quoteExactInput(key, true, BUY_AMOUNT);
        uint256 minimumBuyOutput = (quotedBuyOutput * 99) / 100;
        uint256 traderTokensBefore = IERC20(launchResult.token).balanceOf(trader);
        _executeExactInput(trader, key, true, _asUint128(BUY_AMOUNT), _asUint128(minimumBuyOutput), BUY_AMOUNT);
        uint256 traderTokensAfterBuy = IERC20(launchResult.token).balanceOf(trader);
        assertGe(traderTokensAfterBuy - traderTokensBefore, minimumBuyOutput, "buy slippage bound");

        uint256 sellAmount = traderTokensAfterBuy / 2;
        vm.startPrank(trader);
        assertTrue(IERC20(launchResult.token).approve(PERMIT2, type(uint256).max));
        IPermit2Allowance(PERMIT2).approve(launchResult.token, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        vm.stopPrank();

        uint256 quotedSellOutput = _quoteExactInput(key, false, sellAmount);
        uint256 minimumSellOutput = (quotedSellOutput * 99) / 100;
        uint256 traderEthBeforeSell = trader.balance;
        _executeExactInput(trader, key, false, _asUint128(sellAmount), _asUint128(minimumSellOutput), 0);
        assertGe(trader.balance - traderEthBeforeSell, minimumSellOutput, "sell slippage bound");
        assertEq(
            IERC20(launchResult.token).balanceOf(trader), traderTokensAfterBuy - sellAmount, "router token settlement"
        );

        _assertAccruedNativeFees(launchResult);
        _claimAndAssertPayouts(launchResult.poolId);
        _assertPermanentCustodyAndResiduals(launchResult);
    }

    function _launch() private returns (MemeLaunchV1.LaunchResult memory result) {
        MemeLaunchV1.LaunchParameters memory parameters = MemeLaunchV1.LaunchParameters({
            name: "Programmable Mainnet Fork Fixture",
            symbol: "PMFF",
            totalSwapFeeBps: 100,
            creatorSalt: keccak256("programmable-mainnet-fork-lifecycle-v1"),
            metadata: UERC20Metadata({
                description: "Pinned Mainnet fork lifecycle fixture",
                website: "https://programmable.family",
                image: "",
                extraData: ""
            })
        });

        vm.prank(creator);
        result = memeLauncher.launch{ value: MIN_INITIAL_BUY_WEI }(parameters);
    }

    function _assertLaunchState(MemeLaunchV1.LaunchResult memory result, PoolKey memory key) private view {
        assertGt(result.token.code.length, 0);
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        assertEq(memeLauncher.launchHashOf(result.token), result.launchHash);
        assertEq(result.tokenLiquidityAmount + result.lockedTokenDust, memeLauncher.TOKEN_SUPPLY());

        UERC20 token = UERC20(result.token);
        assertEq(token.totalSupply(), memeLauncher.TOKEN_SUPPLY());
        assertEq(token.creator(), address(memeLauncher));
        assertEq(result.initialBuyNativeAmount, MIN_INITIAL_BUY_WEI);
        assertEq(token.balanceOf(creator), result.initialBuyTokenAmount);
        assertGt(result.initialBuyTokenAmount, 0);
        assertEq(token.balanceOf(address(memeLauncher)), 0);
        assertEq(token.balanceOf(POSITION_MANAGER), 0);

        (address feeCreator, address registrar, uint16 feeBps, bool registered, uint256 accrued) =
            feeHook.poolFeeConfig(result.poolId);
        assertEq(feeCreator, creator);
        assertEq(registrar, address(memeLauncher));
        assertEq(feeBps, 100);
        assertTrue(registered);
        assertGt(accrued, 0);

        (uint160 sqrtPriceX96,,, uint24 lpFee) = IMainnetStateView(STATE_VIEW).getSlot0(result.poolId);
        assertGt(sqrtPriceX96, 0);
        assertEq(lpFee, 0);
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
        assertGt(amountOut, 0, "official V4Quoter returned zero");
    }

    function _executeExactInput(
        address caller,
        PoolKey memory key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        uint256 value
    ) private {
        ExactInputSingleParams memory swap = ExactInputSingleParams({
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
        actionParameters[1] = abi.encode(zeroForOne ? address(0) : Currency.unwrap(key.currency1), uint256(amountIn));
        actionParameters[2] =
            abi.encode(zeroForOne ? Currency.unwrap(key.currency1) : address(0), uint256(amountOutMinimum));

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, actionParameters);

        vm.prank(caller);
        IMainnetUniversalRouter(UNIVERSAL_ROUTER).execute{ value: value }(
            abi.encodePacked(UR_V4_SWAP), inputs, block.timestamp + 1 hours
        );
    }

    function _assertAccruedNativeFees(MemeLaunchV1.LaunchResult memory result) private view {
        (,,,, uint256 creatorFees) = feeHook.poolFeeConfig(result.poolId);
        uint256 launcherFees = feeHook.launcherFeesAccrued();
        uint256 totalFees = feeHook.totalNativeFeesAccrued();

        assertGt(creatorFees, 0);
        assertGt(launcherFees, 0);
        assertEq(totalFees, creatorFees + launcherFees);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(address(0)).toId()), totalFees);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(result.token).toId()), 0);
        assertEq(address(feeHook).balance, 0);
    }

    function _claimAndAssertPayouts(bytes32 poolId) private {
        (,,,, uint256 creatorFees) = feeHook.poolFeeConfig(poolId);
        uint256 launcherFees = feeHook.launcherFeesAccrued();
        uint256 creatorBefore = creator.balance;
        uint256 treasuryBefore = TREASURY.balance;
        address keeper = makeAddr("mainnetForkClaimKeeper");

        vm.prank(keeper);
        feeHook.claimCreatorFees(poolId);
        vm.prank(keeper);
        feeHook.claimLauncherFees();

        assertEq(creator.balance, creatorBefore + creatorFees);
        assertEq(TREASURY.balance, treasuryBefore + launcherFees);
        assertEq(feeHook.totalNativeFeesAccrued(), 0);
        assertEq(feeHook.launcherFeesAccrued(), 0);
        (,,,, uint256 creatorFeesAfter) = feeHook.poolFeeConfig(poolId);
        assertEq(creatorFeesAfter, 0);
        assertEq(poolManager.balanceOf(address(feeHook), Currency.wrap(address(0)).toId()), 0);
    }

    function _assertPermanentCustodyAndResiduals(MemeLaunchV1.LaunchResult memory result) private view {
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));

        assertEq(IERC721(POSITION_MANAGER).ownerOf(result.positionTokenId), result.positionRecipient);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(address(forwarder.positionManager()), POSITION_MANAGER);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertEq(IERC20(result.token).balanceOf(result.positionRecipient), result.lockedTokenDust, "locked token dust");
        assertEq(IERC20(result.token).balanceOf(address(memeLauncher)), 0);
        assertEq(IERC20(result.token).balanceOf(POSITION_MANAGER), 0);
        assertEq(IERC20(result.token).balanceOf(address(feeHook)), 0);
        assertEq(address(memeLauncher).balance, 0);
        assertEq(address(feeHook).balance, 0);
    }

    function _asUint128(uint256 value) private pure returns (uint128 narrowed) {
        require(value <= type(uint128).max, "uint128 overflow");
        // The explicit bound above makes this narrowing conversion lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        narrowed = uint128(value);
    }
}
