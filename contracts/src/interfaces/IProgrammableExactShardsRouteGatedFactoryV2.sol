// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableExactShardsLaunchFactoryV1 } from "./IProgrammableExactShardsLaunchFactoryV1.sol";

/// @notice Route-gated delegate boundary around one exact reviewed ShardLaunchFactoryV1 runtime.
interface IProgrammableExactShardsRouteGatedFactoryV2 is IProgrammableExactShardsLaunchFactoryV1 {
    struct LaunchPredictionV2 {
        address hook;
        address shard;
        address nft;
        address renderer;
        address poolManager;
        address launcherFeeRecipient;
        address builderFeeRecipient;
        bytes32 effectiveTokenSalt;
        bytes32 tokenInitCodeHash;
        bytes32 hookInitCodeHash;
        bytes32 nftInitCodeHash;
        bytes32 deploymentConfigurationHash;
        bytes32 innerCalldataKeccak256;
    }

    function IMPLEMENTATION() external view returns (address);
    function IMPLEMENTATION_RUNTIME_CODE_HASH() external view returns (bytes32);
    function AUTHORIZED_ROUTE() external view returns (address);
    function REVIEWED_SOURCE_COMMIT() external view returns (bytes20);
    function isAuthorizedRoute(address route) external view returns (bool);
    function permitFactoryBindingHash() external view returns (bytes32);
    function reviewedPoolManager() external view returns (address);
    function reviewedDefaultRenderer() external view returns (address);
    function reviewedLauncherFeeRecipient() external view returns (address);
    function reviewedBuilderFeeRecipient() external view returns (address);
    function reviewedHookCreationCodeHash() external view returns (bytes32);
    function configurationHashOf(address hook) external view returns (bytes32);
    /// @notice Wrapper-context prediction. Upstream implementation views are not valid because delegate execution
    ///         uses this wrapper as the CREATE2 deployer and embeds this wrapper as the hook's factory.
    function predictLaunch(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        LaunchParams calldata params
    ) external view returns (LaunchPredictionV2 memory prediction);
    function computeInnerExecutionCalldataKeccak256(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        LaunchParams calldata params
    ) external pure returns (bytes32);
    function hasRequiredHookFlags(address hook) external pure returns (bool);
}
