// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
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

contract ExistingUERC20LiquidityLauncherV1Test is Deployers {
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;

    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 internal constant TOKEN_LIQUIDITY = 10 ether;
    uint256 internal constant NATIVE_LIQUIDITY = 10 ether;
    bytes32 internal constant TOKEN_GRAFFITI = keccak256("existing-uerc20-fixture");

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    PlatformFeeHookFactoryV1 internal hookFactory;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    DirectLiquidityLauncherV1 internal launcher;

    address internal creator;
    address internal platformFeeRecipient;
    address internal tokenAddress;
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
        platformFeeRecipient = makeAddr("existingTokenPlatformTreasury");
        launcher = new DirectLiquidityLauncherV1(
            manager, positionManager, tokenFactory, hookFactory, positionForwarderFactory, platformFeeRecipient
        );

        creator = makeAddr("existingTokenCreator");
        vm.deal(creator, 100 ether);
        vm.prank(creator);
        tokenAddress = tokenFactory.createToken(
            "Existing Uniswap Token", "EUT", 18, TOTAL_SUPPLY, creator, abi.encode(_metadata()), TOKEN_GRAFFITI
        );

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

    function test_launchesExistingFactoryTokenIntoLockedV4Position() public {
        DirectLiquidityLauncherV1.LaunchResult memory result = _launch(TOKEN_LIQUIDITY, NATIVE_LIQUIDITY);
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

        assertEq(UERC20(tokenAddress).creator(), creator);
        assertEq(UERC20(tokenAddress).graffiti(), TOKEN_GRAFFITI);
        assertEq(IERC20(tokenAddress).totalSupply(), TOTAL_SUPPLY);
        assertEq(IERC20(tokenAddress).balanceOf(address(launcher)), 0);
        assertEq(IERC20(tokenAddress).balanceOf(creator), TOTAL_SUPPLY - TOKEN_LIQUIDITY);
        assertEq(address(launcher).balance, 0);

        (uint160 sqrtPriceX96,,,) = manager.getSlot0(poolKey.toId());
        assertEq(sqrtPriceX96, SQRT_PRICE_1_1);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        assertEq(hook.authorized(), address(launcher));
        assertEq(hook.feeRecipient(), platformFeeRecipient);
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), creator);
        assertEq(launcher.predictExistingPositionRecipient(tokenAddress, creator), result.positionRecipient);

        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function test_swapsAccrueSeparatePlatformAndCreatorFees() public {
        DirectLiquidityLauncherV1.LaunchResult memory result = _launch(TOKEN_LIQUIDITY, NATIVE_LIQUIDITY);
        PlatformFeeHookV1 hook = PlatformFeeHookV1(result.hook);
        PoolSwapTest router = new PoolSwapTest(manager);
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false });
        address trader = makeAddr("existingTokenTrader");

        vm.deal(trader, 1 ether);
        vm.prank(trader);
        router.swap{ value: 0.1 ether }(
            hook.poolKey(),
            SwapParams({
                zeroForOne: true, amountSpecified: -int256(0.1 ether), sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            settings,
            ""
        );

        Currency launchedToken = Currency.wrap(tokenAddress);
        uint256 platformFees = manager.balanceOf(address(hook), launchedToken.toId());
        assertGt(platformFees, 0);
        uint256 treasuryBefore = launchedToken.balanceOf(platformFeeRecipient);
        hook.handleHookFees(new Currency[](0));
        assertEq(launchedToken.balanceOf(platformFeeRecipient), treasuryBefore + platformFees);

        uint256 creatorNativeBefore = creator.balance;
        PositionFeesForwarder(payable(result.positionRecipient)).collectFees(result.positionTokenId);
        assertGt(creator.balance, creatorNativeBefore);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
    }

    function test_rejectsTokenFromDifferentFactory() public {
        UERC20Factory foreignFactory = new UERC20Factory();
        bytes32 foreignGraffiti = keccak256("foreign-factory-token");
        vm.prank(creator);
        address foreignToken = foreignFactory.createToken(
            "Foreign Factory Token", "FFT", 18, TOTAL_SUPPLY, creator, abi.encode(_metadata()), foreignGraffiti
        );
        address predicted = tokenFactory.getUERC20Address("Foreign Factory Token", "FFT", 18, creator, foreignGraffiti);

        vm.prank(creator);
        IERC20(foreignToken).approve(address(launcher), TOKEN_LIQUIDITY);
        DirectLiquidityLauncherV1.ExistingUERC20LaunchParameters memory parameters =
            _parameters(foreignToken, TOKEN_LIQUIDITY);

        vm.expectRevert(
            abi.encodeWithSelector(
                DirectLiquidityLauncherV1.ExistingTokenNotFromFactory.selector, foreignToken, predicted
            )
        );
        vm.prank(creator);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(parameters);
    }

    function test_rejectsCallerWhoIsNotFactoryRecordedCreator() public {
        address holder = makeAddr("existingTokenHolder");
        vm.prank(creator);
        assertTrue(IERC20(tokenAddress).transfer(holder, TOKEN_LIQUIDITY));
        vm.deal(holder, NATIVE_LIQUIDITY);
        vm.prank(holder);
        IERC20(tokenAddress).approve(address(launcher), TOKEN_LIQUIDITY);

        vm.expectRevert(
            abi.encodeWithSelector(
                DirectLiquidityLauncherV1.ExistingTokenCreatorMismatch.selector, tokenAddress, creator, holder
            )
        );
        vm.prank(holder);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(_parameters(tokenAddress, TOKEN_LIQUIDITY));
    }

    function test_rejectsInvalidInputsBeforePullingTokens() public {
        DirectLiquidityLauncherV1.ExistingUERC20LaunchParameters memory parameters =
            _parameters(address(0), TOKEN_LIQUIDITY);
        vm.expectRevert(abi.encodeWithSelector(DirectLiquidityLauncherV1.InvalidToken.selector, address(0)));
        vm.prank(creator);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(parameters);

        parameters = _parameters(tokenAddress, 0);
        vm.expectRevert(abi.encodeWithSelector(DirectLiquidityLauncherV1.InvalidSupply.selector, 0, 0));
        vm.prank(creator);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(parameters);

        parameters = _parameters(tokenAddress, TOKEN_LIQUIDITY);
        vm.expectRevert(DirectLiquidityLauncherV1.NoNativeLiquidity.selector);
        vm.prank(creator);
        launcher.launchExistingUERC20(parameters);

        parameters.initialSqrtPriceX96 = 0;
        vm.expectRevert(abi.encodeWithSelector(DirectLiquidityLauncherV1.InvalidInitialPrice.selector, 0));
        vm.prank(creator);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(parameters);

        parameters = _parameters(tokenAddress, uint256(type(uint128).max) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                DirectLiquidityLauncherV1.LiquidityBudgetTooLarge.selector,
                NATIVE_LIQUIDITY,
                uint256(type(uint128).max) + 1
            )
        );
        vm.prank(creator);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(parameters);

        assertEq(IERC20(tokenAddress).balanceOf(creator), TOTAL_SUPPLY);
        assertEq(IERC20(tokenAddress).balanceOf(address(launcher)), 0);
    }

    function test_rejectsDuplicateExistingTokenLaunch() public {
        _launch(TOKEN_LIQUIDITY, NATIVE_LIQUIDITY);

        vm.expectRevert(
            abi.encodeWithSelector(DirectLiquidityLauncherV1.ExistingTokenAlreadyLaunched.selector, tokenAddress)
        );
        vm.prank(creator);
        launcher.launchExistingUERC20{ value: NATIVE_LIQUIDITY }(_parameters(tokenAddress, TOKEN_LIQUIDITY));
    }

    function test_reusesMatchingFactoryDeployments() public {
        PlatformFeeHookV1 predeployedHook = hookFactory.deploy(
            hookSalt,
            manager,
            address(launcher),
            platformFeeRecipient,
            Currency.wrap(address(0)),
            Currency.wrap(tokenAddress)
        );
        bytes32 positionSalt = keccak256(abi.encode("launcher.existing-uerc20-position.v1", tokenAddress, creator));
        address predeployedPositionRecipient = address(positionForwarderFactory.deploy(positionSalt, creator));

        DirectLiquidityLauncherV1.LaunchResult memory result = _launch(TOKEN_LIQUIDITY, NATIVE_LIQUIDITY);

        assertEq(result.hook, address(predeployedHook));
        assertEq(result.positionRecipient, predeployedPositionRecipient);
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), predeployedPositionRecipient);
    }

    /// forge-config: default.fuzz.runs = 64
    /// forge-config: ci.fuzz.runs = 256
    function testFuzz_existingLaunchAccountingNeverExceedsCreatorBudgets(uint96 nativeSeed, uint96 tokenSeed) public {
        uint256 nativeBudget = bound(uint256(nativeSeed), 1 gwei, 1000 ether);
        uint256 tokenBudget = bound(uint256(tokenSeed), 1 gwei, 1000 ether);
        uint256 creatorNativeBefore = nativeBudget + 1 ether;
        vm.deal(creator, creatorNativeBefore);

        DirectLiquidityLauncherV1.LaunchResult memory result = _launch(tokenBudget, nativeBudget);

        assertGt(result.nativeLiquidityAmount, 0);
        assertGt(result.tokenLiquidityAmount, 0);
        assertLe(result.nativeLiquidityAmount, nativeBudget);
        assertLe(result.tokenLiquidityAmount, tokenBudget);
        assertEq(creator.balance, creatorNativeBefore - result.nativeLiquidityAmount);
        assertEq(IERC20(tokenAddress).balanceOf(creator), TOTAL_SUPPLY - result.tokenLiquidityAmount);
        assertEq(IERC20(tokenAddress).balanceOf(address(launcher)), 0);
        assertEq(address(launcher).balance, 0);
        assertGt(positionManager.getPositionLiquidity(result.positionTokenId), 0);
    }

    function _launch(uint256 tokenLiquidity, uint256 nativeLiquidity)
        private
        returns (DirectLiquidityLauncherV1.LaunchResult memory result)
    {
        vm.prank(creator);
        IERC20(tokenAddress).approve(address(launcher), tokenLiquidity);
        vm.prank(creator);
        result = launcher.launchExistingUERC20{ value: nativeLiquidity }(_parameters(tokenAddress, tokenLiquidity));
    }

    function _parameters(address token, uint256 tokenLiquidity)
        private
        view
        returns (DirectLiquidityLauncherV1.ExistingUERC20LaunchParameters memory parameters)
    {
        parameters = DirectLiquidityLauncherV1.ExistingUERC20LaunchParameters({
            token: token, tokenLiquidityAmount: tokenLiquidity, initialSqrtPriceX96: SQRT_PRICE_1_1, hookSalt: hookSalt
        });
    }

    function _metadata() private pure returns (UERC20Metadata memory) {
        return UERC20Metadata({
            description: "Existing UERC20 integration fixture", website: "", image: "", extraData: bytes("")
        });
    }
}
