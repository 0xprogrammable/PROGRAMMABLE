// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
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
    mapping(address vault => bytes32 bindingHash) public vaultBindingHash;

    error ConfigurationHashMissing(address vault);
    error InvalidPlanner(address planner);
    error PredictedVaultAlreadyExists(address vault);
    error UnexpectedVaultAddress(address actual, address predicted);

    event LiquidityGrowthFullRangeVaultDeployedV3(
        address indexed vault,
        address indexed feeHook,
        bytes32 indexed poolId,
        bytes32 creatorSalt,
        bytes32 configurationHash
    );

    constructor(LiquidityGrowthZapPlannerV3 planner_) {
        if (address(planner_) == address(0) || address(planner_).code.length == 0) {
            revert InvalidPlanner(address(planner_));
        }
        planner = planner_;
        implementation = address(new LiquidityGrowthFullRangeVaultV3(address(this)));
    }

    function deploy(
        bytes32 creatorSalt,
        ILiquidityGrowthFeeOracleHookV2 feeHook,
        PoolKey calldata poolKey,
        uint256 initialTokenDust
    ) external returns (LiquidityGrowthFullRangeVaultV3 vault) {
        bytes32 salt = deploymentSalt(creatorSalt, msg.sender, feeHook, poolKey, initialTokenDust);
        address predicted = _predictDeploymentSalt(salt);
        if (predicted.code.length != 0) {
            revert PredictedVaultAlreadyExists(predicted);
        }
        LiquidityGrowthFullRangeVaultV3.Configuration memory configuration =
            LiquidityGrowthFullRangeVaultV3.Configuration({
                poolKey: poolKey, planner: planner, initialTokenDust: initialTokenDust
            });
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
        bytes32 rawPoolId = PoolId.unwrap(poolKey.toId());
        vaultBindingHash[deployed] = keccak256(
            abi.encode(
                block.chainid, address(this), deployed, address(feeHook), rawPoolId, Currency.unwrap(poolKey.currency1)
            )
        );
        emit LiquidityGrowthFullRangeVaultDeployedV3(deployed, address(feeHook), rawPoolId, creatorSalt, recorded);
    }

    function deploymentSalt(
        bytes32 creatorSalt,
        address deployer,
        ILiquidityGrowthFeeOracleHookV2 feeHook,
        PoolKey calldata poolKey,
        uint256 initialTokenDust
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                deployer,
                creatorSalt,
                address(feeHook),
                PoolId.unwrap(poolKey.toId()),
                initialTokenDust
            )
        );
    }

    function predict(
        bytes32 creatorSalt,
        address deployer,
        ILiquidityGrowthFeeOracleHookV2 feeHook,
        PoolKey calldata poolKey,
        uint256 initialTokenDust
    ) public view returns (address) {
        return _predictDeploymentSalt(deploymentSalt(creatorSalt, deployer, feeHook, poolKey, initialTokenDust));
    }

    function _predictDeploymentSalt(bytes32 salt) private view returns (address) {
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    function isFactoryVault(address vault) external view returns (bool) {
        return configurationHashOf[vault] != bytes32(0);
    }
}
