// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { LiquidityLauncher } from "@uniswap/liquidity-launcher/src/LiquidityLauncher.sol";
import { IDistributor } from "@uniswap/liquidity-launcher/src/interfaces/IDistributor.sol";
import { IDistributorFactory } from "@uniswap/liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {
    ILBPInitializer,
    LBPInitializationParams
} from "@uniswap/liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "@uniswap/liquidity-launcher/src/libraries/MigratorParams.sol";
import { LBPStrategy } from "@uniswap/liquidity-launcher/src/strategies/lbp/LBPStrategy.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { Distribution } from "@uniswap/liquidity-launcher/src/types/Distribution.sol";
import { PositionDefinition } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {
    AuctionParameters,
    IContinuousClearingAuction
} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import { ContinuousClearingAuction } from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import { ContinuousClearingAuctionFactory } from "continuous-clearing-auction/ContinuousClearingAuctionFactory.sol";
import { Test } from "forge-std/Test.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";
import { PlatformFeeHookV1 } from "../src/PlatformFeeHookV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract ContinuousClearingAuctionFactoryHarness is IDistributorFactory {
    ContinuousClearingAuctionFactory public immutable factory;
    ContinuousClearingAuction public lastAuction;

    constructor() {
        factory = new ContinuousClearingAuctionFactory(address(0));
    }

    function create(address token, uint256 amount, bytes calldata configData, bytes32 salt)
        external
        returns (IDistributor distributor)
    {
        distributor = factory.create(token, amount, configData, salt);
        lastAuction = ContinuousClearingAuction(payable(address(distributor)));
    }

    function getAddress(address token, uint256 amount, bytes calldata configData, bytes32 salt, address)
        external
        view
        returns (IDistributor distributor)
    {
        return factory.getAddress(token, amount, configData, salt, address(this));
    }
}

