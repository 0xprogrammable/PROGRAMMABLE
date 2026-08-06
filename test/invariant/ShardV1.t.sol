// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test, console2 } from "forge-std/Test.sol";

import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";

import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { ShardHookV1 } from "../../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../../src/ShardNFTV1.sol";
import { GeometricRendererV1 } from "../../src/GeometricRendererV1.sol";
import { ShardConstantsV1 } from "../../src/ShardConstantsV1.sol";
import { IShardNFTV1 } from "../../src/interfaces/IShardNFTV1.sol";
import { ShardLaunchLib } from "../utils/ShardLaunchLib.sol";

import { ShardHandlerV1 } from "./ShardHandlerV1.sol";

/// @title ShardV1Invariants
/// @notice The primary safety net. There is no paid audit and the liquidity
///         position is locked forever, so anything these do not catch cannot be
///         fixed later. Assertions are stated as SOLVENCY where possible, not as
///         conservation — a conservation-only property let a same-block
///         double-claim (2 ETH of claims against 1 ETH of fees) through cleanly.
contract ShardV1Invariants is Test {
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_UPPER = 115_080;
    int24 internal constant TICK_BAND = 22_980; // ~0.1 ETH per NFT, the concentrated band edge
    int24 internal TICK_LOWER;

    uint256 internal constant SEED_AMOUNT = 10_000 ether;
    uint256 internal constant ONE_SHARD = 1 ether;
    uint256 internal constant ACC_PRECISION = 1e18;

    /// @dev Floor for the audited id range. Batch buys mint up to `MAX_BATCH` ids in a
    ///      single action, so a FIXED window is no longer safe — the window is derived
    ///      from the run itself in {_idWindow} and this is only its lower bound.
    uint256 internal constant ID_WINDOW = 128;

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
    ShardHandlerV1 internal handler;

    PoolKey internal key;
    PoolId internal poolId;
    uint160 internal startSqrtPriceX96;

    address internal constant launcher = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address internal builder = makeAddr("builder");

    function setUp() public {
        TICK_LOWER = TickMath.minUsableTick(TICK_SPACING);
        startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        manager = IPoolManager(address(new PoolManager(address(this))));
        factory = new ShardLaunchFactoryV1(manager, keccak256(type(ShardHookV1).creationCode));
        ShardLaunchFactoryV1.LaunchParams memory params = ShardLaunchFactoryV1.LaunchParams({
            tickLower: TICK_LOWER,
            tickBand: TICK_BAND,
            tickUpper: TICK_UPPER,
            startSqrtPriceX96: startSqrtPriceX96,
            builderFeeRecipient: builder
        });
        (hook, shard, nft,) = ShardLaunchLib.mineAndLaunch(factory, keccak256("ShardV1Invariants"), bytes32(0), params);
        renderer = factory.renderer();

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = key.toId();

        handler = new ShardHandlerV1(manager, hook, shard, nft, key, launcher, builder);

        bytes4[] memory selectors = new bytes4[](17);
        selectors[0] = ShardHandlerV1.buyNFT.selector;
        selectors[1] = ShardHandlerV1.sellNFT.selector;
        selectors[2] = ShardHandlerV1.redeem.selector;
        selectors[3] = ShardHandlerV1.claim.selector;
        selectors[4] = ShardHandlerV1.swapEthForShard.selector;
        selectors[5] = ShardHandlerV1.swapShardForEth.selector;
        selectors[6] = ShardHandlerV1.transferNFT.selector;
        selectors[7] = ShardHandlerV1.warpBlock.selector;
        selectors[8] = ShardHandlerV1.buyMany.selector;
        selectors[9] = ShardHandlerV1.buyMax.selector;
        selectors[10] = ShardHandlerV1.redeemLeftover.selector;
        selectors[11] = ShardHandlerV1.sellMany.selector;
        selectors[12] = ShardHandlerV1.redeemMany.selector;
        selectors[13] = ShardHandlerV1.donate.selector;
        selectors[14] = ShardHandlerV1.claimBuilderFees.selector;
        selectors[15] = ShardHandlerV1.claimLauncherFees.selector;
        selectors[16] = ShardHandlerV1.setBuilderFeeRecipient.selector;

        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));

        // Nothing but the handler may originate calls.
        excludeSender(address(hook));
        excludeSender(address(nft));
        excludeSender(address(manager));
        excludeSender(address(shard));
    }

    /*//////////////////////////////////////////////////////////////
                          BACKING AND SUPPLY
    //////////////////////////////////////////////////////////////*/

    function invariant_launchUsesAtomicFactory() public view {
        assertEq(hook.deployer(), address(factory));
    }

    /// Every circulating NFT is backed by exactly 1 SHARD parked in the hook.
    /// `seedDust` is load-bearing: `LiquidityAmounts.getLiquidityForAmount1`
    /// rounds down, so ~221 wei of SHARD never entered the position and sits in
    /// the hook forever. Without the term this is false from deployment.
    function invariant_shardBackingMatchesNftCirculating() public view {
        assertEq(
            shard.balanceOf(address(hook)),
            nft.circulatingSupply() * ONE_SHARD + hook.seedDust(),
            "SHARD backing != circulating NFTs"
        );
    }

    /// SHARD is a fixed, unmintable, unburnable supply. `buyMax` is the ONLY function
    /// that ever sends SHARD out of the hook, so this is what proves the leftover it
    /// hands back is real supply moving between holders rather than backing quietly
    /// leaving the system. Every wei must sit in exactly one of four places: the locked
    /// position (the PoolManager), the hook's backing, a caller, or the handler.
    function invariant_shardSupplyIsConserved() public view {
        uint256 accounted = shard.balanceOf(address(hook)) + shard.balanceOf(address(manager)) + handler.sumActorShard()
            + shard.balanceOf(address(this)) + shard.balanceOf(address(nft));
        assertEq(accounted, shard.totalSupply(), "SHARD went missing or appeared from nowhere");
    }

    /// Every wei of SHARD `buyMax` handed back left the hook and landed on a caller —
    /// the handler asserts that per call, and it must never have handed back more than
    /// @dev Leftover SHARD from `buyMax` is a cumulative FLOW, so comparing it to total supply
    ///      (a stock) could never fail — that assertion was vacuous. The property that actually
    ///      bites: below the MAX_BATCH cap, a leftover of a whole SHARD or more means an NFT
    ///      that should have been minted was handed back as ERC-20 instead. At the cap a large
    ///      leftover is correct by design, so those calls are excluded at the handler.
    ///      (Conservation of the units that left is covered by invariant_shardSupplyIsConserved.)
    /// Unconditional now: buyMax reverts above MAX_BATCH rather than clamping, so no
    /// successful call can ever return a whole SHARD in place of an NFT.
    function invariant_buyMaxNeverReturnsAWholeShard() public view {
        assertLt(
            handler.maxSingleLeftoverBelowCap(),
            1e18,
            "buyMax returned a whole SHARD - it should have minted an NFT or reverted"
        );
    }

    /// The EARNING set (`circulating`, which lags acquisitions by a block) plus
    /// the not-yet-joined set must always equal the BACKING set. If these drift,
    /// fees are being divided by the wrong denominator.
    function invariant_earningSetMatchesBackingSet() public view {
        assertEq(
            hook.circulating() + hook.pendingCount(), nft.circulatingSupply(), "earning set + pending != backing set"
        );
    }

    function invariant_circulatingNeverExceedsMaxSupply() public view {
        assertLe(nft.circulatingSupply(), nft.MAX_SUPPLY(), "circulating > MAX_SUPPLY");
        assertLe(hook.circulating(), nft.MAX_SUPPLY(), "earning set > MAX_SUPPLY");
    }

    /// Every id is in exactly one of two places: a user's wallet or the archive.
    /// None can be stranded in a third state (which is what a direct ERC-721
    /// transfer into the archive would produce).
    /// @dev Ids are always issued LOWEST-FIRST, so at the moment the highest id `H` ever
    ///      handed out was issued, ids 1..H-1 were all circulating. Hence
    ///      `H <= maxCirculatingEver + 1` and every id above that is provably unminted
    ///      (and therefore pool-held). That is the window; the fixed 128 is kept as a
    ///      floor so the check never audits a NARROWER range than it used to.
    function _idWindow() internal view returns (uint256 w) {
        w = handler.maxCirculatingSeen() + 1;
        if (w < ID_WINDOW) w = ID_WINDOW;
        if (w > nft.MAX_SUPPLY()) w = nft.MAX_SUPPLY();
    }

    function invariant_poolHeldPlusCirculatingEqualsTenThousand() public view {
        uint256 window = _idWindow();
        assertLe(nft.lowestAvailableId(), window + 1, "an id above the audited window was handed out");

        uint256 held;
        for (uint256 id = 1; id <= window; id++) {
            if (nft.isPoolHeld(id)) held++;
        }
        // Ids above the window are provably all archived (asserted above), so
        // held + circulating == 10_000 reduces to this.
        assertEq(held + nft.circulatingSupply(), window, "archived + circulating != total supply");
    }

    function invariant_lowestAvailableIdIsActuallyAvailable() public view {
        uint256 lowest = nft.lowestAvailableId();
        if (lowest > nft.MAX_SUPPLY()) return; // exhausted pool is a valid terminal state
        assertTrue(nft.isPoolHeld(lowest), "lowestAvailableId is NOT archived");
        // An archived id is either unminted (never handed out) or owned by the
        // archive. It must never be sitting in a user's wallet.
        if (nft.tokenSeed(lowest) != 0 || _exists(lowest)) {
            assertEq(nft.ownerOf(lowest), address(nft), "an archived id is in a user wallet");
        }
        for (uint256 id = 1; id < lowest; id++) {
            assertFalse(nft.isPoolHeld(id), "a lower id was archived and skipped");
        }
    }

    /// @dev ERC-721 has no public existence check; `ownerOf` reverts for an id
    ///      that was never minted (ids start life unminted, not owned).
    function _exists(uint256 id) internal view returns (bool) {
        (bool ok,) = address(nft).staticcall(abi.encodeWithSignature("ownerOf(uint256)", id));
        return ok;
    }

    /*//////////////////////////////////////////////////////////////
                               SOLVENCY
    //////////////////////////////////////////////////////////////*/

    /// THE ONE THAT MATTERS. Everything the protocol has promised — materialised
    /// balances, the unshared scaled dust, escrow, the builder and launcher cuts
    /// (accrued or already paid), and everything already paid out — must never
    /// exceed what it actually took in fees.
    ///
    /// Conservation (`in == out`) is NOT enough: it passed a same-block
    /// double-claim that produced 2 ether of claims against 1 ether of fees.
    /// Solvency is the property that catches it.
    function invariant_claimsNeverExceedFeesTaken() public view {
        // NOTE: `dustScaled / ACC_PRECISION` was previously a term here and was DEAD —
        // dustScaled is bounded by `circulating` (< 10,000), so dividing by 1e18 is
        // identically zero. It contributes nothing to wei-level solvency, so it is dropped
        // here and checked on its own bound below instead of being silently carried.
        uint256 promised = handler.sumClaimable() + hook.escrowBalance() + handler.totalClaimed()
            + hook.builderFeesAccrued() + hook.launcherFeesAccrued() + handler.builderClaimed()
            + handler.launcherClaimed();

        assertLe(promised, handler.totalFeesTaken(), "INSOLVENT: promised more than was ever taken in fees");
    }

    /// @dev The scaled dust must stay strictly below `circulating`, which is what makes it
    ///      sub-wei and therefore irrelevant to solvency. If it ever exceeded that, the
    ///      accumulator would be carrying real unshared value and the assertion above would
    ///      be understating what the protocol owes.
    /// @dev Bounded by ACC_PRECISION, NOT by `circulating`. `_distribute` sets
    ///      `dustScaled = totalScaled % circulating`, so it is below the holder count at the
    ///      MOMENT of distribution — but holders then sell and `circulating` falls while the
    ///      carried dust does not. The standing property is the one the name claims: divided
    ///      by ACC_PRECISION the carry is less than a single wei, so nothing material is
    ///      sitting undistributed. It is carried into the next distribution, never lost.
    function invariant_dustStaysSubWei() public view {
        assertLt(hook.dustScaled(), ACC_PRECISION, "carried dust reached a whole wei");
    }

    /// And the protocol must actually be holding the ETH behind those promises.
    /// The ERC-6909 term is mandatory — third-party fees live as claims (id 0)
    /// until a `claim` call sweeps them, so an ETH-balance-only assertion would
    /// fail spuriously. The builder and launcher cuts are carved out of the fee but
    /// stay hook-held until claimed, so they are liabilities against the same assets.
    function invariant_hookAssetsCoverAllClaims() public view {
        uint256 owed =
            handler.sumClaimable() + hook.escrowBalance() + hook.builderFeesAccrued() + hook.launcherFeesAccrued();
        assertGe(handler.feeAssets(), owed, "INSOLVENT: hook cannot cover what it owes");
    }

    /// The builder and launcher take the SAME 10% of the SAME fee stream, on every split path. The
    /// combined operator cut is carried and split evenly with the launcher taking the odd wei, so
    /// their lifetime totals (still accrued plus already claimed) stay within a single wei of each
    /// other, launcher never below builder. A fee that reached one carve-out but not the other — or
    /// a claim that paid more than was accrued — breaks this immediately.
    function invariant_builderAndLauncherCutsMatch() public view {
        uint256 launcherTotal = hook.launcherFeesAccrued() + handler.launcherClaimed();
        uint256 builderTotal = hook.builderFeesAccrued() + handler.builderClaimed();
        assertGe(launcherTotal, builderTotal, "launcher shorted below builder");
        assertLe(launcherTotal - builderTotal, 1, "builder and launcher cuts diverged beyond a wei");
    }

    /// An accrued builder cut must always be payable, right now, by whoever the payout
    /// address currently is. If it is not, the cut is stranded: `builderFeesAccrued` is
    /// bookkeeping the hook cannot honour with the ETH it holds.
    /// @dev State-changing on purpose — the claim is really executed and then rolled back,
    ///      so it proves payability rather than restating the accounting.
    function invariant_builderFeesAreAlwaysClaimable() public {
        uint256 accrued = hook.builderFeesAccrued();
        if (accrued == 0) return;

        uint256 snap = vm.snapshotState();

        uint256 paid;
        bool ok;
        vm.prank(handler.builderRecipient());
        try hook.claimBuilderFees() returns (uint256 amount) {
            paid = amount;
            ok = true;
        } catch { }

        assertTrue(ok, "STRANDED: accrued builder fees could not be claimed");
        assertEq(paid, accrued, "builder claim paid something other than the accrual");

        vm.revertToState(snap);
    }

    /// The accumulator is a running total. A decrease means someone's snapshot
    /// arithmetic underflows into a free claim.
    function invariant_accumulatorNeverDecreases() public view {
        assertGe(hook.accFeePerNFT(), handler.lastAcc(), "accFeePerNFT decreased");
    }

    /// Dust is carried in SCALED units. It can never exceed the largest holder count the
    /// protocol has ever had, because every `_distribute` reduces it modulo `circulating`
    /// and `circulating` can never exceed MAX_NFTS.
    function invariant_dustNeverExceedsMaxSupply() public view {
        assertLt(hook.dustScaled(), ShardConstantsV1.MAX_NFTS, "dustScaled exceeded the largest possible divisor");
    }

    /// The band position is stacked on top of the full-range one and is just as permanent.
    /// If it could shrink, the curve would silently steepen under holders.
    function invariant_bandPositionIsNeverReduced() public view {
        (uint128 liquidity,,) =
            manager.getPositionInfo(poolId, address(hook), hook.tickBand(), hook.tickUpper(), bytes32(0));
        assertGe(liquidity, hook.seedLiquidityBand(), "band position liquidity was REDUCED");
        assertGe(liquidity, handler.maxBandLiquiditySeen(), "band position liquidity went down mid-run");
    }

    /// The shape itself is an invariant: the band must stay denser than the full range, or
    /// the curve is upside down and early buyers pay tail prices.
    function invariant_bandStaysDenserThanTheFullRange() public view {
        assertGt(hook.seedLiquidityBand(), hook.seedLiquidity(), "band is no longer the denser position");
    }

    /*//////////////////////////////////////////////////////////////
                          THE LOCKED POSITION
    //////////////////////////////////////////////////////////////*/

    /// THE LIQUIDITY IS LOCKED FOREVER. There is exactly one `modifyLiquidity`
    /// call site and it is always positive. If this ever fails, the trust model
    /// of the whole protocol is gone and there is no upgrade path to fix it.
    function invariant_liquidityPositionIsNeverReduced() public view {
        (uint128 liquidity,,) =
            manager.getPositionInfo(poolId, address(hook), hook.tickLower(), hook.tickUpper(), bytes32(0));
        assertGe(liquidity, hook.seedLiquidity(), "seed position liquidity was REDUCED");
        assertGe(liquidity, handler.maxLiquiditySeen(), "seed position liquidity went down mid-run");
    }

    /*//////////////////////////////////////////////////////////////
                                 CALL LOG
    //////////////////////////////////////////////////////////////*/

    function invariant_callSummary() public view {
        console2.log("buys          ", handler.totalBought());
        console2.log("  via buyMany ", handler.totalBatchBought());
        console2.log("  via sellMany", handler.totalBatchSold());
        console2.log("  donated wei ", handler.totalDonated());
        console2.log("  via buyMax  ", handler.totalMaxBought());
        console2.log("leftover SHARD", handler.totalLeftoverShardOut());
        console2.log("sells         ", handler.totalSold());
        console2.log("redeems       ", handler.totalRedeemed());
        console2.log("3p swaps      ", handler.totalThirdPartySwaps());
        console2.log("fees taken    ", handler.totalFeesTaken());
        console2.log("claimed       ", handler.totalClaimed());
        console2.log("builder held  ", hook.builderFeesAccrued());
        console2.log("builder paid  ", handler.builderClaimed());
        console2.log("launcher held ", hook.launcherFeesAccrued());
        console2.log("launcher paid ", handler.launcherClaimed());
    }
}
