// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { ILiquidityGrowthFeeOracleHookV2 } from "./interfaces/ILiquidityGrowthFeeOracleHookV2.sol";
import { LiquidityGrowthFullRangeVaultV3 } from "./LiquidityGrowthFullRangeVaultV3.sol";
import { LiquidityGrowthZapPlannerV3 } from "./LiquidityGrowthZapPlannerV3.sol";

/// @title LiquidityGrowthFullRangeVaultFactoryV3
/// @notice Deterministically creates one immutable Deep growth vault for one committed pool configuration.
contract LiquidityGrowthFullRangeVaultFactoryV3 {
    using Clones for address;

    address public immutable implementation;
    LiquidityGrowthZapPlannerV3 public immutable planner;
    mapping(address vault => bytes32 commitment) public initializationCommitment;
    mapping(address vault => bytes32 configurationHash) public configurationHashOf;

    error ConfigurationHashMissing(address vault);
    error InvalidPlanner(address planner);
    error PredictedVaultAlreadyExists(address vault);
    error UnexpectedVaultAddress(address actual, address predicted);

    event LiquidityGrowthFullRangeVaultDeployedV3(
        address indexed vault,
        address indexed feeHook,
        bytes32 indexed poolId,
        address planner,
        bytes32 salt,
        bytes32 configurationHash
    );

    constructor(LiquidityGrowthZapPlannerV3 planner_) {
        if (address(planner_) == address(0) || address(planner_).code.length == 0) {
            revert InvalidPlanner(address(planner_));
        }
        planner = planner_;
        implementation = address(new LiquidityGrowthFullRangeVaultV3(address(this)));
    }

    function deploy(bytes32 salt, ILiquidityGrowthFeeOracleHookV2 feeHook, PoolKey calldata poolKey)
        external
        returns (LiquidityGrowthFullRangeVaultV3 vault)
    {
        address predicted = predict(salt);
        if (predicted.code.length != 0) {
            revert PredictedVaultAlreadyExists(predicted);
        }
        LiquidityGrowthFullRangeVaultV3.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV3.Configuration({ poolKey: poolKey, planner: planner });
        bytes32 commitment = keccak256(abi.encode(feeHook, configuration));
        initializationCommitment[predicted] = commitment;

        address deployed = implementation.cloneDeterministic(salt);
        if (deployed != predicted) {
            revert UnexpectedVaultAddress(deployed, predicted);
        }
        vault = LiquidityGrowthFullRangeVaultV3(payable(deployed));
        vault.initialize(feeHook, configuration);
        delete initializationCommitment[predicted];

        bytes32 recorded = vault.configurationHash();
        if (recorded == bytes32(0)) {
            revert ConfigurationHashMissing(deployed);
        }
        configurationHashOf[deployed] = recorded;
        emit LiquidityGrowthFullRangeVaultDeployedV3(
            deployed, address(feeHook), vault.poolId(), address(planner), salt, recorded
        );
    }

    function predict(bytes32 salt) public view returns (address) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
