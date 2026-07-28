// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { PositionFeesForwarder } from "@uniswap/liquidity-launcher/src/periphery/PositionFeesForwarder.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { IPositionManager } from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";

import { FeeSplitVaultFactoryV1 } from "./FeeSplitVaultFactoryV1.sol";
import { LiquidityGrowthFeeOracleHookFactoryV1 } from "./LiquidityGrowthFeeOracleHookFactoryV1.sol";
import { LiquidityGrowthFullRangePolicyV1 as Policy } from "./LiquidityGrowthFullRangePolicyV1.sol";
import { LiquidityGrowthFullRangeVaultV1 } from "./LiquidityGrowthFullRangeVaultV1.sol";
import { LiquidityGrowthRangeSourceFactoryV1 } from "./LiquidityGrowthRangeSourceFactoryV1.sol";
import { LockedPositionFeeForwarderFactoryV1 } from "./LockedPositionFeeForwarderFactoryV1.sol";
import { ILiquidityGrowthFullRangeOracleHookV1 } from "./interfaces/ILiquidityGrowthFullRangeOracleHookV1.sol";

/// @title LiquidityGrowthFullRangeVaultFactoryV1
/// @notice Deterministically deploys immutable full-range liquidity-growth vaults.
contract LiquidityGrowthFullRangeVaultFactoryV1 {
    address public immutable implementation;
    LiquidityGrowthFeeOracleHookFactoryV1 public immutable hookFactory;
    FeeSplitVaultFactoryV1 public immutable feeSplitVaultFactory;
    IPositionManager public immutable positionManager;
    IPoolManager public immutable poolManager;
    LockedPositionFeeForwarderFactoryV1 public immutable positionForwarderFactory;
    LiquidityGrowthRangeSourceFactoryV1 public immutable rangeSourceFactory;
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;
    mapping(address vault => bytes32 commitment) public initializationCommitment;

    uint256 private constant MAX_BENEFICIARIES = 8;
    uint32 private constant TWAP_WINDOW = 30 minutes;
    int24 private constant MAX_SPOT_TWAP_DEVIATION_TICKS = 600;
    int24 private constant MAX_ABS_TICK_DELTA = 400;

    error DuplicateBeneficiary(address beneficiary);
    error InvalidBeneficiaryConfiguration();
    error InvalidConfiguration(address dependency);
    error InvalidInitialPositionRecipient(address recipient);
    error UnrecognizedVault(address vault);

    event LiquidityGrowthFullRangeVaultDeployed(
        address indexed vault,
        address indexed feeHook,
        bytes32 indexed poolId,
        address upstreamVault,
        bytes32 salt,
        bytes32 configurationHash
    );

    constructor(
        LiquidityGrowthFeeOracleHookFactoryV1 hookFactory_,
        FeeSplitVaultFactoryV1 feeSplitVaultFactory_,
        IPositionManager positionManager_,
        LockedPositionFeeForwarderFactoryV1 positionForwarderFactory_,
        LiquidityGrowthRangeSourceFactoryV1 rangeSourceFactory_
    ) {
        _requireContract(address(hookFactory_));
        _requireContract(address(feeSplitVaultFactory_));
        _requireContract(address(positionManager_));
        _requireContract(address(positionForwarderFactory_));
        _requireContract(address(rangeSourceFactory_));
        if (address(positionForwarderFactory_.positionManager()) != address(positionManager_)) {
            revert InvalidConfiguration(address(positionForwarderFactory_));
        }
        hookFactory = hookFactory_;
        feeSplitVaultFactory = feeSplitVaultFactory_;
        positionManager = positionManager_;
        poolManager = positionManager_.poolManager();
        positionForwarderFactory = positionForwarderFactory_;
        rangeSourceFactory = rangeSourceFactory_;
        implementation = address(new LiquidityGrowthFullRangeVaultV1(address(this)));
    }

    function deployOrGet(
        bytes32 salt,
        ILiquidityGrowthFullRangeOracleHookV1 feeHook,
        LiquidityGrowthFullRangeVaultV1.Configuration calldata configuration
    ) external returns (LiquidityGrowthFullRangeVaultV1 vault) {
        _validate(feeHook, configuration);
        bytes32 derivedSalt = effectiveSalt(salt, feeHook, configuration);
        address predicted = Clones.predictDeterministicAddress(implementation, derivedSalt, address(this));
        if (predicted.code.length != 0) {
            vault = LiquidityGrowthFullRangeVaultV1(payable(predicted));
            bytes32 recorded = configurationHashOf[predicted];
            if (recorded == bytes32(0) || vault.configurationHash() != recorded) {
                revert UnrecognizedVault(predicted);
            }
            return vault;
        }

        bytes32 commitment = keccak256(abi.encode(feeHook, feeSplitVaultFactory, configuration));
        initializationCommitment[predicted] = commitment;
        vault = LiquidityGrowthFullRangeVaultV1(payable(Clones.cloneDeterministic(implementation, derivedSalt)));
        // The exact implementation is factory-created and the commitment binds every initialization argument.
        // slither-disable-next-line reentrancy-benign,reentrancy-events
        vault.initialize(feeHook, feeSplitVaultFactory, configuration);
        delete initializationCommitment[predicted];
        bytes32 configurationHash = vault.configurationHash();
        configurationHashOf[address(vault)] = configurationHash;
        emit LiquidityGrowthFullRangeVaultDeployed(
            address(vault),
            address(feeHook),
            vault.poolId(),
            address(vault.upstreamVault()),
            derivedSalt,
            configurationHash
        );
    }

    function predict(
        bytes32 salt,
        ILiquidityGrowthFullRangeOracleHookV1 feeHook,
        LiquidityGrowthFullRangeVaultV1.Configuration calldata configuration
    ) external view returns (address) {
        bytes32 derivedSalt = effectiveSalt(salt, feeHook, configuration);
        return Clones.predictDeterministicAddress(implementation, derivedSalt, address(this));
    }

    function effectiveSalt(
        bytes32 salt,
        ILiquidityGrowthFullRangeOracleHookV1 feeHook,
        LiquidityGrowthFullRangeVaultV1.Configuration calldata configuration
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(salt, feeHook, configuration));
    }

    function _validate(
        ILiquidityGrowthFullRangeOracleHookV1 feeHook,
        LiquidityGrowthFullRangeVaultV1.Configuration calldata configuration
    ) private view {
        _requireContract(address(feeHook));
        _requireContract(configuration.initialPositionRecipient);
        _requireContract(address(configuration.oracleGuard));

        address currency0 = Currency.unwrap(configuration.poolKey.currency0);
        address currency1 = Currency.unwrap(configuration.poolKey.currency1);
        if (currency0 != address(0) || currency1 == address(0)) revert InvalidConfiguration(currency1);
        _requireContract(currency1);
        if (
            hookFactory.configurationHashOf(address(feeHook)) == bytes32(0)
                || rangeSourceFactory.configurationHashOf(address(configuration.oracleGuard)) == bytes32(0)
                || address(configuration.poolKey.hooks) != address(feeHook)
                || configuration.poolKey.fee != feeHook.LP_FEE_PIPS()
                || configuration.poolKey.tickSpacing != feeHook.TICK_SPACING()
                || configuration.poolKey.tickSpacing != Policy.TICK_SPACING
                || address(configuration.positionManager) != address(positionManager)
                || address(configuration.positionForwarderFactory) != address(positionForwarderFactory)
                || address(feeHook.poolManager()) != address(poolManager)
                || address(feeHook.feeSplitVaultFactory()) != address(feeSplitVaultFactory)
                || feeHook.maxAbsTickDelta() != MAX_ABS_TICK_DELTA
        ) revert InvalidConfiguration(address(feeHook));

        PositionFeesForwarder forwarder = PositionFeesForwarder(payable(configuration.initialPositionRecipient));
        if (
            address(configuration.positionForwarderFactory.positionManager()) != address(configuration.positionManager)
                || configuration.positionForwarderFactory.configurationHashOf(configuration.initialPositionRecipient)
                    == bytes32(0) || address(forwarder.positionManager()) != address(configuration.positionManager)
                || forwarder.operator() != address(0) || forwarder.timelockBlockNumber() != type(uint256).max
        ) revert InvalidInitialPositionRecipient(configuration.initialPositionRecipient);

        if (
            address(configuration.oracleGuard.poolManager()) != address(feeHook.poolManager())
                || address(configuration.oracleGuard.oracleHook()) != address(feeHook)
                || configuration.oracleGuard.poolId() != PoolId.unwrap(configuration.poolKey.toId())
                || configuration.oracleGuard.tickSpacing() != Policy.TICK_SPACING
                || configuration.oracleGuard.twapWindow() != TWAP_WINDOW
                || configuration.oracleGuard.maxSpotTwapDeviationTicks() != MAX_SPOT_TWAP_DEVIATION_TICKS
        ) revert InvalidConfiguration(address(configuration.oracleGuard));

        Policy.validateFixedPolicy();
        _validateBeneficiaries(configuration.beneficiaries, configuration.sharesBps);
    }

    function _validateBeneficiaries(address[] calldata beneficiaries, uint16[] calldata sharesBps) private pure {
        uint256 count = beneficiaries.length;
        if (count == 0 || count > MAX_BENEFICIARIES || sharesBps.length != count) {
            revert InvalidBeneficiaryConfiguration();
        }
        uint256 totalShares = 0;
        for (uint256 index; index < count; index++) {
            address beneficiary = beneficiaries[index];
            if (beneficiary == address(0) || sharesBps[index] == 0) revert InvalidBeneficiaryConfiguration();
            for (uint256 prior; prior < index; prior++) {
                if (beneficiaries[prior] == beneficiary) revert DuplicateBeneficiary(beneficiary);
            }
            totalShares += sharesBps[index];
        }
        if (totalShares != Policy.BASIS_POINTS) revert InvalidBeneficiaryConfiguration();
    }

    function _requireContract(address dependency) private view {
        if (dependency == address(0) || dependency.code.length == 0) revert InvalidConfiguration(dependency);
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
