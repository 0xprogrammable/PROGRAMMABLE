// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Deployers } from "@uniswap/v4-core/test/utils/Deployers.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { LiquidityGrowthRangeSourceFactoryV1 } from "../src/LiquidityGrowthRangeSourceFactoryV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { ILiquidityGrowthOracleV1 } from "../src/interfaces/ILiquidityGrowthOracleV1.sol";
import { MockLiquidityGrowthOracleV1 } from "./mocks/MockLiquidityGrowthOracleV1.sol";

contract LiquidityGrowthRangeSourceFactoryV1Test is Deployers {
    uint32 internal constant TWAP_WINDOW = 30 minutes;
    int24 internal constant TICK_SPACING = 200;
    int24 internal constant RANGE_HALF_WIDTH = 2000;
    int24 internal constant MAX_DEVIATION = 600;
    bytes32 internal constant SALT = bytes32("range-source");

    LiquidityGrowthRangeSourceFactoryV1 internal factory;
    MockLiquidityGrowthOracleV1 internal oracle;
    PoolKey internal poolKey;

    function setUp() public {
        deployFreshManager();
        factory = new LiquidityGrowthRangeSourceFactoryV1();
        oracle = _deployOracle(manager);
        poolKey = _keyFor(new MockERC20("Range Source", "RANGE", 18), oracle);
    }

    function test_predictDeployAndConfigurationHashAreExact() public {
        address predicted = _predict(SALT, manager, poolKey, oracle);
        LiquidityGrowthRangeSourceV1 source = _deploy(SALT, manager, poolKey, oracle);

        assertEq(address(source), predicted);
        assertGt(predicted.code.length, 0);
        assertTrue(factory.isFactorySource(predicted));
        assertFalse(factory.isFactorySource(address(0xBEEF)));
        assertEq(address(source.poolManager()), address(manager));
        assertEq(address(source.oracleHook()), address(oracle));
        assertEq(source.poolId(), PoolId.unwrap(poolKey.toId()));
        assertEq(source.twapWindow(), TWAP_WINDOW);
        assertEq(source.tickSpacing(), TICK_SPACING);
        assertEq(source.rangeHalfWidthTicks(), RANGE_HALF_WIDTH);
        assertEq(source.maxSpotTwapDeviationTicks(), MAX_DEVIATION);

        bytes32 expectedConfigurationHash = keccak256(
            abi.encode(
                block.chainid,
                address(factory),
                address(source),
                address(manager),
                PoolId.unwrap(poolKey.toId()),
                address(oracle),
                TWAP_WINDOW,
                TICK_SPACING,
                RANGE_HALF_WIDTH,
                MAX_DEVIATION
            )
        );
        assertEq(factory.configurationHashOf(address(source)), expectedConfigurationHash);
    }

    function test_initCodeHashMatchesExactCreationCode() public view {
        bytes memory code = factory.initCode(manager, poolKey, oracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
        assertEq(
            factory.initCodeHash(manager, poolKey, oracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION),
            keccak256(code)
        );
    }

    function test_sameSaltAndConfigurationCannotBeReused() public {
        address predicted = _predict(SALT, manager, poolKey, oracle);
        _deploy(SALT, manager, poolKey, oracle);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthRangeSourceFactoryV1.SourceAlreadyDeployed.selector, predicted)
        );
        _deploy(SALT, manager, poolKey, oracle);
    }

    function test_configurationChangesProduceDifferentInitCodeHashAndAddress() public view {
        int24 widerRange = RANGE_HALF_WIDTH + TICK_SPACING;
        bytes32 baseHash = factory.initCodeHash(manager, poolKey, oracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
        bytes32 changedHash = factory.initCodeHash(manager, poolKey, oracle, TWAP_WINDOW, widerRange, MAX_DEVIATION);
        address basePrediction = _predict(SALT, manager, poolKey, oracle);
        address changedPrediction =
            factory.predict(SALT, manager, poolKey, oracle, TWAP_WINDOW, widerRange, MAX_DEVIATION);

        assertNotEq(changedHash, baseHash);
        assertNotEq(changedPrediction, basePrediction);
    }

    function test_factoryPropagatesZeroManagerValidationAndRecordsNothing() public {
        IPoolManager zeroManager = IPoolManager(address(0));
        address predicted = _predict(SALT, zeroManager, poolKey, oracle);

        vm.expectRevert(abi.encodeWithSelector(LiquidityGrowthRangeSourceV1.InvalidDependency.selector, address(0)));
        _deploy(SALT, zeroManager, poolKey, oracle);

        assertEq(predicted.code.length, 0);
        assertEq(factory.configurationHashOf(predicted), bytes32(0));
        assertFalse(factory.isFactorySource(predicted));
    }

    function test_factoryPropagatesHookIdentityValidation() public {
        PoolKey memory mismatchedKey = poolKey;
        mismatchedKey.hooks = IHooks(address(0));

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityGrowthRangeSourceV1.InvalidOracleHook.selector, address(0), address(oracle))
        );
        _deploy(SALT, manager, mismatchedKey, oracle);
    }

    function test_factoryPropagatesOracleManagerValidation() public {
        IPoolManager oracleManager = manager;
        deployFreshManager();
        IPoolManager differentManager = manager;

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityGrowthRangeSourceV1.InvalidOracleManager.selector,
                address(oracleManager),
                address(differentManager)
            )
        );
        _deploy(SALT, differentManager, poolKey, oracle);
    }

    function test_directDeploymentHasNoFactoryProvenance() public {
        LiquidityGrowthRangeSourceV1 direct =
            new LiquidityGrowthRangeSourceV1(manager, poolKey, oracle, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
        assertFalse(factory.isFactorySource(address(direct)));
        assertEq(factory.configurationHashOf(address(direct)), bytes32(0));
    }

    function _deploy(bytes32 salt, IPoolManager poolManager_, PoolKey memory poolKey_, ILiquidityGrowthOracleV1 oracle_)
        private
        returns (LiquidityGrowthRangeSourceV1)
    {
        return factory.deploy(salt, poolManager_, poolKey_, oracle_, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
    }

    function _predict(
        bytes32 salt,
        IPoolManager poolManager_,
        PoolKey memory poolKey_,
        ILiquidityGrowthOracleV1 oracle_
    ) private view returns (address) {
        return factory.predict(salt, poolManager_, poolKey_, oracle_, TWAP_WINDOW, RANGE_HALF_WIDTH, MAX_DEVIATION);
    }

    function _deployOracle(IPoolManager poolManager_) private returns (MockLiquidityGrowthOracleV1 deployed) {
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), 0, type(MockLiquidityGrowthOracleV1).creationCode, abi.encode(poolManager_));
        deployed = new MockLiquidityGrowthOracleV1{ salt: salt }(poolManager_);
        assertEq(address(deployed), predicted);
    }

    function _keyFor(MockERC20 token, MockLiquidityGrowthOracleV1 oracle_) private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(oracle_))
        });
    }
}
