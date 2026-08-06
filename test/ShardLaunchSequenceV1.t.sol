// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { ShardErrorsV1 } from "../src/ShardErrorsV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";
import { ShardLaunchLib } from "./utils/ShardLaunchLib.sol";

/// @notice Atomic factory launch followed by the first batch purchase.
///
/// @dev These run against the CHEAP TESTNET tick pair, which is the production curve shifted
///      by a constant so the SHAPE is identical and only the scale changes. That matters:
///      a rehearsal on a differently-shaped curve proves nothing about the real one.
contract ShardLaunchSequenceV1Test is Test {
    /// @dev The production curve. Price at TICK_UPPER is ~0.001 ETH per NFT; the concentrated
    ///      band runs from TICK_BAND up to TICK_UPPER.
    int24 internal constant TICK_UPPER = 69_060;
    int24 internal constant TICK_BAND = 22_980;

    /// @dev The rehearsal curve: the same shape, shifted so a launch costs ~0.000001 ETH per
    ///      NFT. The tick DISTANCE between the two edges is identical to production's.
    int24 internal constant TESTNET_TICK_UPPER = 138_120;
    int24 internal constant TESTNET_TICK_BAND = 92_040;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    IPoolManager internal manager;
    ShardLaunchFactoryV1 internal factory;
    ShardTokenV1 internal shard;
    GeometricRendererV1 internal renderer;
    ShardHookV1 internal hook;
    ShardNFTV1 internal nft;

    address internal buyer = address(0xB0B);

    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");

    /// @dev Deploys and funds the hook but stops SHORT of setNFT and initialise — exactly the
    ///      state a deferred launch leaves behind.
    function _deployDeferred(int24 tickUpper, int24 tickBand) internal {
        int24 tickLower = TickMath.minUsableTick(ShardConstantsV1.TICK_SPACING);
        uint160 startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        manager = IPoolManager(address(new PoolManager(address(this))));
        shard = new ShardTokenV1();
        renderer = new GeometricRendererV1();

        (, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookV1).creationCode,
            abi.encode(
                manager, shard, tickLower, tickBand, tickUpper, startSqrtPriceX96, address(this), launcher, builder
            )
        );
        hook = new ShardHookV1{ salt: salt }(
            manager, shard, tickLower, tickBand, tickUpper, startSqrtPriceX96, address(this), launcher, builder
        );
        nft = new ShardNFTV1(address(hook), address(renderer));

        shard.transfer(address(hook), ShardConstantsV1.MAX_NFTS * ShardConstantsV1.SHARDS_PER_NFT);
        vm.deal(buyer, 100 ether);
    }

    function _launchAtomic(int24 tickUpper, int24 tickBand) internal {
        int24 tickLower = TickMath.minUsableTick(ShardConstantsV1.TICK_SPACING);
        uint160 startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, launcher, keccak256(type(ShardHookV1).creationCode));
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: tickLower,
            tickBand: tickBand,
            tickUpper: tickUpper,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) =
            ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardLaunchSequenceV1Test"), bytes32(0), params);
        renderer = factory.renderer();
        vm.deal(buyer, 100 ether);
    }

    /// @dev ETH per whole NFT, in wei, implied by a tick. The pool prices SHARD per ETH, so the
    ///      NFT price is the RECIPROCAL. Getting this backwards has already happened once here.
    function _ethPerNftWei(int24 tick) internal pure returns (uint256) {
        uint256 sqrtP = uint256(TickMath.getSqrtPriceAtTick(tick));
        // 1e18 * 2^192 / sqrtP^2 — shardPerEth is (sqrtP/2^96)^2, so invert it.
        return ((1e18 * (1 << 96)) / sqrtP) * (1 << 96) / sqrtP;
    }

    /*//////////////////////////////////////////////////////////
                        THE CHEAP TEST CURVE
    //////////////////////////////////////////////////////////*/

    function test_testnetTicksPriceTheLaunchAtAboutOneMillionthOfAnEth() public pure {
        uint256 price = _ethPerNftWei(TESTNET_TICK_UPPER);
        // 0.000001 ETH = 1e12 wei. Allow 1% either way for the spacing-60 rounding.
        assertApproxEqRel(price, 1e12, 0.01e18, "launch price is not ~0.000001 ETH");
    }

    function test_testnetBandEdgeKeepsTheProductionShape() public pure {
        // DERIVED from the production pair, not hardcoded at 100x: a hardcoded multiple would
        // still pass if production's own span were changed, which is exactly the divergence
        // this test exists to catch.
        uint256 prodSpan = (_ethPerNftWei(TICK_BAND) * 1e18) / _ethPerNftWei(TICK_UPPER);
        uint256 cheapSpan = (_ethPerNftWei(TESTNET_TICK_BAND) * 1e18) / _ethPerNftWei(TESTNET_TICK_UPPER);
        assertApproxEqRel(cheapSpan, prodSpan, 0.01e18, "rehearsal curve spans a different range than production");
    }

    function test_cheapCurveIsTheProductionCurveShiftedByAConstant() public pure {
        // Same tick DISTANCE between the two edges means the same liquidity split and the same
        // shape; only the scale moves.
        assertEq(
            TESTNET_TICK_UPPER - TESTNET_TICK_BAND,
            TICK_UPPER - TICK_BAND,
            "cheap curve is a different shape, not just a cheaper one"
        );
    }

    /*//////////////////////////////////////////////////////////
                          THE SEQUENCE
    //////////////////////////////////////////////////////////*/

    function test_buyingIsClosedUntilInitialise() public {
        _deployDeferred(TESTNET_TICK_UPPER, TESTNET_TICK_BAND);
        hook.setNFT(IShardNFTV1(address(nft)));

        vm.prank(buyer);
        vm.expectRevert(ShardErrorsV1.NotInitialised.selector);
        hook.buyMany{ value: 1 ether }(50, 1 ether, block.timestamp + 600);
    }

    function test_oneTransactionFactoryLaunchMintsTheFirstFiftyIds() public {
        _launchAtomic(TESTNET_TICK_UPPER, TESTNET_TICK_BAND);

        assertEq(hook.deployer(), address(factory), "factory is not deployer");
        assertTrue(hook.initialised(), "factory did not initialise atomically");

        uint256 before = buyer.balance;
        vm.prank(buyer);
        uint256[] memory ids = hook.buyMany{ value: 1 ether }(50, 1 ether, block.timestamp + 600);
        uint256 spent = before - buyer.balance;

        assertEq(ids.length, 50, "wrong count");
        for (uint256 i; i < 50; ++i) {
            assertEq(ids[i], i + 1, "ids must be the first fifty, in order");
            assertEq(nft.ownerOf(ids[i]), buyer, "buyer does not hold the token");
        }
        assertEq(nft.circulatingSupply(), 50, "circulating supply wrong");

        // ~50 x 0.000001 ETH plus the inclusive 1%, with room for walking up the curve. The
        // builder/launcher carve changes only where that 1% LANDS, never what the buyer pays,
        // so this figure is identical to the unsplit curve's.
        assertApproxEqRel(spent, 505e11, 0.05e18, "launch batch cost moved unexpectedly");
        console2.log("50 NFTs cost (wei)", spent);
    }

    /// @dev The launch fee is charged in full and then routed three ways. The buyer's cost is
    ///      the whole fee; the ledgers must add back up to it exactly.
    function test_launchFeeSplitsWithoutChangingWhatTheBuyerPays() public {
        _launchAtomic(TESTNET_TICK_UPPER, TESTNET_TICK_BAND);

        vm.prank(buyer);
        hook.buyMany{ value: 1 ether }(50, 1 ether, block.timestamp + 600);

        uint256 builderCut = hook.builderFeesAccrued();
        uint256 launcherCut = hook.launcherFeesAccrued();
        // Nothing circulates while the batch mints, so the holder share escrows in full.
        uint256 holderShare = hook.escrowBalance();

        assertGt(builderCut, 0, "builder accrued nothing on the launch batch");
        assertEq(builderCut, launcherCut, "the two cuts are both 10%");

        uint256 fee = builderCut + launcherCut + holderShare;
        assertEq(builderCut, (fee * 1000) / 10_000, "builder != 10% of the fee");
        assertEq(launcherCut, (fee * 1000) / 10_000, "launcher != 10% of the fee");
        assertEq(holderShare, fee - 2 * ((fee * 1000) / 10_000), "holders != the remainder");
    }

    /// @dev Manual construction retains a one-shot binding power even though the production
    ///      factory consumes it atomically.
    function test_setNFTIsOneShotSoABlindRerunWouldBrickTheLaunch() public {
        _deployDeferred(TESTNET_TICK_UPPER, TESTNET_TICK_BAND);
        hook.setNFT(IShardNFTV1(address(nft)));

        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.setNFT(IShardNFTV1(address(nft)));

        hook.initialise();
        assertTrue(hook.initialised(), "manual launch could not be completed");
    }

    function test_launchIsOneShotSoItCannotBeReplayed() public {
        _deployDeferred(TESTNET_TICK_UPPER, TESTNET_TICK_BAND);
        hook.setNFT(IShardNFTV1(address(nft)));
        hook.initialise();

        vm.expectRevert(ShardErrorsV1.AlreadyInitialised.selector);
        hook.initialise();
    }

    function test_onlyTheDeployerCanRunTheLaunch() public {
        _deployDeferred(TESTNET_TICK_UPPER, TESTNET_TICK_BAND);

        vm.prank(buyer);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.setNFT(IShardNFTV1(address(nft)));

        vm.prank(buyer);
        vm.expectRevert(ShardErrorsV1.NotDeployer.selector);
        hook.initialise();
    }

    /// @dev The production pair must keep working — the cheap one is for rehearsal only.
    function test_productionTicksStillLaunchAtAboutAThousandthOfAnEth() public pure {
        assertApproxEqRel(_ethPerNftWei(TICK_UPPER), 1e15, 0.01e18, "production launch price moved");
    }
}
