// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UERC20Metadata } from "@uniswap/uerc20-factory/src/libraries/UERC20MetadataLibrary.sol";
import { TickMath } from "@uniswap/v4-core/src/libraries/TickMath.sol";
import { Currency, CurrencyLibrary } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { FeeSplitVaultV1 } from "../src/FeeSplitVaultV1.sol";
import { LiquidityGrowthLaunchV1 } from "../src/LiquidityGrowthLaunchV1.sol";
import { LiquidityGrowthRangeSourceV1 } from "../src/LiquidityGrowthRangeSourceV1.sol";
import { LiquidityGrowthVaultV1 } from "../src/LiquidityGrowthVaultV1.sol";
import { IClassicFeeHookV3 } from "../src/interfaces/IClassicFeeHookV3.sol";
import { LiquidityGrowthLaunchV1Test } from "./LiquidityGrowthLaunchV1.t.sol";

contract LiquidityGrowthGasCreatorTokenV1 {
    address public immutable creator;

    constructor(address creator_) {
        creator = creator_;
    }
}

/// @notice Reproducible gas ceilings for Deep's launch-time and permissionless paths.
/// @dev These are Foundry call measurements, not gas-price or transaction-cost estimates.
contract LiquidityGrowthGasV1Test is LiquidityGrowthLaunchV1Test {
    uint16 private constant OBSERVATION_CARDINALITY_TARGET = 192;
    uint256 private constant LEGACY_ATOMIC_LAUNCH_GAS = 12_248_344;
    uint256 private constant CARDINALITY_GAS_CEILING = 4_350_000;
    uint256 private constant LAUNCH_GAS_CEILING = 9_000_000;
    uint256 private constant KEEPER_STAGE_GAS_CEILING = 450_000;
    uint256 private constant FRESH_VAULT_GAS_CEILING = 4_100_000;
    uint256 private constant REUSED_VAULT_GAS_CEILING = 60_000;
    uint256 private constant PROCESS_GAS_CEILING = 600_000;
    uint256 private constant COMPOUND_GAS_CEILING = 225_000;

    function test_gas_observationCardinality192() public {
        LiquidityGrowthGasCreatorTokenV1 token = new LiquidityGrowthGasCreatorTokenV1(address(this));
        PoolKey memory key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: hook.LP_FEE_PIPS(),
            tickSpacing: hook.TICK_SPACING(),
            hooks: hook
        });
        bytes32 id = PoolId.unwrap(key.toId());
        FeeSplitVaultV1 rewardVault = splitFactory.deploy(
            keccak256("deep-gas-cardinality-vault"),
            IClassicFeeHookV3(address(hook)),
            id,
            _gasBeneficiaries(address(this)),
            _gasShares()
        );
        hook.registerPool(key, address(rewardVault), 100, 100);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        uint256 gasBefore = gasleft();
        hook.increaseObservationCardinalityNext(OBSERVATION_CARDINALITY_TARGET, PoolId.wrap(id));
        uint256 gasUsed = gasBefore - gasleft();

        (, uint16 cardinality, uint16 cardinalityNext) = hook.stateById(PoolId.wrap(id));
        assertEq(cardinality, 1);
        assertEq(cardinalityNext, OBSERVATION_CARDINALITY_TARGET);
        assertLt(gasUsed, CARDINALITY_GAS_CEILING);
        emit log_named_uint("Deep observation cardinality 192 gas", gasUsed);
    }

    function test_gas_atomicLaunch() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _gasParameters(keccak256("deep-gas-launch"));

        vm.startPrank(deployer);
        uint256 gasBefore = gasleft();
        LiquidityGrowthLaunchV1.LaunchResult memory result = launcher.launch{ value: INITIAL_BUY }(parameters);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        assertTrue(result.launchHash != bytes32(0));
        assertLt(gasUsed, LAUNCH_GAS_CEILING);
        assertLt(gasUsed, LEGACY_ATOMIC_LAUNCH_GAS);
        emit log_named_uint("Deep atomic launch gas", gasUsed);
        emit log_named_uint("Deep creator launch gas saved versus one-shot 192", LEGACY_ATOMIC_LAUNCH_GAS - gasUsed);
    }

    function test_gas_boundedKeeperObservationStage() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _gasParameters(keccak256("deep-gas-keeper-stage"));
        vm.prank(deployer);
        LiquidityGrowthLaunchV1.LaunchResult memory result = launcher.launch{ value: INITIAL_BUY }(parameters);

        uint256 gasBefore = gasleft();
        (bool grew, uint16 previous, uint16 next) = automation.stageOracle(result.growthVault);
        uint256 gasUsed = gasBefore - gasleft();

        assertTrue(grew);
        assertEq(previous, automation.INITIAL_OBSERVATION_CARDINALITY_NEXT());
        assertEq(next, previous + automation.OBSERVATION_CARDINALITY_STEP());
        assertLt(gasUsed, KEEPER_STAGE_GAS_CEILING);
        emit log_named_uint("Deep bounded 16-slot keeper stage gas", gasUsed);
    }

    function test_gas_vaultFactoryFreshAndRecordedReuse() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _gasParameters(keccak256("deep-gas-factory"));
        vm.prank(deployer);
        LiquidityGrowthLaunchV1.LaunchResult memory result = launcher.launch{ value: INITIAL_BUY }(parameters);
        PoolKey memory key = _gasPoolKey(result.token);
        LiquidityGrowthVaultV1.Configuration memory configuration =
            _gasVaultConfiguration(key, parameters.growth, LiquidityGrowthRangeSourceV1(result.rangeSource));

        bytes32 freshSalt = keccak256("deep-gas-fresh-vault");
        uint256 gasBefore = gasleft();
        LiquidityGrowthVaultV1 fresh = growthFactory.deployOrGet(freshSalt, hook, splitFactory, configuration);
        uint256 freshGas = gasBefore - gasleft();

        bytes32 launchSalt = keccak256(abi.encode("programmable.liquidity-growth.vault.v1", result.token, deployer));
        gasBefore = gasleft();
        LiquidityGrowthVaultV1 reused = growthFactory.deployOrGet(launchSalt, hook, splitFactory, configuration);
        uint256 reuseGas = gasBefore - gasleft();

        assertNotEq(address(fresh), result.growthVault);
        assertEq(address(reused), result.growthVault);
        assertEq(growthFactory.configurationHashOf(address(fresh)), fresh.configurationHash());
        assertEq(growthFactory.configurationHashOf(address(reused)), reused.configurationHash());
        assertLt(freshGas, FRESH_VAULT_GAS_CEILING);
        assertLt(reuseGas, REUSED_VAULT_GAS_CEILING);
        emit log_named_uint("Deep vault factory fresh gas", freshGas);
        emit log_named_uint("Deep vault factory recorded reuse gas", reuseGas);
    }

    function test_gas_permissionlessProcessAndCompound() public {
        LiquidityGrowthLaunchV1.LaunchParameters memory parameters = _gasParameters(keccak256("deep-gas-process"));
        vm.prank(deployer);
        LiquidityGrowthLaunchV1.LaunchResult memory result = launcher.launch{ value: INITIAL_BUY }(parameters);
        PoolKey memory key = _gasPoolKey(result.token);
        LiquidityGrowthVaultV1 vault = LiquidityGrowthVaultV1(payable(result.growthVault));

        _matureGasOracle(key, vault);
        uint256 gasBefore = gasleft();
        (uint256 received, LiquidityGrowthVaultV1.CompoundResult memory processed) = vault.process();
        uint256 processGas = gasBefore - gasleft();
        assertGt(received, 0);
        assertGt(processed.liquidityAdded, 0);

        swap(key, true, -int256(0.000_001 ether), "");
        (received, processed) = vault.process();
        assertGt(received, 0);
        assertEq(processed.liquidityAdded, 0);

        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + COOLDOWN);
        gasBefore = gasleft();
        LiquidityGrowthVaultV1.CompoundResult memory compounded = vault.compoundPending();
        uint256 compoundGas = gasBefore - gasleft();

        assertGt(compounded.liquidityAdded, 0);
        assertLt(processGas, PROCESS_GAS_CEILING);
        assertLt(compoundGas, COMPOUND_GAS_CEILING);
        emit log_named_uint("Deep permissionless process and compound gas", processGas);
        emit log_named_uint("Deep permissionless compoundPending gas", compoundGas);
    }

    function _gasParameters(bytes32 creatorSalt)
        private
        view
        returns (LiquidityGrowthLaunchV1.LaunchParameters memory parameters)
    {
        parameters = LiquidityGrowthLaunchV1.LaunchParameters({
            name: "Deep Gas",
            symbol: "DGAS",
            buySwapFeeBps: 200,
            sellSwapFeeBps: 500,
            creatorSalt: creatorSalt,
            metadata: UERC20Metadata({
                description: "Deep gas fixture",
                website: "https://programmable.family",
                image: "ipfs://deep-gas",
                extraData: ""
            }),
            growth: LiquidityGrowthLaunchV1.GrowthParameters({
                nativeTarget: NATIVE_TARGET,
                tokenReserveAmount: RESERVE,
                rewardBeneficiaries: _gasBeneficiaries(deployer),
                rewardSharesBps: _gasShares()
            })
        });
    }

    function _gasPoolKey(address token) private view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(token),
            fee: launcher.LP_FEE_PIPS(),
            tickSpacing: launcher.TICK_SPACING(),
            hooks: hook
        });
    }

    function _gasVaultConfiguration(
        PoolKey memory key,
        LiquidityGrowthLaunchV1.GrowthParameters memory growth,
        LiquidityGrowthRangeSourceV1 source
    ) private view returns (LiquidityGrowthVaultV1.Configuration memory configuration) {
        configuration = LiquidityGrowthVaultV1.Configuration({
            poolKey: key,
            rangeSource: source,
            growthTargetNative: growth.nativeTarget,
            maxCompoundNative: launcher.maxCompoundNativeFor(growth.nativeTarget),
            tokenReserveTarget: growth.tokenReserveAmount,
            activeRangeHalfWidthTicks: RANGE_HALF_WIDTH,
            compoundCooldownSeconds: COOLDOWN,
            beneficiaries: growth.rewardBeneficiaries,
            sharesBps: growth.rewardSharesBps
        });
    }

    function _matureGasOracle(PoolKey memory key, LiquidityGrowthVaultV1 vault) private {
        for (uint256 stage; stage < 16; stage++) {
            (bool grew,, uint16 next) = automation.stageOracle(address(vault));
            if (!grew || next == OBSERVATION_CARDINALITY_TARGET) break;
        }
        (,, uint16 cardinalityNext) = hook.stateById(key.toId());
        assertEq(cardinalityNext, OBSERVATION_CARDINALITY_TARGET);
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);
        swap(key, true, -int256(0.000_001 ether), "");
        vm.warp(block.timestamp + TWAP_WINDOW);
        vm.roll(block.number + COOLDOWN);
    }

    function _gasBeneficiaries(address beneficiary_) private pure returns (address[] memory beneficiaries) {
        beneficiaries = new address[](1);
        beneficiaries[0] = beneficiary_;
    }

    function _gasShares() private pure returns (uint16[] memory shares) {
        shares = new uint16[](1);
        shares[0] = 10_000;
    }
}