contract ContinuousClearingAuctionIntegrationTest is Test {
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;

    uint128 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint128 internal constant LP_RESERVE = 500_000_000 ether;
    uint64 internal constant START_BLOCK = 101;
    uint64 internal constant END_BLOCK = 1301;
    uint64 internal constant MIGRATION_BLOCK = 1302;
    uint256 internal constant FLOOR_PRICE_X96 = 792_281_625_142_643_375_900;
    uint256 internal constant AUCTION_TICK_SPACING_X96 = 7_922_816_251_426_433_759;
    uint128 internal constant REQUIRED_CURRENCY_RAISED = 4_999_999_999_999_999_999;
    uint128 internal constant BID_AMOUNT = 6 ether;

    IPoolManager internal manager;
    IPositionManager internal positionManager;
    LiquidityLauncher internal launcher;
    UERC20Factory internal tokenFactory;
    ContinuousClearingAuctionFactoryHarness internal auctionFactory;
    LBPStrategy internal strategy;
    PlatformFeeHookFactoryV1 internal hookFactory;
    PlatformFeeHookV1 internal hook;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    PositionFeesForwarder internal positionForwarder;

    address internal tokenAddress;
    address internal feeRecipient;
    address internal tokensRecipient;
    address internal positionRecipient;
    address internal migrationRecipient;

    function setUp() public {
        vm.roll(100);
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = IPositionManager(CANONICAL_POSITION_MANAGER);

        launcher = new LiquidityLauncher(IAllowanceTransfer(address(0x1000)));
        tokenFactory = new UERC20Factory();
        auctionFactory = new ContinuousClearingAuctionFactoryHarness();
        hookFactory = new PlatformFeeHookFactoryV1();

        feeRecipient = makeAddr("ccaFeeRecipient");
        tokensRecipient = makeAddr("ccaUnsoldTokensRecipient");
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        positionForwarder = positionForwarderFactory.deploy(keccak256("cca-standard-position"), tokensRecipient);
        positionRecipient = address(positionForwarder);
        migrationRecipient = makeAddr("ccaMigrationRecipient");

        bytes memory strategyArgs = abi.encode(positionManager, manager, auctionFactory);
        (address strategyAddress, bytes32 strategySalt) =
            HookMiner.find(address(this), Hooks.BEFORE_INITIALIZE_FLAG, type(LBPStrategy).creationCode, strategyArgs);
        strategy = new LBPStrategy{ salt: strategySalt }(positionManager, manager, auctionFactory);
        assertEq(address(strategy), strategyAddress);

        tokenAddress = tokenFactory.getUERC20Address(
            "Auction Launch Token", "ALT", 18, address(launcher), launcher.getGraffiti(address(this))
        );

        uint160 hookFlags =
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
        bytes memory hookArgs = abi.encode(
            manager, address(strategy), feeRecipient, Currency.wrap(address(0)), Currency.wrap(tokenAddress)
        );
        (address hookAddress, bytes32 hookSalt) =
            HookMiner.find(address(hookFactory), hookFlags, type(PlatformFeeHookV1).creationCode, hookArgs);
        hook = hookFactory.deploy(
            hookSalt, manager, address(strategy), feeRecipient, Currency.wrap(address(0)), Currency.wrap(tokenAddress)
        );
        assertEq(address(hook), hookAddress);
    }

    function test_realAuctionBidsFinalizeAndMigrateIntoBoundV4Pool() public {
        _launch();
        IContinuousClearingAuction auction = IContinuousClearingAuction(address(auctionFactory.lastAuction()));

        assertEq(auction.token(), tokenAddress);
        assertEq(auction.currency(), address(0));
        assertEq(auction.fundsRecipient(), address(strategy));
        assertEq(auction.tokensRecipient(), tokensRecipient);
        assertEq(IERC20(tokenAddress).balanceOf(address(auction)), TOTAL_SUPPLY - LP_RESERVE);
        assertEq(positionForwarder.operator(), address(0));
        assertEq(positionForwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(positionForwarder.feeRecipient(), tokensRecipient);

        address bidder = makeAddr("ccaBidder");
        vm.deal(bidder, BID_AMOUNT);
        vm.roll(START_BLOCK);
        vm.prank(bidder);
        auction.submitBid{ value: BID_AMOUNT }(
            FLOOR_PRICE_X96 + AUCTION_TICK_SPACING_X96, BID_AMOUNT, bidder, bytes("")
        );

        vm.roll(END_BLOCK);
        auction.checkpoint();
        assertTrue(auction.isGraduated());

        LBPInitializationParams memory result = auction.lbpInitializationParams();
        assertGt(result.tokensSold, 0);
        assertGe(result.currencyRaised, REQUIRED_CURRENCY_RAISED);
        assertLe(result.currencyRaised, BID_AMOUNT);
        assertGe(result.initialPriceX96, FLOOR_PRICE_X96);

        vm.roll(MIGRATION_BLOCK);
        strategy.migrate(ILBPInitializer(address(auction)));

        PoolKey memory expectedKey = hook.poolKey();
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(expectedKey.toId());
        assertGt(sqrtPriceX96, 0, "CCA migration did not initialize pool");
        assertEq(strategy.registeredPoolIds(expectedKey.toId()), address(0));
        assertGt(IERC721(address(positionManager)).balanceOf(positionRecipient), 0, "CCA LP position not minted");
    }

    function _launch() private {
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({ lowerThreshold: 0, rate: 10_000_000 });
        PositionDefinition[] memory positions = new PositionDefinition[](1);
        positions[0] = PositionDefinition({
            offsetLower: -887_272, offsetUpper: 887_272, weight: 10_000_000, overridePositionRecipient: address(0)
        });

        AuctionParameters memory auctionParameters = AuctionParameters({
            currency: address(0),
            tokensRecipient: tokensRecipient,
            fundsRecipient: address(strategy),
            startBlock: START_BLOCK,
            endBlock: END_BLOCK,
            claimBlock: END_BLOCK,
            tickSpacing: AUCTION_TICK_SPACING_X96,
            validationHook: address(0),
            floorPrice: FLOOR_PRICE_X96,
            requiredCurrencyRaised: REQUIRED_CURRENCY_RAISED,
            auctionStepsData: hex"000f17000000009700135000000000760014e8000000006d001657000000006600174000000000620017fc000000005f0018c5000000005c001951000000005a0019e50000000058001a310000000057001acf0000000055001b2000000000542dc6b90000000001"
        });

        MigratorParameters memory parameters = MigratorParameters({
            token: tokenAddress,
            currency: address(0),
            migrationBlock: MIGRATION_BLOCK,
            reservedTokenAmountForLP: LP_RESERVE,
            recipient: migrationRecipient,
            positionRecipient: positionRecipient,
            poolParameters: PoolParameters({
                fee: hook.LP_FEE_PIPS(), tickSpacing: hook.TICK_SPACING(), hook: address(hook)
            }),
            positionDefinitions: abi.encode(positions),
            lpAllocationSchedule: abi.encode(brackets)
        });

        Distribution memory distribution = Distribution({
            strategy: address(strategy),
            amount: TOTAL_SUPPLY,
            configData: abi.encode(parameters, abi.encode(auctionParameters))
        });
        UERC20Metadata memory metadata =
            UERC20Metadata({ description: "CCA integration fixture.", website: "", image: "", xProofTweetId: 0 });

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(
            LiquidityLauncher.createToken.selector,
            address(tokenFactory),
            "Auction Launch Token",
            "ALT",
            18,
            TOTAL_SUPPLY,
            address(launcher),
            abi.encode(metadata)
        );
        calls[1] =
            abi.encodeWithSelector(LiquidityLauncher.distributeToken.selector, tokenAddress, distribution, bytes32(0));

        launcher.multicall(calls);
    }
}
