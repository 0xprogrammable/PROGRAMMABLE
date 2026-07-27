// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { LiquidityLauncher } from "@uniswap/liquidity-launcher/src/LiquidityLauncher.sol";
import { IDistributor } from "@uniswap/liquidity-launcher/src/interfaces/IDistributor.sol";
import { IDistributorFactory } from "@uniswap/liquidity-launcher/src/interfaces/IDistributorFactory.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import {
    ILBPInitializer,
    ILBP_INITIALIZER_INTERFACE_ID,
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
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PositionManager } from "@uniswap/v4-periphery/src/PositionManager.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { IAllowanceTransfer } from "permit2/src/interfaces/IAllowanceTransfer.sol";

import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";

import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";
import { PlatformFeeHookV1 } from "../src/PlatformFeeHookV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";

contract LaunchPathInitializerMock is ILBPInitializer {
    using SafeERC20 for IERC20;

    address public immutable override token;
    address public immutable override currency;
    uint128 public immutable override totalSupply;
    address public immutable override tokensRecipient;
    address public immutable override fundsRecipient;
    uint64 public immutable override startBlock;
    uint64 public immutable override endBlock;

    LBPInitializationParams private _lbpParameters;

    constructor(
        address token_,
        address currency_,
        uint128 totalSupply_,
        address tokensRecipient_,
        address fundsRecipient_,
        uint64 startBlock_,
        uint64 endBlock_,
        LBPInitializationParams memory lbpParameters_
    ) {
        token = token_;
        currency = currency_;
        totalSupply = totalSupply_;
        tokensRecipient = tokensRecipient_;
        fundsRecipient = fundsRecipient_;
        startBlock = startBlock_;
        endBlock = endBlock_;
        _lbpParameters = lbpParameters_;
    }

    function lbpInitializationParams() external view returns (LBPInitializationParams memory) {
        return _lbpParameters;
    }

    function onTokensReceived() external view {
        require(IERC20(token).balanceOf(address(this)) == totalSupply, "initializer funding mismatch");
    }

    function sweepCurrency() external {
        uint256 amount = _lbpParameters.currencyRaised;
        if (amount == 0) return;

        if (currency == address(0)) {
            (bool success,) = payable(fundsRecipient).call{ value: amount }("");
            require(success, "native sweep failed");
        } else {
            IERC20(currency).safeTransfer(fundsRecipient, amount);
        }
    }

    function sweepUnsoldTokens() external {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) IERC20(token).safeTransfer(tokensRecipient, balance);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == ILBP_INITIALIZER_INTERFACE_ID || interfaceId == type(IERC165).interfaceId;
    }

    receive() external payable {
        // The mock holds auction proceeds until migration.
    }
}

    contract LaunchPathInitializerFactoryMock is IDistributorFactory {
        LaunchPathInitializerMock public deployedInitializer;

        function create(address token, uint256 totalSupply, bytes calldata configData, bytes32)
            external
            returns (IDistributor distributor)
        {
            (uint64 endBlock, address currency, address tokensRecipient, LBPInitializationParams memory lbpParameters) =
                abi.decode(configData, (uint64, address, address, LBPInitializationParams));

            deployedInitializer = new LaunchPathInitializerMock(
                token,
                currency,
                SafeCast.toUint128(totalSupply),
                tokensRecipient,
                msg.sender,
                uint64(block.number),
                endBlock,
                lbpParameters
            );
            return IDistributor(address(deployedInitializer));
        }

        function getAddress(address, uint256, bytes calldata, bytes32, address)
            external
            view
            returns (IDistributor distributor)
        {
            return IDistributor(address(deployedInitializer));
        }
    }

    contract OfficialLaunchPathIntegrationTest is Deployers {
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
        PlatformFeeHookFactoryV1 internal hookFactory;
        PlatformFeeHookV1 internal hook;
        IPositionManager internal positionManager;
        LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
        PositionFeesForwarder internal positionForwarder;

        address internal tokenAddress;
        address internal feeRecipient;
        address internal lpFeeRecipient;
        address internal tokensRecipient;
        address internal positionRecipient;

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
            hookFactory = new PlatformFeeHookFactoryV1();

            feeRecipient = makeAddr("platformFeeRecipient");
            lpFeeRecipient = makeAddr("launchCreator");
            tokensRecipient = makeAddr("unsoldTokensRecipient");

            positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
            positionForwarder = positionForwarderFactory.deploy(keccak256("verified-launch-position"), lpFeeRecipient);
            positionRecipient = address(positionForwarder);

            bytes memory strategyConstructorArgs = abi.encode(positionManager, manager, initializerFactory);
            (address strategyAddress, bytes32 strategySalt) = HookMiner.find(
                address(this), Hooks.BEFORE_INITIALIZE_FLAG, type(LBPStrategy).creationCode, strategyConstructorArgs
            );
            strategy = new LBPStrategy{ salt: strategySalt }(positionManager, manager, initializerFactory);
            assertEq(address(strategy), strategyAddress);

            tokenAddress = tokenFactory.getUERC20Address(
                "Verified Launch Token", "VLT", 18, address(launcher), launcher.getGraffiti(address(this))
            );

            uint160 hookFlags =
                uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
            bytes memory hookConstructorArgs = abi.encode(
                manager, address(strategy), feeRecipient, Currency.wrap(address(0)), Currency.wrap(tokenAddress)
            );
            (address hookAddress, bytes32 hookSalt) =
                HookMiner.find(
                    address(hookFactory), hookFlags, type(PlatformFeeHookV1).creationCode, hookConstructorArgs
                );
            hook = hookFactory.deploy(
                hookSalt,
                manager,
                address(strategy),
                feeRecipient,
                Currency.wrap(address(0)),
                Currency.wrap(tokenAddress)
            );
            assertEq(address(hook), hookAddress);
        }

        function test_atomicOfficialTokenCreationAndStrategyRegistration() public {
            _executeLaunch();

            LaunchPathInitializerMock initializer = initializerFactory.deployedInitializer();
            PoolKey memory expectedKey = hook.poolKey();
            MigratorParameters memory stored = strategy.initializers(initializer);

            assertGt(tokenAddress.code.length, 0);
            assertEq(IERC20(tokenAddress).totalSupply(), TOTAL_SUPPLY);
            assertEq(IERC20(tokenAddress).balanceOf(address(launcher)), 0);
            assertEq(IERC20(tokenAddress).balanceOf(address(strategy)), LP_RESERVE);
            assertEq(IERC20(tokenAddress).balanceOf(address(initializer)), TOTAL_SUPPLY - LP_RESERVE);

            assertEq(UERC20(tokenAddress).creator(), address(launcher));
            assertEq(UERC20(tokenAddress).graffiti(), launcher.getGraffiti(address(this)));

            assertEq(stored.token, tokenAddress);
            assertEq(stored.currency, address(0));
            assertEq(stored.poolParameters.hook, address(hook));
            assertEq(stored.poolParameters.fee, hook.LP_FEE_PIPS());
            assertEq(stored.poolParameters.tickSpacing, hook.TICK_SPACING());
            assertEq(stored.reservedTokenAmountForLP, LP_RESERVE);
            assertEq(stored.positionRecipient, positionRecipient);
            assertEq(positionForwarder.operator(), address(0));
            assertEq(positionForwarder.timelockBlockNumber(), type(uint256).max);
            assertEq(positionForwarder.feeRecipient(), lpFeeRecipient);
            assertTrue(positionForwarderFactory.isFactoryForwarder(positionRecipient));
            assertEq(hook.authorized(), address(strategy));
            assertEq(strategy.registeredPoolIds(expectedKey.toId()), address(initializer));
            assertEq(hook.poolId(), PoolId.unwrap(expectedKey.toId()));
        }

        function test_migrationInitializesBoundPoolAndCollectsFeeAfterSwap() public {
            _executeLaunch();

            LaunchPathInitializerMock initializer = initializerFactory.deployedInitializer();
            PoolKey memory expectedKey = hook.poolKey();

            vm.deal(address(initializer), CURRENCY_RAISED);
            vm.roll(201);
            strategy.migrate(initializer);

            (uint160 sqrtPriceX96,,,) = manager.getSlot0(expectedKey.toId());
            assertGt(sqrtPriceX96, 0, "pool not initialized");
            assertEq(strategy.registeredPoolIds(expectedKey.toId()), address(0));
            assertGt(IERC721(address(positionManager)).balanceOf(positionRecipient), 0, "position not minted");
            uint256 positionTokenId = positionManager.nextTokenId() - 1;
            assertEq(IERC721(address(positionManager)).ownerOf(positionTokenId), positionRecipient);

            _assertPositionLocked(positionTokenId);
            _executeBidirectionalSwapsAndCollectPlatformFees(initializer, expectedKey);
            _collectAndAssertLpFees(positionTokenId);
        }

        function test_nonAtomicCreationLeavesNoReusableTokenAddress() public {
            UERC20Metadata memory metadata;
            launcher.createToken(
                address(tokenFactory),
                "Verified Launch Token",
                "VLT",
                18,
                TOTAL_SUPPLY,
                address(launcher),
                abi.encode(metadata)
            );

            assertEq(IERC20(tokenAddress).balanceOf(address(launcher)), TOTAL_SUPPLY);

            vm.expectRevert();
            launcher.createToken(
                address(tokenFactory),
                "Verified Launch Token",
                "VLT",
                18,
                TOTAL_SUPPLY,
                address(launcher),
                abi.encode(metadata)
            );
        }

        function _executeBidirectionalSwapsAndCollectPlatformFees(
            LaunchPathInitializerMock initializer,
            PoolKey memory expectedKey
        ) private {
            PoolSwapTest router = new PoolSwapTest(manager);
            PoolSwapTest.TestSettings memory settings =
                PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
            address trader = makeAddr("postMigrationTrader");
            uint256 amountIn = 0.01 ether;
            vm.deal(trader, amountIn);

            vm.prank(trader);
            router.swap{ value: amountIn }(
                expectedKey,
                SwapParams({
                    zeroForOne: true,
                    amountSpecified: -SafeCast.toInt256(amountIn),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                settings,
                ""
            );

            Currency launchedToken = Currency.wrap(tokenAddress);
            uint256 accrued = manager.balanceOf(address(hook), launchedToken.toId());
            assertGt(accrued, 0, "platform fee not accrued");

            uint256 recipientBalanceBefore = launchedToken.balanceOf(feeRecipient);
            vm.prank(makeAddr("permissionlessFeeCollector"));
            hook.handleHookFees(new Currency[](0));

            assertEq(launchedToken.balanceOf(feeRecipient), recipientBalanceBefore + accrued);
            assertEq(manager.balanceOf(address(hook), launchedToken.toId()), 0);

            initializer.sweepUnsoldTokens();
            vm.startPrank(tokensRecipient);
            IERC20(tokenAddress).approve(address(router), type(uint256).max);
            router.swap(
                expectedKey,
                SwapParams({
                    zeroForOne: false, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                settings,
                ""
            );
            vm.stopPrank();

            Currency nativeCurrency = Currency.wrap(address(0));
            uint256 nativeAccrued = manager.balanceOf(address(hook), nativeCurrency.toId());
            assertGt(nativeAccrued, 0, "native platform fee not accrued");

            uint256 nativeRecipientBalanceBefore = feeRecipient.balance;
            hook.handleHookFees(new Currency[](0));
            assertEq(feeRecipient.balance, nativeRecipientBalanceBefore + nativeAccrued);
            assertEq(manager.balanceOf(address(hook), nativeCurrency.toId()), 0);
        }

        function _assertPositionLocked(uint256 positionTokenId) private {
            vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
            positionForwarder.approveOperator();

            vm.prank(lpFeeRecipient);
            vm.expectRevert();
            IERC721(address(positionManager)).transferFrom(positionRecipient, lpFeeRecipient, positionTokenId);
        }

        function _collectAndAssertLpFees(uint256 positionTokenId) private {
            Currency launchedToken = Currency.wrap(tokenAddress);
            uint128 liquidityBeforeCollection = positionManager.getPositionLiquidity(positionTokenId);
            uint256 creatorTokenBalanceBefore = launchedToken.balanceOf(lpFeeRecipient);
            uint256 creatorNativeBalanceBefore = lpFeeRecipient.balance;

            vm.prank(makeAddr("permissionlessLpFeeCollector"));
            positionForwarder.collectFees(positionTokenId);

            assertEq(positionManager.getPositionLiquidity(positionTokenId), liquidityBeforeCollection);
            assertGt(launchedToken.balanceOf(lpFeeRecipient), creatorTokenBalanceBefore);
            assertGt(lpFeeRecipient.balance, creatorNativeBalanceBefore);
            assertEq(IERC721(address(positionManager)).ownerOf(positionTokenId), positionRecipient);
        }

        function _executeLaunch() private {
            bytes memory configData = _configData();
            Distribution memory distribution =
                Distribution({ strategy: address(strategy), amount: TOTAL_SUPPLY, configData: configData });

            UERC20Metadata memory metadata = UERC20Metadata({
                description: "Integration fixture for the verified Launcher path.",
                website: "",
                image: "",
                extraData: bytes("")
            });

            bytes[] memory calls = new bytes[](2);
            calls[0] = abi.encodeWithSelector(
                LiquidityLauncher.createToken.selector,
                address(tokenFactory),
                "Verified Launch Token",
                "VLT",
                18,
                TOTAL_SUPPLY,
                address(launcher),
                abi.encode(metadata)
            );
            calls[1] = abi.encodeWithSelector(
                LiquidityLauncher.distributeToken.selector, tokenAddress, distribution, bytes32(0)
            );

            launcher.multicall(calls);
        }

        function _configData() private returns (bytes memory) {
            LiquidityAllocationBracket[] memory brackets = new LiquidityAllocationBracket[](1);
            brackets[0] = LiquidityAllocationBracket({ lowerThreshold: 0, rate: 10_000_000 });

            PositionDefinition[] memory positions = new PositionDefinition[](0);
            MigratorParameters memory parameters = MigratorParameters({
                token: tokenAddress,
                currency: address(0),
                migrationBlock: 201,
                reservedTokenAmountForLP: LP_RESERVE,
                recipient: makeAddr("migrationRemainderRecipient"),
                positionRecipient: positionRecipient,
                poolParameters: PoolParameters({
                    fee: hook.LP_FEE_PIPS(), tickSpacing: hook.TICK_SPACING(), hook: address(hook)
                }),
                positionDefinitions: abi.encode(positions),
                lpAllocationSchedule: abi.encode(brackets)
            });

            bytes memory initializerParameters = abi.encode(
                uint64(200),
                address(0),
                tokensRecipient,
                LBPInitializationParams({ initialPriceX96: 2 ** 96, tokensSold: 1, currencyRaised: CURRENCY_RAISED })
            );
            return abi.encode(parameters, initializerParameters);
        }
    }
