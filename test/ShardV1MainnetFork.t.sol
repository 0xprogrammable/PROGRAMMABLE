// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { Test } from "forge-std/Test.sol";

import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";
import { ShardConstantsV1 } from "../src/ShardConstantsV1.sol";
import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardNFTV1 } from "../src/ShardNFTV1.sol";
import { ShardSwapRouterV1 } from "../src/ShardSwapRouterV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";
import { IShardNFTV1 } from "../src/interfaces/IShardNFTV1.sol";

/// @notice The Ethereum-Mainnet release gate: the complete Shards lifecycle exercised against the
///         pinned canonical Uniswap v4 `PoolManager` deployment on a Mainnet fork.
///
/// @dev Every other Shards suite runs against a freshly deployed local `PoolManager`, which proves
///      the model's own logic but says nothing about whether it composes with the real v4 contract
///      the collection would actually market-make on. This suite closes that gap: it mines the hook
///      against the live PoolManager, deploys and wires the token, hook, NFT and renderer, seeds and
///      initialises the locked position, then drives a third-party swap, a redeem, a hook-market buy
///      and sell, all three claim paths and a donation — asserting the backing invariant survives
///      every step. It also pins that the fork handed us the genuine PoolManager (by runtime code
///      hash) and that the model's Arbitrum-only entropy source degrades to zero on Mainnet without
///      breaking art regeneration.
///
///      It needs an archive RPC and so is excluded from the default `forge test` run in CI, in the
///      style of {ClassicV3MainnetForkTest}. Point `ETHEREUM_RPC_URL` at an archive node, or let it
///      fall back to the public default, and run it explicitly:
///
///          forge test --match-contract ShardV1MainnetForkTest
contract ShardV1MainnetForkTest is Test {
    using CurrencyLibrary for Currency;

    /// @dev A block well after the canonical v4 PoolManager was deployed. Shared with
    ///      {ClassicV3MainnetForkTest} so both fork suites pin the same known-good state.
    uint256 internal constant SNAPSHOT_BLOCK = 25_639_000;

    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;

    /// @dev The runtime code hash of the canonical PoolManager at {SNAPSHOT_BLOCK}. If the fork ever
    ///      returns something else at that address, this suite is testing a stranger, not v4.
    bytes32 internal constant POOL_MANAGER_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;

    /// @dev The production curve: price at TICK_UPPER is ~0.001 ETH per NFT, the concentrated band
    ///      runs from TICK_BAND up to TICK_UPPER. Identical to the pair the unit suites launch on.
    int24 internal constant TICK_UPPER = 69_060;
    int24 internal constant TICK_BAND = 22_980;

    uint160 internal constant HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    uint256 internal constant SEED_AMOUNT = ShardConstantsV1.MAX_NFTS * ShardConstantsV1.SHARDS_PER_NFT;
    uint256 internal constant ONE_SHARD = ShardConstantsV1.SHARDS_PER_NFT;

    IPoolManager internal poolManager;
    ShardTokenV1 internal shard;
    GeometricRendererV1 internal renderer;
    ShardHookV1 internal hook;
    ShardNFTV1 internal nft;
    ShardSwapRouterV1 internal swapRouter;
    PoolKey internal key;

    address internal launcher = makeAddr("launcher");
    address internal builder = makeAddr("builder");
    address internal buyer = makeAddr("buyer");
    address internal trader = makeAddr("trader");

    uint256 internal deadline;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string("https://eth.drpc.org"));
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);

        deadline = block.timestamp + 1 hours;
        poolManager = IPoolManager(POOL_MANAGER);

        int24 tickLower = TickMath.minUsableTick(ShardConstantsV1.TICK_SPACING);
        uint160 startSqrtPriceX96 = TickMath.getSqrtPriceAtTick(TICK_UPPER);

        shard = new ShardTokenV1();
        renderer = new GeometricRendererV1();

        (address expected, bytes32 salt) = HookMiner.find(
            address(this),
            HOOK_FLAGS,
            type(ShardHookV1).creationCode,
            abi.encode(
                poolManager,
                shard,
                tickLower,
                TICK_BAND,
                TICK_UPPER,
                startSqrtPriceX96,
                address(this),
                launcher,
                builder
            )
        );
        hook = new ShardHookV1{ salt: salt }(
            poolManager, shard, tickLower, TICK_BAND, TICK_UPPER, startSqrtPriceX96, address(this), launcher, builder
        );
        assertEq(address(hook), expected, "mined hook address mismatch");

        nft = new ShardNFTV1(address(hook), address(renderer));

        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(shard)),
            fee: ShardConstantsV1.POOL_FEE,
            tickSpacing: ShardConstantsV1.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        swapRouter = new ShardSwapRouterV1(poolManager, key);

        // The three-transaction launch, against the real PoolManager.
        shard.transfer(address(hook), SEED_AMOUNT);
        hook.setNFT(IShardNFTV1(address(nft)));
        hook.initialise();

        vm.deal(buyer, 100 ether);
        vm.deal(trader, 100 ether);
    }

    /// @dev The core supply invariant: the hook custodies exactly one SHARD per NFT not yet
    ///      circulating, plus the rounding dust the seed left behind.
    function _assertBacking() internal view {
        assertEq(
            shard.balanceOf(address(hook)),
            nft.circulatingSupply() * ONE_SHARD + hook.seedDust(),
            "shard backing != circulating NFTs"
        );
    }

    /// @dev The pinned check that the fork actually gave us the canonical v4 PoolManager and not an
    ///      empty account or some other contract at that address.
    function test_forkExposesTheRealMainnetPoolManager() public view {
        assertGt(POOL_MANAGER.code.length, 0, "no PoolManager code on the fork");
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_CODE_HASH, "PoolManager runtime code is not the pinned v4");
        assertTrue(hook.initialised(), "locked position never initialised on Mainnet v4");
    }

    /// @notice Deploy, wire, initialise, then run the whole market — third-party swap, redeem,
    ///         hook-market buy and sell, all three claim paths and a donation — against real v4,
    ///         asserting the backing invariant survives every step.
    function test_fullShardLifecycleAgainstMainnetV4() public {
        _assertBacking();

        // A first-batch buyer takes ten pieces off the curve.
        vm.prank(buyer);
        uint256[] memory bought = hook.buyMany{ value: 10 ether }(10, 10 ether, deadline);
        assertEq(bought.length, 10, "first batch did not mint ten NFTs");
        assertEq(nft.ownerOf(bought[0]), buyer, "buyer does not own the first piece");
        assertGt(_feesHeld(), 0, "the buy charged no fee");
        _assertBacking();

        // Holders earn from the block AFTER acquisition, so roll one block before fees are charged.
        vm.roll(block.number + 1);

        // An ordinary third-party swap through the model's router pays the 1% like any other trade.
        // Kept under the model's 50-SHARD per-swap third-party cap, and above the one SHARD a redeem
        // needs.
        uint256 feesBeforeSwap = _feesHeld();
        vm.prank(trader);
        uint256 shardOut = swapRouter.swapEthForShard{ value: 0.04 ether }(key, 0, deadline);
        assertGe(shardOut, ONE_SHARD, "swap returned less than one SHARD");
        assertLe(shardOut, 50 * ONE_SHARD, "swap somehow exceeded the third-party cap");
        assertGt(_feesHeld(), feesBeforeSwap, "third-party swap charged no fee");

        // The swap's SHARD redeems for a fresh NFT, without paying a second fee.
        uint256 feesBeforeRedeem = _feesHeld();
        vm.startPrank(trader);
        shard.approve(address(hook), type(uint256).max);
        uint256 redeemed = hook.redeem();
        vm.stopPrank();
        assertEq(nft.ownerOf(redeemed), trader, "redeemer does not own the piece");
        assertEq(_feesHeld(), feesBeforeRedeem, "redeem charged a fee it should not have");
        _assertBacking();

        // The buyer exits one piece back into the curve; the sell pays a fee too.
        uint256 feesBeforeSell = _feesHeld();
        vm.prank(buyer);
        uint256 payout = hook.sellNFT(bought[0], 0, deadline);
        assertGt(payout, 0, "sell paid nothing out");
        assertGt(_feesHeld(), feesBeforeSell, "sell charged no fee");
        _assertBacking();

        // A holder claims their share of everything that accrued while they held.
        vm.roll(block.number + 1);
        uint256[] memory claimIds = new uint256[](1);
        claimIds[0] = bought[1];
        uint256 holderBefore = buyer.balance;
        vm.prank(buyer);
        uint256 holderClaimed = hook.claim(claimIds);
        assertGt(holderClaimed, 0, "holder accrued nothing across the fee-charging blocks");
        assertEq(buyer.balance - holderBefore, holderClaimed, "holder claim did not pay out");

        // Both beneficiaries claim their fixed 0.10% cuts.
        assertGt(hook.builderFeesAccrued(), 0, "builder accrued nothing");
        assertGt(hook.launcherFeesAccrued(), 0, "launcher accrued nothing");

        uint256 builderBefore = builder.balance;
        vm.prank(builder);
        uint256 builderClaimed = hook.claimBuilderFees();
        assertEq(builder.balance - builderBefore, builderClaimed, "builder claim did not pay out");
        assertEq(hook.builderFeesAccrued(), 0, "builder accrual not zeroed after claim");

        uint256 launcherBefore = launcher.balance;
        vm.prank(launcher);
        uint256 launcherClaimed = hook.claimLauncherFees();
        assertEq(launcher.balance - launcherBefore, launcherClaimed, "launcher claim did not pay out");
        assertEq(hook.launcherFeesAccrued(), 0, "launcher accrual not zeroed after claim");

        // A donation reaches holders whole and never touches the backing.
        uint256 accBefore = hook.accFeePerNFT();
        vm.prank(trader);
        hook.donate{ value: 1 ether }();
        assertGt(hook.accFeePerNFT(), accBefore, "donation did not raise the holder accumulator");
        _assertBacking();
    }

    /// @notice The entropy source is an Arbitrum-only precompile; on Mainnet it returns zero. Art
    ///         must still regenerate from the remaining sources, so distinct acquisitions must still
    ///         carry distinct seeds and render distinct pieces.
    function test_entropyDegradesButArtStillRegeneratesOnMainnet() public {
        vm.startPrank(buyer);
        uint256 first = hook.buyNFT{ value: 1 ether }(type(uint256).max, deadline);
        vm.roll(block.number + 1);
        uint256 second = hook.buyNFT{ value: 1 ether }(type(uint256).max, deadline);
        vm.stopPrank();

        assertTrue(nft.tokenSeed(first) != nft.tokenSeed(second), "two acquisitions share a seed on Mainnet");
        assertGt(bytes(nft.tokenURI(first)).length, 0, "no art rendered for the first piece");
        assertGt(bytes(nft.tokenURI(second)).length, 0, "no art rendered for the second piece");
    }

    /// @dev ETH held for the hook, whether sitting as a v4 credit or as a plain balance.
    function _feesHeld() internal view returns (uint256) {
        return poolManager.balanceOf(address(hook), CurrencyLibrary.ADDRESS_ZERO.toId()) + address(hook).balance;
    }
}
