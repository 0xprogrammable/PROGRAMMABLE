// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import {
    ITimelockedPositionRecipient
} from "@uniswap/liquidity-launcher/src/interfaces/ITimelockedPositionRecipient.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { UERC20Factory } from "@uniswap/uerc20-factory/src/factories/UERC20Factory.sol";
import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { UERC20 } from "@uniswap/uerc20-factory/src/tokens/UERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

import { FeeSplitVaultFactoryV1 } from "../src/FeeSplitVaultFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "../src/LockedPositionFeeForwarderFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "../src/LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookV1 } from "../src/LiquidityGrowthFeeOracleHookV1.sol";
import { LiquidityGrowthLaunchV1 } from "../src/LiquidityGrowthLaunchV1.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "../src/LiquidityGrowthRangeSourceFactoryV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultFactoryV1 } from "../src/LiquidityGrowthVaultFactoryV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";

contract LiquidityGrowthLaunchV1Test is Deployers {
    using StateLibrary for IPoolManager;

    address internal constant CANONICAL_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant CANONICAL_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    uint256 internal constant INITIAL_BUY = 0.0006 ether;
    uint256 internal constant RESERVE = 100_000_000 ether;
    uint256 internal constant NATIVE_TARGET = 10 ether;
    uint256 internal constant MAX_COMPOUND = 0.25 ether;
    int24 internal constant RANGE_HALF_WIDTH = 20_000;
    int24 internal constant MAX_SPOT_TWAP_DEVIATION = 600;
    int24 internal constant MAX_ABS_TICK_DELTA = 400;
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    uint64 internal constant COOLDOWN = 20;

    IPositionManager internal positionManager;
    UERC20Factory internal tokenFactory;
    FeeSplitVaultFactoryV1 internal splitFactory;
    LiquidityGrowthRangeSourceFactoryV1 internal rangeSourceFactory;
    LiquidityGrowthVaultFactoryV1 internal growthFactory;
    LockedPositionFeeForwarderFactoryV1 internal positionForwarderFactory;
    LiquidityGrowthFeeOracleHookFactoryV1 internal hookFactory;
    LiquidityGrowthFeeOracleHookV1 internal hook;
    LiquidityGrowthLaunchV1 internal launcher;

    address internal deployer;
    address internal beneficiary;
    address internal treasury;

    function setUp() public {
        deployCodeTo("PoolManager.sol:PoolManager", abi.encode(address(this)), CANONICAL_POOL_MANAGER);
        manager = IPoolManager(CANONICAL_POOL_MANAGER);
        deployCodeTo(
            "PositionManager.sol:PositionManager",
            abi.encode(manager, address(0), uint256(0), address(0), address(0)),
            CANONICAL_POSITION_MANAGER
        );
        positionManager = IPositionManager(CANONICAL_POSITION_MANAGER);
        swapRouter = new PoolSwapTest(manager);

        tokenFactory = new UERC20Factory();
        splitFactory = new FeeSplitVaultFactoryV1();
        rangeSourceFactory = new LiquidityGrowthRangeSourceFactoryV1();
        growthFactory = new LiquidityGrowthVaultFactoryV1();
        positionForwarderFactory = new LockedPositionFeeForwarderFactoryV1(positionManager);
        hookFactory = new LiquidityGrowthFeeOracleHookFactoryV1();
        treasury = makeAddr("programmableTreasury");
        hook = _deployHook();
        launcher = new LiquidityGrowthLaunchV1(
            manager,
            positionManager,
            tokenFactory,
            hook,
            splitFactory,
            rangeSourceFactory,
            growthFactory,
            positionForwarderFactory
        );

        deployer = makeAddr("deployer");
        beneficiary = makeAddr("beneficiary");
        vm.deal(deployer, 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function test_launchAtomicallyBindsVerifiedTokenPoolVaultReserveAndLockedPosition() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("atomic"));
        (address predictedToken, PoolKey memory key) = _predictedTokenAndKey(parameters);
        address predictedSource = _predictedRangeSource(predictedToken, key, parameters.growth);
        address predictedVault = _predictedVault(predictedToken, key, parameters, predictedSource);
        address predictedPosition = positionForwarderFactory.predict(_positionSalt(predictedToken, deployer), deployer);

        LiquidityGrowthLaunchV1.LaunchResult memory result = _launch(parameters);

        assertEq(result.token, predictedToken);
        assertEq(result.rangeSource, predictedSource);
        assertEq(result.growthVault, predictedVault);
        assertEq(result.positionRecipient, predictedPosition);
        _assertTokenAndSupply(result);
        _assertPoolAndVault(result, key);
        _assertLockedPosition(result);
        assertEq(launcher.launchHashOf(result.token), result.launchHash);
        assertEq(launcher.growthVaultOf(result.token), result.growthVault);
    }

    function test_reusesExactFactoryVaultAndPositionPredeployedBeforeTokenCreation() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("predeployed"));
        (address predictedToken, PoolKey memory key) = _predictedTokenAndKey(parameters);
        LiquidityGrowthRangeSourceV1 source = rangeSourceFactory.deploy(
            _rangeSourceSalt(predictedToken, deployer),
            manager,
            key,
            ILiquidityGrowthOracleV1(address(hook)),
            parameters.growth.twapWindow,
            parameters.growth.activeRangeHalfWidthTicks,
            parameters.growth.maxSpotTwapDeviationTicks
        );
        LiquidityGrowthVaultV1.Configuration memory configuration = _configuration(key, parameters.growth, source);

        LiquidityGrowthVaultV1 predeployedVault =
            growthFactory.deployOrGet(_growthVaultSalt(predictedToken, deployer), hook, splitFactory, configuration);
        PositionFeesForwarder predeployedPosition =
            positionForwarderFactory.deploy(_positionSalt(predictedToken, deployer), deployer);
        assertEq(predictedToken.code.length, 0);
        assertEq(predeployedVault.token(), predictedToken);

        LiquidityGrowthLaunchV1.LaunchResult memory result = _launch(parameters);

        assertEq(result.rangeSource, address(source));
        assertEq(result.growthVault, address(predeployedVault));
        assertEq(result.positionRecipient, address(predeployedPosition));
        assertEq(IERC20(result.token).balanceOf(result.growthVault), RESERVE);
        assertEq(growthFactory.configurationHashOf(result.growthVault), result.vaultConfigurationHash);
    }

    function test_invalidReserveFailsBeforeAnyDeterministicDeployment() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("bad-reserve"));
        parameters.growth.tokenReserveAmount = launcher.TOKEN_SUPPLY();
        (address predictedToken,) = _predictedTokenAndKey(parameters);

        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthLaunchV1.InvalidReserveAmount.selector, launcher.TOKEN_SUPPLY(), launcher.TOKEN_SUPPLY()
            )
        );
        launcher.launch{ value: INITIAL_BUY }(parameters);

        assertEq(predictedToken.code.length, 0);
    }

    function test_invalidFeeAndInitialBuyRollBackTokenAndFactories() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("bad-fee"));
        parameters.buySwapFeeBps = 150;
        (address predictedToken,) = _predictedTokenAndKey(parameters);

        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthFeeOracleHookV1.InvalidTotalSwapFee.selector, 150));
        launcher.launch{ value: INITIAL_BUY }(parameters);
        assertEq(predictedToken.code.length, 0);

        parameters = _parameters(bytes32("small-buy"));
        (predictedToken,) = _predictedTokenAndKey(parameters);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthLaunchV1.InitialBuyBelowMinimum.selector, INITIAL_BUY - 1, INITIAL_BUY
            )
        );
        launcher.launch{ value: INITIAL_BUY - 1 }(parameters);
        assertEq(predictedToken.code.length, 0);
    }

    function test_rejectsPredeployedRangeSourceWithoutFactoryProvenance() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("source-provenance"));
        (address predictedToken, PoolKey memory key) = _predictedTokenAndKey(parameters);
        LiquidityGrowthRangeSourceV1 source = rangeSourceFactory.deploy(
            _rangeSourceSalt(predictedToken, deployer),
            manager,
            key,
            ILiquidityGrowthOracleV1(address(hook)),
            parameters.growth.twapWindow,
            parameters.growth.activeRangeHalfWidthTicks,
            parameters.growth.maxSpotTwapDeviationTicks
        );
        bytes32 mappingSlot = keccak256(abi.encode(address(source), uint256(0)));
        vm.store(address(rangeSourceFactory), mappingSlot, bytes32(0));

        vm.prank(deployer);
        vm.expectPartialRevert(LiquidityGrowthRangeSourceFactoryV1.UnrecognizedSource.selector);
        launcher.launch{ value: INITIAL_BUY }(parameters);

        assertEq(predictedToken.code.length, 0);
    }

    function test_onlyPoolManagerCanEnterInitialBuyCallback() public {
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthLaunchV1.UnauthorizedUnlockCallback.selector, address(this))
        );
        launcher.unlockCallback("");
    }

    function test_matureSamePoolTwapAllowsCompounding() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("mature-twap"));
        (, PoolKey memory key) = _predictedTokenAndKey(parameters);
        LiquidityGrowthLaunchV1.LaunchResult memory result = _launch(parameters);
        LiquidityGrowthVaultV1 vault = LiquidityGrowthVaultV1(payable(result.growthVault));

        _matureOracle(key);
        LiquidityGrowthRangeSourceV1.RangeQuote memory quote =
            LiquidityGrowthRangeSourceV1(result.rangeSource).quoteRange();
        assertLe(_absoluteTickDifference(quote.spotTick, quote.twapTick), uint24(MAX_SPOT_TWAP_DEVIATION));

        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory compounded) = vault.process();

        assertGt(received, 0);
        assertGt(compounded.liquidityAdded, 0);
        assertGt(vault.totalNativeAddedToLiquidity(), 0);
    }

    function test_manipulatedSpotBlocksCompoundingWithoutSpotFallback() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _parameters(bytes32("manipulated-spot"));
        (, PoolKey memory key) = _predictedTokenAndKey(parameters);
        LiquidityGrowthLaunchV1.LaunchResult memory result = _launch(parameters);
        LiquidityGrowthVaultV1 vault = LiquidityGrowthVaultV1(payable(result.growthVault));
        LiquidityGrowthRangeSourceV1 source = LiquidityGrowthRangeSourceV1(result.rangeSource);

        _matureOracle(key);
        source.quoteRange();
        swap(key, true, -int256(0.25 ether), "");

        vm.expectPartialRevert(LiquidityGrowthRangeSourceV1.SpotTwapDeviationExceeded.selector);
        vault.process();
        assertEq(vault.totalCreatorFeesReceived(), 0);
        assertEq(vault.totalNativeAddedToLiquidity(), 0);
    }

    function _assertTokenAndSupply(LiquidityGrowthLaunchV1.LaunchResult memory result) private view {
        UERC20 token = UERC20(result.token);
        assertEq(token.creator(), address(launcher));
        assertEq(token.totalSupply(), launcher.TOKEN_SUPPLY());
        assertEq(token.balanceOf(result.growthVault), RESERVE);
        assertEq(token.balanceOf(deployer), result.initialBuyTokenAmount);
        assertEq(token.balanceOf(address(launcher)), 0);
        assertEq(token.balanceOf(address(positionManager)), 0);
        assertEq(result.tokenReserveAmount, RESERVE);
        assertEq(
            result.tokenReserveAmount + result.tokenLiquidityAmount + result.lockedTokenDust, launcher.TOKEN_SUPPLY()
        );
    }

    function _assertPoolAndVault(LiquidityGrowthLaunchV1.LaunchResult memory result, PoolKey memory key) private view {
        assertEq(result.poolId, PoolId.unwrap(key.toId()));
        (uint160 sqrtPriceX96,,,) = manager.getSlot0(PoolId.wrap(result.poolId));
        assertGt(sqrtPriceX96, 0);

        LiquidityGrowthVaultV1 vault = LiquidityGrowthVaultV1(payable(result.growthVault));
        assertEq(vault.poolId(), result.poolId);
        assertEq(vault.token(), result.token);
        assertEq(address(vault.feeHook()), address(hook));
        assertEq(address(vault.rangeSource()), result.rangeSource);
        assertEq(vault.growthTargetNative(), NATIVE_TARGET);
        assertEq(vault.maxCompoundNative(), MAX_COMPOUND);
        assertEq(vault.tokenReserveTarget(), RESERVE);
        assertEq(vault.activeRangeHalfWidthTicks(), RANGE_HALF_WIDTH);
        assertEq(vault.compoundCooldownBlocks(), COOLDOWN);
        assertEq(vault.beneficiaryAt(0), deployer);
        assertEq(vault.beneficiaryAt(1), beneficiary);
        assertEq(vault.shareBpsOf(deployer), 7000);
        assertEq(vault.shareBpsOf(beneficiary), 3000);
        assertEq(vault.configurationHash(), result.vaultConfigurationHash);
        assertEq(growthFactory.configurationHashOf(result.growthVault), result.vaultConfigurationHash);
        assertEq(address(vault.upstreamVault()), result.upstreamRewardVault);
        assertEq(rangeSourceFactory.configurationHashOf(result.rangeSource) != bytes32(0), true);
        LiquidityGrowthRangeSourceV1 source = LiquidityGrowthRangeSourceV1(result.rangeSource);
        assertEq(address(source.poolManager()), address(manager));
        assertEq(address(source.oracleHook()), address(hook));
        assertEq(source.poolId(), result.poolId);
        assertEq(source.tickSpacing(), launcher.TICK_SPACING());
        assertEq(source.rangeHalfWidthTicks(), RANGE_HALF_WIDTH);
        assertEq(source.maxSpotTwapDeviationTicks(), MAX_SPOT_TWAP_DEVIATION);
        assertEq(source.twapWindow(), TWAP_WINDOW);
        assertEq(
            vault.oraclePolicyHash(),
            keccak256(
                abi.encode(
                    address(source),
                    address(hook),
                    hook.maxAbsTickDelta(),
                    source.twapWindow(),
                    source.rangeHalfWidthTicks(),
                    source.maxSpotTwapDeviationTicks(),
                    source.poolId(),
                    source.tickSpacing()
                )
            )
        );
        (, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(result.poolId));
        assertEq(cardinality, 1);
        assertEq(cardinalityNext, 192);

        (address rewardVault,, uint16 buyFee, uint16 sellFee, bool registered,) = hook.poolFeeConfig(result.poolId);
        assertTrue(registered);
        assertEq(rewardVault, result.upstreamRewardVault);
        assertEq(buyFee, 200);
        assertEq(sellFee, 500);
    }

    function _assertLockedPosition(LiquidityGrowthLaunchV1.LaunchResult memory result) private {
        assertEq(IERC721(address(positionManager)).ownerOf(result.positionTokenId), result.positionRecipient);
        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(result.positionRecipient));
        assertEq(forwarder.operator(), address(0));
        assertEq(forwarder.timelockBlockNumber(), type(uint256).max);
        assertEq(forwarder.feeRecipient(), deployer);
        assertEq(IERC20(result.token).balanceOf(result.positionRecipient), result.lockedTokenDust);
        vm.expectRevert(ITimelockedPositionRecipient.Timelocked.selector);
        forwarder.approveOperator();
    }

    function _launch(LiquidityGrowthLaunchV1.LaunchParameters memory parameters)
        private
        returns (LiquidityGrowthLaunchV1.LaunchResult memory result)
    {
        vm.prank(deployer);
        result = launcher.launch{ value: INITIAL_BUY }(parameters);
    }

    function _predictedTokenAndKey(LiquidityGrowthLaunchV1.LaunchParameters memory parameters)
        private
        view
        returns (address token, PoolKey memory key)
    {
        bytes32 effectiveGraffiti = keccak256(abi.encode(deployer, parameters.creatorSalt));
        token = tokenFactory.getUERC20Address(
            parameters.name, parameters.symbol, launcher.TOKEN_DECIMALS(), address(launcher), effectiveGraffiti
        );
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: launcher.LP_FEE_PIPS(),
            tickSpacing: launcher.TICK_SPACING(),
            hooks: hook
        });
    }

    function _predictedVault(
        address token,
        PoolKey memory key,
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters,
        address predictedSource
    ) private view returns (address) {
        LiquidityGrowthVaultV1.Configuration memory configuration = _configuration(
            key, parameters.growth, LiquidityGrowthRangeSourceV1(predictedSource)
        );
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(LiquidityGrowthVaultV1).creationCode, abi.encode(hook, splitFactory, configuration))
        );
        return Create2.computeAddress(_growthVaultSalt(token, deployer), initCodeHash, address(growthFactory));
    }

    function _predictedRangeSource(
        address token,
        PoolKey memory key,
        LiquidityGrowthLaunchV1.GrowthParameters memory growth
    ) private view returns (address) {
        return rangeSourceFactory.predict(
            _rangeSourceSalt(token, deployer),
            manager,
            key,
            ILiquidityGrowthOracleV1(address(hook)),
            growth.twapWindow,
            growth.activeRangeHalfWidthTicks,
            growth.maxSpotTwapDeviationTicks
        );
    }

    function _configuration(
        PoolKey memory key,
        LiquidityGrowthLaunchV1.GrowthParameters memory growth,
        LiquidityGrowthRangeSourceV1 source
    ) private pure returns (LiquidityGrowthVaultV1.Configuration memory) {
        return LiquidityGrowthVaultV1.Configuration({
            poolKey: key,
            rangeSource: source,
            growthTargetNative: growth.nativeTarget,
            maxCompoundNative: growth.maxCompoundNative,
            tokenReserveTarget: growth.tokenReserveAmount,
            activeRangeHalfWidthTicks: growth.activeRangeHalfWidthTicks,
            compoundCooldownBlocks: growth.compoundCooldownBlocks,
            beneficiaries: growth.rewardBeneficiaries,
            sharesBps: growth.rewardSharesBps
        });
    }

    function _parameters(bytes32 salt)
        private
        view
        returns (LiquidityGrowthLaunchV1.LaunchParameters memory parameters)
    {
        address[] memory beneficiaries = new address[](2);
        beneficiaries[0] = deployer;
        beneficiaries[1] = beneficiary;
        uint16[] memory shares = new uint16[](2);
        shares[0] = 7000;
        shares[1] = 3000;
        parameters = LiquidityGrowthLaunchV1.LaunchParameters({
            name: "Liquidity Growth",
            symbol: "GROW",
            buySwapFeeBps: 200,
            sellSwapFeeBps: 500,
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "LiquidityGrowth atomic launch fixture",
                website: "https://programmable.family",
                image: "ipfs://liquidity-growth",
                extraData: abi.encode("https://x.com/0xprogrammable")
            }),
            growth: LiquidityGrowthLaunchV1.GrowthParameters({
                nativeTarget: NATIVE_TARGET,
                maxCompoundNative: MAX_COMPOUND,
                tokenReserveAmount: RESERVE,
                activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
                maxSpotTwapDeviationTicks: MAX_SPOT_TWAP_DEVIATION,
                twapWindow: TWAP_WINDOW,
                compoundCooldownBlocks: COOLDOWN,
                rewardBeneficiaries: beneficiaries,
                rewardSharesBps: shares
            })
        });
    }

    function _deployHook() private returns (LiquidityGrowthFeeOracleHookV1 deployed) {
        (, bytes32 salt) = HookMiner.find(
            address(hookFactory),
            hookFactory.REQUIRED_HOOK_FLAGS(),
            type(LiquidityGrowthFeeOracleHookV1).creationCode,
            abi.encode(manager, treasury, splitFactory, MAX_ABS_TICK_DELTA)
        );
        deployed = hookFactory.deploy(salt, manager, treasury, splitFactory, MAX_ABS_TICK_DELTA);
    }

    function _positionSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.liquidity-growth.launch-position.v1", token, creator));
    }

    function _growthVaultSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.liquidity-growth.vault.v1", token, creator));
    }

    function _rangeSourceSalt(address token, address creator) private pure returns (bytes32) {
        return keccak256(abi.encode("programmable.liquidity-growth.range-source.v1", token, creator));
    }

    function _matureOracle(PoolKey memory key) private {
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);
        swap(key, true, -int256(0.000_001 ether), "");
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
    }

    function _absoluteTickDifference(int24 a, int24 b) private pure returns (uint24 difference) {
        int256 signedDifference = int256(a) - int256(b);
        if (signedDifference < 0) signedDifference = -signedDifference;
        difference = uint24(uint256(signedDifference));
    }
}
