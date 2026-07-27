// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
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

import { DirectLiquidityLauncherV1 } from "../src/DirectLiquidityLauncherV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { PlatformFeeHookFactoryV1 } from "../src/PlatformFeeHookFactoryV1.sol";
import { PlatformFeeHookV1 } from "../src/PlatformFeeHookV1.sol";

contract DirectLiquidityLauncherV1Test is Deployers {
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;

    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant TOKEN_LIQUIDITY = 10 ether;
    uint256 internal constant NATIVE_LIQUIDITY = 10 ether;
    bytes32 internal constant CREATOR_SALT = keccak256("direct-launch-fixture");

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    PlatformFeeHookFactoryV1 internal hookFactory;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    DirectLiquidityLauncherV1 internal launcher;

    address internal creator;
    address internal platformFeeRecipient;
    address internal tokenAddress;
    bytes32 internal effectiveGraffiti;
    bytes32 internal hookSalt;

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = IPositionManager(CANONICAL_POSITION_MANAGER);

        tokenFactory = new UERC20Factory();
        hookFactory = new PlatformFeeHookFactoryV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        platformFeeRecipient = makeAddr("directPlatformTreasury");
        launcher = new DirectLiquidityLauncherV1(
            manager, positionManager, tokenFactory, hookFactory, positionForwarderFactory, platformFeeRecipient
        );

        creator = makeAddr("directLaunchCreator");
        vm.deal(creator, 100 ether);

        (tokenAddress, effectiveGraffiti) =
            launcher.predictTokenAddress("Direct Launch Token", "DLT", creator, CREATOR_SALT);

        uint160 flags =
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);
        (, hookSalt) = HookMiner.find(
            address(hookFactory),
            flags,
            type(PlatformFeeHookV1).creationCode,
            abi.encode(
                manager, address(launcher), platformFeeRecipient, Currency.wrap(address(0)), Currency.wrap(tokenAddress)
            )
        );
    }

    function test_launchesFixedSupplyTokenIntoLockedV4Position() public {
        DirectLiquidityLauncherV1.LaunchResult memory result = _launch();
        PlatformFeeHookV1 hook = PlatformFeeHookV1(result.hook);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        PoolKey memory poolKey = hook.poolKey();

        assertEq(result.token, tokenAddress);
        assertEq(result.positionTokenId, positionManager.nextTokenId() - 1);
        assertEq(result.nativeLiquidityAmount, NATIVE_LIQUIDITY);
        assertEq(result.tokenLiquidityAmount, TOKEN_LIQUIDITY);
        assertEq(result.poolId, hook.poolId());
        assertEq(result.launchHash, launcher.launchHashOf(tokenAddress));
        assertTrue(result.launchHash != bytes32(0));

        assertEq(IERC20(tokenAddress).totalSupply(), TOTAL_SUPPLY);
        assertEq(IERC20(tokenAddress).balanceOf(address(launcher)), 0);
        assertEq(IERC20(tokenAddress).balanceOf(creator), TOTAL_SUPPLY - TOKEN_LIQUIDITY);
        assertLt(IERC20(tokenAddress).balanceOf(creator), TOTAL_SUPPLY);
        assertEq(address(launcher).balance, 0);
        assertEq(UERC20(tokenAddress).creator(), address(launcher));
        assertEq(UERC20(tokenAddress).graffiti(), effectiveGraffiti);

        (uint160 sqrtPriceX96,,,) = manager.getSlot0(poolKey.toId());
        assertEq(sqrtPriceX96, SQRT_PRICE_1_1);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);

        assertEq(hook.authorized(), address(launcher));
        assertEq(hook.feeRecipient(), platformFeeRecipient);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertTrue(positionForwarderFactory.isFactoryForwarder(result.positionRecipient));
        assertEq(launcher.predictPositionRecipient(tokenAddress, creator), result.positionRecipient);

        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();

        vm.expectRevert();
        vm.prank(creator);
        IERC721(address(positionManager)).transferFrom(result.positionRecipient, creator, result.positionTokenId);
    }

    function test_bidirectionalSwapsAccrueSeparatePlatformAndCreatorFees() public {
        DirectLiquidityLauncherV1.LaunchResult memory result = _launch();
        PlatformFeeHookV1 hook = PlatformFeeHookV1(result.hook);
        PoolKey memory poolKey = hook.poolKey();
        address trader = makeAddr("directLaunchTrader");

        _buyAndCollectTokenPlatformFees(hook, poolKey, trader);
        _sellAndCollectNativePlatformFees(hook, poolKey, trader);
        _collectCreatorLpFees(result);
    }

    function _buyAndCollectTokenPlatformFees(PlatformFeeHookV1 hook, PoolKey memory poolKey, address trader) private {
        PoolSwapTest router = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });

        vm.deal(trader, 1 ether);
        vm.prank(trader);
        router.swap{ value: 0.1 ether }(
            poolKey,
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.1 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );

        Currency launchedToken = Currency.wrap(tokenAddress);
        uint256 tokenPlatformFees = manager.balanceOf(address(hook), launchedToken.toId());
        assertGt(tokenPlatformFees, 0);
        uint256 treasuryTokenBefore = launchedToken.balanceOf(platformFeeRecipient);
        vm.prank(makeAddr("directPermissionlessPlatformCollector"));
        hook.handleHookFees(new Currency[](0));
        assertEq(launchedToken.balanceOf(platformFeeRecipient), treasuryTokenBefore + tokenPlatformFees);
    }

    function _sellAndCollectNativePlatformFees(PlatformFeeHookV1 hook, PoolKey memory poolKey, address trader) private {
        PoolSwapTest router = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
        Currency launchedToken = Currency.wrap(tokenAddress);
        uint256 traderTokenBalance = launchedToken.balanceOf(trader);
        vm.startPrank(trader);
        IERC20(tokenAddress).approve(address(router), type(uint256).max);
        router.swap(
            poolKey,
            SwapParams({
                zeroForOne: false,
                amountSpecified: -SafeCast.toInt256(traderTokenBalance / 2),
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            settings,
            ""
        );
        vm.stopPrank();

        Currency nativeCurrency = Currency.wrap(address(0));
        uint256 nativePlatformFees = manager.balanceOf(address(hook), nativeCurrency.toId());
        assertGt(nativePlatformFees, 0);
        uint256 treasuryNativeBefore = platformFeeRecipient.balance;
        hook.handleHookFees(new Currency[](0));
        assertEq(platformFeeRecipient.balance, treasuryNativeBefore + nativePlatformFees);
    }

    function _collectCreatorLpFees(DirectLiquidityLauncherV1.LaunchResult memory result) private {
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        Currency launchedToken = Currency.wrap(tokenAddress);
        uint128 liquidityBefore = positionManager.getPositionLiquidity(result.positionTokenId);
        uint256 creatorTokenBefore = launchedToken.balanceOf(creator);
        uint256 creatorNativeBefore = creator.balance;
        vm.prank(makeAddr("directPermissionlessLpCollector"));
        forwarder.collectFees(result.positionTokenId);

        assertEq(positionManager.getPositionLiquidity(result.positionTokenId), liquidityBefore);
        assertGt(launchedToken.balanceOf(creator), creatorTokenBefore);
        assertGt(creator.balance, creatorNativeBefore);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
    }

    function test_rejectsInvalidLaunchInputsBeforeCreatingToken() public {
        DirectLiquidityLauncherV1.LaunchParameters memory parameters = _parameters();

        parameters.totalSupply = 0;
        vm.expectRevert(abi.encodeWithSelector(DirectLiquidityLauncherV1.InvalidSupply.selector, 0, TOKEN_LIQUIDITY));
        vm.prank(creator);
        launcher.launch{ value: NATIVE_LIQUIDITY }(parameters);

        parameters = _parameters();
        parameters.initialSqrtPriceX96 = 0;
        vm.expectRevert(abi.encodeWithSelector(DirectLiquidityLauncherV1.InvalidInitialPrice.selector, 0));
        vm.prank(creator);
        launcher.launch{ value: NATIVE_LIQUIDITY }(parameters);

        parameters = _parameters();
        vm.expectRevert(DirectLiquidityLauncherV1.NoNativeLiquidity.selector);
        vm.prank(creator);
        launcher.launch(parameters);

        parameters = _parameters();
        parameters.totalSupply = uint256(type(uint128).max) + 1;
        parameters.tokenLiquidityAmount = uint256(type(uint128).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                DirectLiquidityLauncherV1.LiquidityBudgetTooLarge.selector,
                NATIVE_LIQUIDITY,
                uint256(type(uint128).max) + 1
            )
        );
        vm.prank(creator);
        launcher.launch{ value: NATIVE_LIQUIDITY }(parameters);

        assertEq(tokenAddress.code.length, 0);
    }

    function test_invalidHookSaltRollsBackTheEntireLaunch() public {
        DirectLiquidityLauncherV1.LaunchParameters memory parameters = _parameters();
        bytes32 invalidSalt;
        address predicted = hookFactory.predict(
            invalidSalt,
            manager,
            address(launcher),
            platformFeeRecipient,
            Currency.wrap(address(0)),
            Currency.wrap(tokenAddress)
        );
        uint160 actualFlags = uint160(predicted) & hookFactory.ALL_HOOK_MASK();

        while (actualFlags == hookFactory.REQUIRED_HOOK_FLAGS()) {
            invalidSalt = bytes32(uint256(invalidSalt) + 1);
            predicted = hookFactory.predict(
                invalidSalt,
                manager,
                address(launcher),
                platformFeeRecipient,
                Currency.wrap(address(0)),
                Currency.wrap(tokenAddress)
            );
            actualFlags = uint160(predicted) & hookFactory.ALL_HOOK_MASK();
        }
        parameters.hookSalt = invalidSalt;

        vm.expectRevert(
            abi.encodeWithSelector(
                PlatformFeeHookFactoryV1.InvalidHookAddress.selector,
                predicted,
                actualFlags,
                hookFactory.REQUIRED_HOOK_FLAGS()
            )
        );
        vm.prank(creator);
        launcher.launch{ value: NATIVE_LIQUIDITY }(parameters);

        assertEq(tokenAddress.code.length, 0);
        assertEq(launcher.launchHashOf(tokenAddress), bytes32(0));
        assertEq(launcher.predictPositionRecipient(tokenAddress, creator).code.length, 0);
    }

    function test_rejectsDuplicateTokenLaunch() public {
        _launch();

        vm.expectRevert(abi.encodeWithSelector(DirectLiquidityLauncherV1.TokenAlreadyExists.selector, tokenAddress));
        vm.prank(creator);
        launcher.launch{ value: NATIVE_LIQUIDITY }(_parameters());
    }

    function test_reusesMatchingFactoryDeploymentsInsteadOfAllowingMempoolGriefing() public {
        PlatformFeeHookV1 predeployedHook = hookFactory.deploy(
            hookSalt,
            manager,
            address(launcher),
            platformFeeRecipient,
            Currency.wrap(address(0)),
            Currency.wrap(tokenAddress)
        );
        bytes32 positionSalt = keccak256(abi.encode("launcher.direct-position.v1", tokenAddress, creator));
        address predeployedPositionRecipient = address(positionForwarderFactory.deploy(positionSalt, creator));

        DirectLiquidityLauncherV1.LaunchResult memory result = _launch();

        assertEq(result.hook, address(predeployedHook));
        assertEq(result.positionRecipient, predeployedPositionRecipient);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), predeployedPositionRecipient);
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
    }

    /// forge-config: default.fuzz.runs = 64
    /// forge-config: ci.fuzz.runs = 256
    function testFuzz_launchAccountingNeverExceedsCreatorBudgets(uint96 nativeSeed, uint96 tokenSeed) public {
        uint256 nativeBudget = bound(uint256(nativeSeed), 1 gwei, 1000 ether);
        uint256 tokenBudget = bound(uint256(tokenSeed), 1 gwei, 1000 ether);
        DirectLiquidityLauncherV1.LaunchParameters memory parameters = _parameters();
        parameters.tokenLiquidityAmount = tokenBudget;

        uint256 creatorNativeBefore = nativeBudget + 1 ether;
        vm.deal(creator, creatorNativeBefore);
        vm.prank(creator);
        DirectLiquidityLauncherV1.LaunchResult memory result = launcher.launch{ value: nativeBudget }(parameters);

        assertGt(result.nativeLiquidityAmount, 0);
        assertGt(result.tokenLiquidityAmount, 0);
        assertLe(result.nativeLiquidityAmount, nativeBudget);
        assertLe(result.tokenLiquidityAmount, tokenBudget);
        assertEq(creator.balance, creatorNativeBefore - result.nativeLiquidityAmount);
        assertEq(IERC20(result.token).balanceOf(creator), TOTAL_SUPPLY - result.tokenLiquidityAmount);
        assertEq(IERC20(result.token).balanceOf(address(launcher)), 0);
        assertEq(address(launcher).balance, 0);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
    }

    function _launch() private returns (DirectLiquidityLauncherV1.LaunchResult memory result) {
        vm.prank(creator);
        result = launcher.launch{ value: NATIVE_LIQUIDITY }(_parameters());
    }

    function _parameters() private view returns (DirectLiquidityLauncherV1.LaunchParameters memory parameters) {
        parameters = DirectLiquidityLauncherV1.LaunchParameters({
            name: "Direct Launch Token",
            symbol: "DLT",
            totalSupply: TOTAL_SUPPLY,
            tokenLiquidityAmount: TOKEN_LIQUIDITY,
            initialSqrtPriceX96: SQRT_PRICE_1_1,
            creatorSalt: CREATOR_SALT,
            hookSalt: hookSalt,
            metadata: UERC20Metadata({
                description: "Direct liquidity integration fixture", website: "", image: "", extraData: bytes("")
            })
        });
    }
}
