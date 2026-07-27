// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { LiquidityLauncher } from "@uniswap/liquidity-launcher/src/LiquidityLauncher.sol";
import {
    ILBPInitializer,
    LBPInitializationParams
} from "@uniswap/liquidity-launcher/src/interfaces/ILBPInitializer.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import {
    LiquidityAllocationBracket,
    MigratorParameters,
    PoolParameters
} from "@uniswap/liquidity-launcher/src/libraries/MigratorParams.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { LBPStrategy } from "@uniswap/liquidity-launcher/src/strategies/lbp/LBPStrategy.sol";
import { Distribution } from "@uniswap/liquidity-launcher/src/types/Distribution.sol";
import { PositionDefinition } from "@uniswap/liquidity-launcher/src/types/PositionPlannerTypes.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { BoundedDynamicFeeHookFactoryV1 } from "../src/BoundedDynamicFeeHookFactoryV1.sol";
import { BoundedDynamicFeeHookV1 } from "../src/BoundedDynamicFeeHookV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { LaunchPathInitializerFactoryMock, LaunchPathInitializerMock } from "./OfficialLaunchPathIntegration.t.sol";

contract DynamicFeeAuctionLaunchPathIntegrationTest is Deployers {
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;

    uint128 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint128 internal constant LP_RESERVE = 200_000_000 ether;
    uint256 internal constant CURRENCY_RAISED = 100 ether;

    LiquidityLauncher internal launcher;
    UERC20Factory internal tokenFactory;
    LBPStrategy internal strategy;
    LaunchPathInitializerFactoryMock internal initializerFactory;
    BoundedDynamicFeeHookFactoryV1 internal hookFactory;
    BoundedDynamicFeeHookV1 internal hook;
    IPositionManager internal positionManager;
    PositionFeesForwarder internal positionForwarder;

    address internal tokenAddress;
    address internal platformFeeRecipient;
    address internal creator;

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
        initializerFactory = new LaunchPathInitializerFactoryMock();
        hookFactory = new BoundedDynamicFeeHookFactoryV1();
        platformFeeRecipient = makeAddr("dynamicPlatformFeeRecipient");
        creator = makeAddr("dynamicLaunchCreator");

        bytes memory strategyConstructorArgs = abi.encode(positionManager, manager, initializerFactory);
        (address strategyAddress, bytes32 strategySalt) = HookMiner.find(
            address(this), Hooks.BEFORE_INITIALIZE_FLAG, type(LBPStrategy).creationCode, strategyConstructorArgs
        );
        strategy = new LBPStrategy{ salt: strategySalt }(positionManager, manager, initializerFactory);
        assertEq(address(strategy), strategyAddress);

        tokenAddress = tokenFactory.getUERC20Address(
            "Dynamic Auction Token", "DAT", 18, address(launcher), launcher.getGraffiti(address(this))
        );

        (, bytes32 hookSalt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(BoundedDynamicFeeHookV1).creationCode,
            abi.encode(
                manager, address(strategy), platformFeeRecipient, Currency.wrap(address(0)), Currency.wrap(tokenAddress)
            )
        );
        hook = hookFactory.deploy(
            hookSalt,
            manager,
            address(strategy),
            platformFeeRecipient,
            Currency.wrap(address(0)),
            Currency.wrap(tokenAddress)
        );

        LockedPositionFeeForwarderFactoryV1 positionFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        positionForwarder = positionFactory.deploy(keccak256("dynamic-launch-position"), creator);
    }

    function test_officialAuctionMigrationInstallsAndUpdatesBoundedDynamicFee() public {
        _executeLaunch();

        LaunchPathInitializerMock initializer = initializerFactory.deployedInitializer();
        PoolKey memory expectedKey = hook.poolKey();
        MigratorParameters memory stored = strategy.initializers(initializer);

        assertEq(stored.poolParameters.fee, LPFeeLibrary.DYNAMIC_FEE_FLAG);
        assertEq(stored.poolParameters.tickSpacing, hook.TICK_SPACING());
        assertEq(stored.poolParameters.hook, address(hook));
        assertEq(hook.authorized(), address(strategy));
        assertEq(strategy.registeredPoolIds(expectedKey.toId()), address(initializer));

        vm.deal(address(initializer), CURRENCY_RAISED);
        vm.roll(201);
        strategy.migrate(initializer);

        (uint160 sqrtPriceX96, int24 initialTick,, uint24 installedBaseFee) = manager.getSlot0(expectedKey.toId());
        assertGt(sqrtPriceX96, 0);
        assertEq(installedBaseFee, hook.BASE_LP_FEE_PIPS());
        assertEq(hook.currentLpFee(), hook.BASE_LP_FEE_PIPS());
        assertEq(
            IERC721(address(positionManager)).ownerOf(positionManager.nextTokenId() - 1), address(positionForwarder)
        );

        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        positionForwarder.approveOperator();

        PoolSwapTest router = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
        address trader = makeAddr("dynamicPostMigrationTrader");
        vm.deal(trader, 1 ether);

        vm.prank(trader);
        router.swap{ value: 0.05 ether }(
            expectedKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.05 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );
        (, int24 movedTick,, uint24 sameBlockFee) = manager.getSlot0(expectedKey.toId());
        assertNotEq(movedTick, initialTick);
        assertEq(sameBlockFee, hook.BASE_LP_FEE_PIPS());

        vm.roll(block.number + 1);
        vm.prank(trader);
        router.swap{ value: 0.01 ether }(
            expectedKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.01 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );

        (,,, uint24 dynamicFee) = manager.getSlot0(expectedKey.toId());
        assertEq(dynamicFee, hook.currentLpFee());
        assertEq(hook.referenceTick(), movedTick);
        assertGt(dynamicFee, hook.BASE_LP_FEE_PIPS());
        assertLe(dynamicFee, hook.MAX_LP_FEE_PIPS());

        Currency launchedToken = Currency.wrap(tokenAddress);
        uint256 accruedPlatformFee = manager.balanceOf(address(hook), launchedToken.toId());
        assertGt(accruedPlatformFee, 0);
        uint256 treasuryBefore = launchedToken.balanceOf(platformFeeRecipient);

        vm.prank(makeAddr("dynamicPermissionlessCollector"));
        hook.handleHookFees(new Currency[](0));

        assertEq(launchedToken.balanceOf(platformFeeRecipient), treasuryBefore + accruedPlatformFee);
        assertEq(manager.balanceOf(address(hook), launchedToken.toId()), 0);
    }

    function _executeLaunch() private {
        Distribution memory distribution =
            Distribution({ strategy: address(strategy), amount: TOTAL_SUPPLY, configData: _configData() });
        UERC20Metadata memory metadata = UERC20Metadata({
            description: "Integration fixture for the bounded dynamic fee auction path.",
            website: "",
            image: "",
            extraData: bytes("")
        });

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(
            LiquidityLauncher.createToken.selector,
            address(tokenFactory),
            "Dynamic Auction Token",
            "DAT",
            18,
            TOTAL_SUPPLY,
            address(launcher),
            abi.encode(metadata)
        );
        calls[1] =
            abi.encodeWithSelector(LiquidityLauncher.distributeToken.selector, tokenAddress, distribution, bytes32(0));
        launcher.multicall(calls);
    }

    function _configData() private view returns (bytes memory) {
        LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
        brackets[0] = LiquidityAllocationBracket({ lowerThreshold: 0, rate: 10_000_000 });

        PositionDefinition[] memory positions = new PositionDefinition[](0);
        MigratorParameters memory parameters = MigratorParameters({
            token: tokenAddress,
            currency: address(0),
            migrationBlock: 201,
            reservedTokenAmountForLP: LP_RESERVE,
            recipient: creator,
            positionRecipient: address(positionForwarder),
            poolParameters: PoolParameters({
                fee: LPFeeLibrary.DYNAMIC_FEE_FLAG, tickSpacing: hook.TICK_SPACING(), hook: address(hook)
            }),
            positionDefinitions: abi.encode(positions),
            lpAllocationSchedule: abi.encode(brackets)
        });

        bytes memory initializerParameters = abi.encode(
            uint64(200),
            address(0),
            creator,
            LBPInitializationParams({ initialPriceX96: 2 ** 96, tokensSold: 1, currencyRaised: CURRENCY_RAISED })
        );
        return abi.encode(parameters, initializerParameters);
    }
}
