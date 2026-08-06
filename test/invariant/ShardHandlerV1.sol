// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IERC20Minimal } from "@uniswap/v4-core/src/interfaces/external/IERC20Minimal.sol";

import { ShardHookV1 } from "../../src/ShardHookV1.sol";
import { ShardTokenV1 } from "../../src/ShardTokenV1.sol";
import { ShardNFTV1 } from "../../src/ShardNFTV1.sol";

/// @title ShardHandlerV1
/// @notice Bounded random-action driver for the ShardHookV1 invariant suite.
///
/// @dev The handler doubles as a THIRD-PARTY swapper (it implements
///      `IUnlockCallback` and swaps in its own name), which is the only way to
///      exercise the `_beforeSwap`/`_afterSwap` fee path — v4 skips a hook's own
///      callbacks, so `buyNFT`/`sellNFT` never reach them.
///
///      Ghost accounting note: every action is wrapped in {track}, which measures
///      the hook's fee assets (`address(hook).balance + poolManager.balanceOf(hook, 0)`)
///      before and after. Every ETH fee the system takes — on either path — lands
///      in exactly one of those two buckets, and the only things that ever leave
///      them are a `claim` payout and the builder/launcher fee claims. So the
///      increase across an action IS the fee taken.
///
///      Fee split note: each swap/market fee is carved 10% to the builder and 10% to
///      the launcher BEFORE the remainder reaches the holder pool, but both cuts stay
///      hook-held until claimed. `feeAssets()` is therefore still the gross fee take,
///      and the accrued cuts are simply another liability against it.
contract ShardHandlerV1 is Test, IUnlockCallback {
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;

    uint256 internal constant ONE_SHARD = 1 ether;
    uint256 internal constant FAR = type(uint256).max;

    IPoolManager public immutable manager;
    ShardHookV1 public immutable hook;
    ShardTokenV1 public immutable shard;
    ShardNFTV1 public immutable nft;

    PoolKey internal key;

    /*//////////////////////////////////////////////////////////////
                                 ACTORS
    //////////////////////////////////////////////////////////////*/

    address[] public actors;

    /// @notice The address currently entitled to the builder cut. Kept in step with
    ///         `hook.builderFeeRecipient()` so claim actions prank the right caller after
    ///         a rotation.
    address public builderRecipient;
    /// @notice The launcher payout address. Immutable on the hook, so this never moves.
    address public launcherRecipient;
    /// @dev The small set the builder payout address rotates between.
    address[] public builderCandidates;

    /*//////////////////////////////////////////////////////////////
                            GHOST VARIABLES
    //////////////////////////////////////////////////////////////*/

    /// @notice Every wei of ETH fee the protocol has ever taken, on either path.
    uint256 public totalFeesTaken;
    /// @notice Every wei ever paid out by {ShardHookV1-claim}.
    uint256 public totalClaimed;
    /// @notice Every wei ever paid out by {ShardHookV1-claimBuilderFees}.
    uint256 public builderClaimed;
    /// @notice Every wei ever paid out by {ShardHookV1-claimLauncherFees}.
    uint256 public launcherClaimed;
    uint256 public totalBought;
    uint256 public totalSold;
    uint256 public totalRedeemed;
    uint256 public totalThirdPartySwaps;

    /// @notice NFTs minted through {ShardHookV1-buyMany} (also counted in `totalBought`).
    uint256 public totalBatchBought;
    /// @notice NFTs sold through {ShardHookV1-sellMany} (also counted in `totalSold`).
    uint256 public totalBatchSold;
    /// @notice Outside ETH paid in through {ShardHookV1-donate}.
    uint256 public totalDonated;
    /// @notice NFTs minted through {ShardHookV1-buyMax} (also counted in `totalBought`).
    uint256 public totalMaxBought;
    /// @notice Every wei of SHARD {ShardHookV1-buyMax} has ever handed back to a caller as
    ///         ERC-20. This is the ONLY path by which SHARD leaves the hook, so the core
    ///         backing identity `balanceOf(hook) == circulating * 1e18 + seedDust` only
    ///         survives if every wei of it actually landed on the caller. Each action
    ///         asserts that locally; this is the running total.
    uint256 public totalLeftoverShardOut;
    /// @dev Largest single buyMax leftover from a call that did NOT hit MAX_BATCH. Below the
    ///      cap this must stay under one whole SHARD — more than that should have been minted
    ///      as an NFT rather than handed back as ERC-20. AT the cap a large leftover is correct
    ///      and expected, which is why those calls are excluded rather than asserted on.
    uint256 public maxSingleLeftoverBelowCap;

    /// @notice Largest `circulatingSupply` ever observed. Bounds the id range that can
    ///         possibly have been handed out (ids are always issued lowest-first, so the
    ///         highest id ever issued is at most this + 1).
    uint256 public maxCirculatingSeen;

    /// @notice Highest `accFeePerNFT` ever observed at the end of an action.
    uint256 public lastAcc;
    /// @notice Highest seed-position liquidity ever observed.
    uint128 public maxLiquiditySeen;

    /// @notice Highest band-position liquidity ever observed. The band is as unwithdrawable
    ///         as the full-range position, so it gets the same ratchet.
    uint128 public maxBandLiquiditySeen;

    /// @dev Tokens currently held by a user (i.e. NOT in the archive).
    uint256[] public liveIds;
    mapping(uint256 => uint256) internal _idxPlusOne;

    /// @dev Action call counters, for `--show-metrics` style triage.
    mapping(bytes32 => uint256) public calls;

    constructor(
        IPoolManager _manager,
        ShardHookV1 _hook,
        ShardTokenV1 _shard,
        ShardNFTV1 _nft,
        PoolKey memory _key,
        address _launcher,
        address _builder
    ) {
        manager = _manager;
        hook = _hook;
        shard = _shard;
        nft = _nft;
        key = _key;

        launcherRecipient = _launcher;
        builderRecipient = _builder;
        // A small rotating set for `setBuilderFeeRecipient`. All plain EOAs, so a payout
        // can never fail for want of a `receive()`.
        builderCandidates.push(_builder);
        builderCandidates.push(makeAddr("builder.successor.1"));
        builderCandidates.push(makeAddr("builder.successor.2"));

        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(uint256(keccak256(abi.encodePacked("shard.actor", i)))));
            actors.push(a);
            vm.deal(a, 500 ether);
            vm.prank(a);
            shard.approve(address(hook), type(uint256).max);
        }

        vm.deal(address(this), 100_000 ether);
        lastAcc = hook.accFeePerNFT();
        maxLiquiditySeen = _positionLiquidity();
        maxBandLiquiditySeen = _bandLiquidity();
    }

    receive() external payable { }

    /*//////////////////////////////////////////////////////////////
                              BOOKKEEPING
    //////////////////////////////////////////////////////////////*/

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function liveIdCount() external view returns (uint256) {
        return liveIds.length;
    }

    /// @notice ETH the hook controls, in either form. The ERC-6909 claim id for
    ///         native ETH is 0 — third-party fees live there until swept.
    function feeAssets() public view returns (uint256) {
        return address(hook).balance + manager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId());
    }

    /// @notice Everything currently owed to a claimant, across every address the
    ///         handler could ever have credited.
    function sumClaimable() external view returns (uint256 total) {
        for (uint256 i = 0; i < actors.length; i++) {
            total += hook.claimable(actors[i]);
        }
        total += hook.claimable(address(this));
        total += hook.claimable(address(nft));
        total += hook.claimable(address(hook));
    }

    /// @notice SHARD held by every address this run can possibly have credited. The pool
    ///         itself (the PoolManager) is the only other holder, so this plus the manager
    ///         plus the hook must equal total supply — which is what proves the leftover
    ///         SHARD `buyMax` sends out is not conjured from somewhere.
    function sumActorShard() external view returns (uint256 total) {
        for (uint256 i = 0; i < actors.length; i++) {
            total += shard.balanceOf(actors[i]);
        }
        total += shard.balanceOf(address(this));
    }

    function positionLiquidity() external view returns (uint128) {
        return _positionLiquidity();
    }

    function bandLiquidity() external view returns (uint128) {
        return _bandLiquidity();
    }

    function _bandLiquidity() internal view returns (uint128 liquidity) {
        (liquidity,,) =
            manager.getPositionInfo(key.toId(), address(hook), hook.tickBand(), hook.tickUpper(), bytes32(0));
    }

    function _positionLiquidity() internal view returns (uint128 liquidity) {
        (liquidity,,) =
            manager.getPositionInfo(key.toId(), address(hook), hook.tickLower(), hook.tickUpper(), bytes32(0));
    }

    modifier track(bytes32 name) {
        calls[name]++;
        uint256 before = feeAssets();
        _;
        uint256 aft = feeAssets();
        // Fees only ever ADD to the two buckets; the only subtractions are a claim
        // payout and a builder/launcher fee claim, each of which reconciles itself.
        // Counting increases only is exact here and conservative (an undercount
        // tightens the solvency invariant rather than loosening it).
        if (aft > before) totalFeesTaken += aft - before;

        uint256 acc = hook.accFeePerNFT();
        require(acc >= lastAcc, "GHOST: accFeePerNFT went BACKWARDS");
        lastAcc = acc;

        uint128 liq = _positionLiquidity();
        require(liq >= maxLiquiditySeen, "GHOST: seed liquidity was REDUCED");
        maxLiquiditySeen = liq;

        uint128 bandLiq = _bandLiquidity();
        require(bandLiq >= maxBandLiquiditySeen, "GHOST: band liquidity was REDUCED");
        maxBandLiquiditySeen = bandLiq;

        uint256 circ = nft.circulatingSupply();
        if (circ > maxCirculatingSeen) maxCirculatingSeen = circ;

        // The tracked recipient must never drift from the hook's, or every later claim
        // action would be pranked as the wrong caller and quietly become a no-op.
        require(builderRecipient == hook.builderFeeRecipient(), "GHOST: builder recipient drifted");
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[bound(seed, 0, actors.length - 1)];
    }

    function _addLive(uint256 id) internal {
        if (_idxPlusOne[id] != 0) return;
        liveIds.push(id);
        _idxPlusOne[id] = liveIds.length;
    }

    function _removeLive(uint256 id) internal {
        uint256 ip1 = _idxPlusOne[id];
        if (ip1 == 0) return;
        uint256 last = liveIds[liveIds.length - 1];
        liveIds[ip1 - 1] = last;
        _idxPlusOne[last] = ip1;
        liveIds.pop();
        delete _idxPlusOne[id];
    }

    /*//////////////////////////////////////////////////////////////
                                ACTIONS
    //////////////////////////////////////////////////////////////*/

    function buyNFT(uint256 actorSeed, uint256 ethSeed) external track("buyNFT") {
        address actor = _actor(actorSeed);
        uint256 amount = bound(ethSeed, 0.0005 ether, 30 ether);
        vm.deal(actor, actor.balance + amount);

        vm.prank(actor);
        try hook.buyNFT{ value: amount }(type(uint256).max, FAR) returns (uint256 tokenId) {
            totalBought++;
            _addLive(tokenId);
        } catch { }
    }

    /// @dev ONE exact-output swap for `count` whole SHARD, `count` NFTs minted, the 1%
    ///      charged explicitly in the hook's own body (v4 skips its own callbacks).
    ///      Exact-output refunds the unused ETH, so an over-generous bound here cannot
    ///      drain the (very thin) curve — only what the NFTs actually cost is spent.
    function buyMany(uint256 actorSeed, uint256 countSeed, uint256 ethSeed) external track("buyMany") {
        address actor = _actor(actorSeed);
        uint256 max = hook.MAX_BATCH();
        uint256 count = bound(countSeed, 1, max);
        uint256 amount = bound(ethSeed, 0.0005 ether, 0.5 ether);
        vm.deal(actor, actor.balance + amount);

        uint256 hookShardBefore = shard.balanceOf(address(hook));

        vm.prank(actor);
        try hook.buyMany{ value: amount }(count, FAR, FAR) returns (uint256[] memory ids) {
            require(ids.length == count, "GHOST: buyMany minted a different count than asked");
            require(ids.length <= max, "GHOST: buyMany exceeded MAX_BATCH");
            for (uint256 i = 0; i < ids.length; i++) {
                require(nft.ownerOf(ids[i]) == actor, "GHOST: buyMany minted to the wrong address");
                _addLive(ids[i]);
            }
            // One SHARD parked per NFT, nothing more and nothing less.
            require(
                shard.balanceOf(address(hook)) - hookShardBefore == count * ONE_SHARD,
                "GHOST: buyMany moved the wrong amount of SHARD backing"
            );
            totalBought += count;
            totalBatchBought += count;
        } catch { }
    }

    /// @dev ONE exact-input swap: the whole `msg.value` is consumed, so this is bounded
    ///      HARD. The pool is thin enough that ~0.04 ETH halves the price.
    function buyMax(uint256 actorSeed, uint256 ethSeed) external track("buyMax") {
        address actor = _actor(actorSeed);
        uint256 amount = bound(ethSeed, 0.0001 ether, 0.002 ether);
        vm.deal(actor, actor.balance + amount);

        uint256 hookShardBefore = shard.balanceOf(address(hook));
        uint256 actorShardBefore = shard.balanceOf(actor);

        vm.prank(actor);
        try hook.buyMax{ value: amount }(0, FAR) returns (uint256[] memory ids) {
            require(ids.length <= hook.MAX_BATCH(), "GHOST: buyMax exceeded MAX_BATCH");
            for (uint256 i = 0; i < ids.length; i++) {
                require(nft.ownerOf(ids[i]) == actor, "GHOST: buyMax minted to the wrong address");
                _addLive(ids[i]);
            }

            uint256 leftover = shard.balanceOf(actor) - actorShardBefore;
            // Everything the swap bought either became backing for an NFT or was handed to
            // the caller. If the hook kept a wei of it, the backing identity is already
            // broken and there is no upgrade path to fix it.
            require(
                shard.balanceOf(address(hook)) - hookShardBefore == ids.length * ONE_SHARD,
                "GHOST: buyMax left SHARD stranded in the hook"
            );
            // Now UNCONDITIONAL. buyMax reverts above the cap instead of clamping, so a
            // successful call can never hand back a whole SHARD: anything worth an NFT was
            // minted as one. The old version had to exempt cap-hit calls.
            require(leftover < ONE_SHARD, "GHOST: a whole SHARD was returned instead of minted");

            totalLeftoverShardOut += leftover;
            if (leftover > maxSingleLeftoverBelowCap) {
                maxSingleLeftoverBelowCap = leftover;
            }
            totalBought += ids.length;
            totalMaxBought += ids.length;
        } catch { }
    }

    /// @dev Feeds the SHARD `buyMax` handed back into {ShardHookV1-redeem}. This is the
    ///      only route by which leftover shards re-enter the hook, and it must add
    ///      exactly one unit of backing per NFT — never mint one for free.
    function redeemLeftover(uint256 actorSeed) external track("redeemLeftover") {
        address actor = _actor(actorSeed);
        if (shard.balanceOf(actor) < ONE_SHARD) return;

        uint256 hookShardBefore = shard.balanceOf(address(hook));
        vm.prank(actor);
        try hook.redeem() returns (uint256 tokenId) {
            require(
                shard.balanceOf(address(hook)) - hookShardBefore == ONE_SHARD,
                "GHOST: redeem minted an NFT without one full SHARD of backing"
            );
            totalRedeemed++;
            _addLive(tokenId);
        } catch { }
    }

    function sellNFT(uint256 idSeed) external track("sellNFT") {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[bound(idSeed, 0, liveIds.length - 1)];
        address owner = nft.ownerOf(id);
        if (owner == address(nft)) {
            _removeLive(id);
            return;
        }

        vm.prank(owner);
        try hook.sellNFT(id, 0, FAR) {
            totalSold++;
            _removeLive(id);
        } catch { }
    }

    /// @dev ONE exact-input swap for the whole batch, with the 1% charged explicitly in the
    ///      hook's own body — the sell-side twin of {buyMany}. Every id must belong to the
    ///      same seller, so this collects the seed holder's live ids and sells those.
    function sellMany(uint256 idSeed, uint256 countSeed) external track("sellMany") {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[bound(idSeed, 0, liveIds.length - 1)];
        address owner = nft.ownerOf(id);
        if (owner == address(nft)) {
            _removeLive(id);
            return;
        }

        uint256 want = bound(countSeed, 1, hook.MAX_BATCH());
        uint256[] memory batch = new uint256[](want);
        uint256 n;
        for (uint256 i = 0; i < liveIds.length && n < want; i++) {
            // Duplicates would revert the whole batch, and liveIds holds each id once.
            if (nft.ownerOf(liveIds[i]) == owner) {
                batch[n++] = liveIds[i];
            }
        }
        if (n == 0) return;

        uint256[] memory ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = batch[i];
        }

        uint256 hookShardBefore = shard.balanceOf(address(hook));

        vm.prank(owner);
        try hook.sellMany(ids, 0, FAR) {
            // One SHARD of backing must leave per NFT — never more, never less.
            require(
                hookShardBefore - shard.balanceOf(address(hook)) == n * ONE_SHARD,
                "GHOST: sellMany moved the wrong amount of SHARD backing"
            );
            for (uint256 i = 0; i < n; i++) {
                require(nft.ownerOf(ids[i]) == address(nft), "GHOST: sellMany left an id with the seller");
                _removeLive(ids[i]);
            }
            totalSold += n;
            totalBatchSold += n;
        } catch { }
    }

    /// @dev The batch arrival path for shards bought on a third-party router. One
    ///      `transferFrom` for the whole batch, so it must add exactly one unit of backing
    ///      per NFT — never mint one for free.
    function redeemMany(uint256 actorSeed, uint256 countSeed) external track("redeemMany") {
        uint256 available = shard.balanceOf(address(this)) / ONE_SHARD;
        if (available == 0) return;
        uint256 count = bound(countSeed, 1, available < hook.MAX_BATCH() ? available : hook.MAX_BATCH());

        address actor = _actor(actorSeed);
        shard.transfer(actor, count * ONE_SHARD);

        uint256 hookShardBefore = shard.balanceOf(address(hook));

        vm.prank(actor);
        try hook.redeemMany(count) returns (uint256[] memory ids) {
            require(ids.length == count, "GHOST: redeemMany minted a different count than asked");
            require(
                shard.balanceOf(address(hook)) - hookShardBefore == count * ONE_SHARD,
                "GHOST: redeemMany minted NFTs without a full SHARD of backing each"
            );
            for (uint256 i = 0; i < count; i++) {
                require(nft.ownerOf(ids[i]) == actor, "GHOST: redeemMany minted to the wrong address");
                _addLive(ids[i]);
            }
            totalRedeemed += count;
        } catch {
            // pull the shards back so the handler's balance stays meaningful
            vm.prank(actor);
            shard.transfer(address(this), count * ONE_SHARD);
        }
    }

    /// @dev Only reachable once the handler has bought SHARD on the open market.
    function redeem(uint256 actorSeed) external track("redeem") {
        if (shard.balanceOf(address(this)) < ONE_SHARD) return;
        address actor = _actor(actorSeed);
        shard.transfer(actor, ONE_SHARD);

        vm.prank(actor);
        try hook.redeem() returns (uint256 tokenId) {
            totalRedeemed++;
            _addLive(tokenId);
        } catch {
            // pull the shard back so the handler's balance stays meaningful
            vm.prank(actor);
            shard.transfer(address(this), ONE_SHARD);
        }
    }

    /// @dev Outside ETH paid into the fee pool, the launchpad path. It must obey the
    ///      same solvency rule as a trading fee: every wei donated becomes claimable
    ///      by holders or sits in escrow, and never inflates claims beyond assets.
    ///      A donation is a gift to holders, NOT swap volume, so it is never split.
    function donate(uint256 amountSeed) external track("donate") {
        uint256 amount = bound(amountSeed, 1, 5 ether);
        vm.deal(address(this), address(this).balance + amount);

        uint256 before = feeAssets();
        uint256 builderBefore = hook.builderFeesAccrued();
        uint256 launcherBefore = hook.launcherFeesAccrued();
        try hook.donate{ value: amount }() {
            require(feeAssets() - before == amount, "GHOST: donation did not land wholly in the fee assets");
            require(hook.builderFeesAccrued() == builderBefore, "GHOST: a donation was split to the builder");
            require(hook.launcherFeesAccrued() == launcherBefore, "GHOST: a donation was split to the launcher");
            totalDonated += amount;
        } catch { }
    }

    function claim(uint256 actorSeed, uint256 nSeed) external track("claim") {
        address actor = _actor(actorSeed);
        uint256 n = liveIds.length == 0 ? 0 : bound(nSeed, 0, liveIds.length);
        uint256[] memory ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = liveIds[i];
        }

        uint256 before = feeAssets();
        vm.prank(actor);
        try hook.claim(ids) returns (uint256 paid) {
            totalClaimed += paid;
            // The payout is the ONLY thing that may leave the fee buckets on this path.
            require(before - feeAssets() == paid, "GHOST: claim moved more than it paid");
        } catch { }
    }

    /*//////////////////////////////////////////////////////////////
                       BUILDER / LAUNCHER CUTS
    //////////////////////////////////////////////////////////////*/

    /// @dev Pranked as the CURRENT recipient, which `setBuilderFeeRecipient` keeps in step.
    ///      `NothingToClaim` is an ordinary no-op, so a zero accrual is caught and ignored.
    function claimBuilderFees() external track("claimBuilderFees") {
        uint256 accrued = hook.builderFeesAccrued();
        uint256 before = feeAssets();

        vm.prank(builderRecipient);
        try hook.claimBuilderFees() returns (uint256 paid) {
            require(paid == accrued, "GHOST: builder claim paid something other than the accrual");
            require(hook.builderFeesAccrued() == 0, "GHOST: builder accrual survived a claim");
            require(before - feeAssets() == paid, "GHOST: builder claim moved more than it paid");
            builderClaimed += paid;
        } catch { }
    }

    function claimLauncherFees() external track("claimLauncherFees") {
        uint256 accrued = hook.launcherFeesAccrued();
        uint256 before = feeAssets();

        vm.prank(launcherRecipient);
        try hook.claimLauncherFees() returns (uint256 paid) {
            require(paid == accrued, "GHOST: launcher claim paid something other than the accrual");
            require(hook.launcherFeesAccrued() == 0, "GHOST: launcher accrual survived a claim");
            require(before - feeAssets() == paid, "GHOST: launcher claim moved more than it paid");
            launcherClaimed += paid;
        } catch { }
    }

    /// @dev Rotates the builder payout address around a fixed set of EOAs. The tracked
    ///      recipient moves with it, so later claims still prank a caller the hook accepts.
    function setBuilderFeeRecipient(uint256 seed) external track("setBuilderFeeRecipient") {
        address next = builderCandidates[bound(seed, 0, builderCandidates.length - 1)];
        if (next == builderRecipient) return;

        vm.prank(builderRecipient);
        try hook.setBuilderFeeRecipient(next) {
            builderRecipient = next;
        } catch { }
    }

    /*//////////////////////////////////////////////////////////////
                       THIRD-PARTY SWAP PATH
    //////////////////////////////////////////////////////////////*/

    function swapEthForShard(uint256 amountSeed, uint256 exactSeed) external track("swapEthForShard") {
        uint256 amount = bound(amountSeed, 1000 wei, 25 ether);
        bool exactIn = exactSeed % 2 == 0;
        int256 specified = exactIn ? -int256(amount) : int256(bound(amountSeed, 1000 wei, 50 ether));

        try this.doSwap(true, specified) {
            totalThirdPartySwaps++;
        } catch { }
    }

    function swapShardForEth(uint256 amountSeed, uint256 exactSeed) external track("swapShardForEth") {
        uint256 held = shard.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = bound(amountSeed, 1, held);
        bool exactIn = exactSeed % 2 == 0;
        // exactOut here specifies ETH out, which the handler cannot size safely,
        // so keep it small relative to what the pool plausibly holds.
        int256 specified = exactIn ? -int256(amount) : int256(bound(amountSeed, 1 wei, 0.05 ether));

        try this.doSwap(false, specified) {
            totalThirdPartySwaps++;
        } catch { }
    }

    /// @dev External so the handler can `try` it and roll back a failed swap
    ///      without aborting the whole action.
    function doSwap(bool zeroForOne, int256 amountSpecified) external returns (BalanceDelta delta) {
        require(msg.sender == address(this), "self only");
        delta = abi.decode(manager.unlock(abi.encode(zeroForOne, amountSpecified)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        require(msg.sender == address(manager), "not pool manager");
        (bool zeroForOne, int256 amountSpecified) = abi.decode(rawData, (bool, int256));

        BalanceDelta delta = manager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        _resolve(key.currency0, delta.amount0());
        _resolve(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _resolve(Currency currency, int128 amount) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            if (currency.isAddressZero()) {
                manager.settle{ value: owed }();
            } else {
                manager.sync(currency);
                IERC20Minimal(Currency.unwrap(currency)).transfer(address(manager), owed);
                manager.settle();
            }
        } else if (amount > 0) {
            manager.take(currency, address(this), uint256(uint128(amount)));
        }
    }

    /*//////////////////////////////////////////////////////////////
                          TRANSFERS AND TIME
    //////////////////////////////////////////////////////////////*/

    function transferNFT(uint256 idSeed, uint256 actorSeed) external track("transferNFT") {
        if (liveIds.length == 0) return;
        uint256 id = liveIds[bound(idSeed, 0, liveIds.length - 1)];
        address owner = nft.ownerOf(id);
        if (owner == address(nft)) {
            _removeLive(id);
            return;
        }
        address to = _actor(actorSeed);
        if (to == owner) return;

        vm.prank(owner);
        try nft.transferFrom(owner, to, id) { } catch { }
    }

    function warpBlock(uint256 seed) external track("warpBlock") {
        uint256 n = bound(seed, 1, 3);
        vm.roll(block.number + n);
        vm.warp(block.timestamp + n * 2);
    }
}
