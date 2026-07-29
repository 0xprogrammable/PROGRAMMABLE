// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { LiquidityGrowthFullRangeAutomationV2 } from "../../src/LiquidityGrowthFullRangeAutomationV2.sol";
import { LiquidityGrowthFullRangeLaunchV2 } from "../../src/LiquidityGrowthFullRangeLaunchV2.sol";
import { LiquidityGrowthFullRangeVaultFactoryV2 } from "../../src/LiquidityGrowthFullRangeVaultFactoryV2.sol";
import { LiquidityGrowthFullRangeVaultV2 } from "../../src/LiquidityGrowthFullRangeVaultV2.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "../../src/interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";
import { LiquidityGrowthFullRangeFixture } from "./LiquidityGrowthFullRangeFixture.sol";

/// @notice Shared Deep V2 fixture. It intentionally reuses the canonical V1 dependency fixture while deploying only
///         V2 launcher, vault-factory, automation and vault instances for the behavior under test.
abstract contract LiquidityGrowthFullRangeV2Fixture is LiquidityGrowthFullRangeFixture {
    LiquidityGrowthFullRangeVaultFactoryV2 internal v2VaultFactory;
    LiquidityGrowthFullRangeLaunchV2 internal v2Launcher;
    LiquidityGrowthFullRangeAutomationV2 internal v2Automation;

    function setUp() public virtual override {
        super.setUp();
        v2VaultFactory = new LiquidityGrowthFullRangeVaultFactoryV2(
            hookFactory, splitFactory, positionManager, positionForwarderFactory, rangeSourceFactory
        );
        v2Launcher = new LiquidityGrowthFullRangeLaunchV2(
            manager,
            positionManager,
            tokenFactory,
            ILiquidityGrowthFullRangeOracleHookV1(address(hook)),
            splitFactory,
            rangeSourceFactory,
            v2VaultFactory,
            positionForwarderFactory
        );
        v2Automation = v2Launcher.automation();
    }

    function _launchV2Fixture(bytes32 salt)
        internal
        returns (
            LiquidityGrowthFullRangeLaunchV2.LaunchResult memory result,
            PoolKey memory key,
            LiquidityGrowthFullRangeVaultV2 vault
        )
    {
        vm.prank(creator);
        result = v2Launcher.launch{ value: INITIAL_BUY }(_v2Parameters(salt));
        key = _v2PoolKey(result.token);
        vault = LiquidityGrowthFullRangeVaultV2(payable(result.growthVault));
    }

    function _v2Parameters(bytes32 salt)
        internal
        pure
        returns (LiquidityGrowthFullRangeLaunchV2.LaunchParameters memory parameters)
    {
        parameters = LiquidityGrowthFullRangeLaunchV2.LaunchParameters({
            name: "Deep V2",
            symbol: "DEEP2",
            creatorSalt: salt,
            metadata: UERC20Metadata({
                description: "Deep V2 security fixture",
                website: "https://programmable.family",
                image: "ipfs://deep-v2",
                extraData: bytes("")
            })
        });
    }

    function _v2PoolKey(address token) internal view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: v2Launcher.LP_FEE_PIPS(),
            tickSpacing: v2Launcher.TICK_SPACING(),
            hooks: hook
        });
    }

    function _stageV2Oracle(address vaultAddress) internal {
        uint16 target = v2Automation.OBSERVATION_CARDINALITY_TARGET();
        bytes32 id = LiquidityGrowthFullRangeVaultV2(payable(vaultAddress)).poolId();
        (,, uint16 next) = hook.stateById(PoolId.wrap(id));
        for (uint256 stage; stage < 16 && next < target; stage++) {
            (bool grew,, uint16 stagedNext) = v2Automation.stageOracle(vaultAddress);
            assertTrue(grew);
            next = stagedNext;
        }
        assertEq(next, target);
    }

    function _matureV2Oracle(PoolKey memory key) internal {
        for (uint256 write; write < 32; write++) {
            vm.warp(block.timestamp + 1);
            vm.roll(block.number + 1);
            swap(key, true, -int256(0.000_001 ether), "");
        }
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + 150);
    }

    function _seedV2CreatorFees(PoolKey memory key, uint256 nativeIn) internal {
        swap(key, true, -int256(nativeIn), "");
    }

    function _creatorFees(bytes32 poolId) internal view returns (uint256 accrued) {
        (,,,,, accrued) = hook.poolFeeConfig(poolId);
    }
}
