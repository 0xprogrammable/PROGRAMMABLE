// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

/// @notice Fixed CALL-only interface for future, separately audited deterministic nested-factory capabilities.
/// @dev Modules receive no user target, selector, calldata, or bytes. Every plan is fully fixed by module bytecode.
interface IProgrammableNestedFactoryModuleV1 {
    struct PlanV1 {
        bytes32 profileIdHash;
        bytes32 profileVersionHash;
        bytes32 sourceRevisionHash;
        bytes32 manifestHash;
        bytes32 revenuePolicyHash;
        address launchWallet;
        address factory;
        bytes32 factoryRuntimeCodeHash;
        address renderer;
        bytes32 rendererRuntimeCodeHash;
        address token;
        bytes32 tokenRuntimeCodeHash;
        address hook;
        bytes32 hookRuntimeCodeHash;
        address nft;
        bytes32 nftRuntimeCodeHash;
        address poolManager;
        PoolKey poolKey;
        bytes32 configurationHash;
        uint160 startSqrtPriceX96;
    }

    /// @notice Exact Router authorized to execute this module. Implementations MUST enforce this in execute.
    function routerV1() external view returns (address);

    /// @notice Returns the immutable plan encoded by this exact module runtime.
    function planV1() external view returns (PlanV1 memory);

    /// @notice Executes the module's one fixed nested-factory plan. Implementations MUST revert for other callers.
    function executeNestedFactoryV1(address launchWallet) external returns (bytes32 observedConfigurationHash);

    /// @notice Revalidates profile-specific postconditions after execution.
    function validatePostV1() external view returns (bytes4 magic, bytes32 observedConfigurationHash);
}
