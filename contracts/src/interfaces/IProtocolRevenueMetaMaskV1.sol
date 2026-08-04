// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev ABI-compatible with MetaMask Delegation Framework v1.3.0 and ERC-7579.
struct ProtocolRevenueExecution {
    address target;
    uint256 value;
    bytes callData;
}

/// @dev `args` are supplied at redemption time and are intentionally excluded from MetaMask's delegation hash.
struct ProtocolRevenueCaveat {
    address enforcer;
    bytes terms;
    bytes args;
}

/// @dev `signature` is intentionally excluded from MetaMask's delegation hash.
struct ProtocolRevenueDelegation {
    address delegate;
    address delegator;
    bytes32 authority;
    ProtocolRevenueCaveat[] caveats;
    uint256 salt;
    bytes signature;
}

interface IProtocolRevenueMetaMaskDelegationManagerV1 {
    function ROOT_AUTHORITY() external view returns (bytes32);

    function disabledDelegations(bytes32 delegationHash) external view returns (bool);

    function disableDelegation(ProtocolRevenueDelegation calldata delegation) external;

    function enableDelegation(ProtocolRevenueDelegation calldata delegation) external;

    function getDelegationHash(ProtocolRevenueDelegation calldata delegation) external pure returns (bytes32);

    function getDomainHash() external view returns (bytes32);

    function paused() external view returns (bool);

    function redeemDelegations(
        bytes[] calldata permissionContexts,
        bytes32[] calldata modes,
        bytes[] calldata executionCallDatas
    ) external;
}

interface IProtocolRevenueMetaMaskAccountV1 {
    function delegationManager() external view returns (address);

    function entryPoint() external view returns (address);
}

interface IProtocolRevenueRouterTargetV1 {
    function REVENUE_AUTHORITY() external view returns (address);

    function TREASURY() external view returns (address);

    function V4_TOKEN() external view returns (address);

    function MAIN_POOL_ID() external view returns (bytes32);

    function CYCLE_INTERVAL() external view returns (uint64);

    function MIN_NEW_REVENUE() external view returns (uint256);

    function lastProcessedAt() external view returns (uint64);

    function currentMainPoolTick() external view returns (int24);

    function process(uint64 cycleTimestamp, int24 referenceTick, uint256 claimedRevenue) external;
}

interface IProtocolRevenueEthFeeHookV1 {
    function launcherFeesAccrued() external view returns (uint256);

    function claimLauncherFees() external returns (uint256 amount);

    function claimLauncherFeesTo(address recipient) external returns (uint256 amount);
}

interface IProtocolRevenueMetaMaskCaveatEnforcerV1 {
    function beforeAllHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;

    function afterHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;

    function afterAllHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 mode,
        bytes calldata executionCalldata,
        bytes32 delegationHash,
        address delegator,
        address redeemer
    ) external;
}
