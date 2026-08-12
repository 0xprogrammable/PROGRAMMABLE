// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableLaunchPermitAuthorityV1 } from "./IProgrammableLaunchPermitAuthorityV1.sol";

/// @notice Standard live binding exposed by every route authorized to consume Programmable launch permits.
interface IProgrammablePermitBoundRouteV1 {
    function ROUTE_ID() external view returns (bytes32);
    function permitProfile() external view returns (address);
    function permitProfileId() external view returns (bytes32);
    function permitLaunchRegistry() external view returns (address);
    function permitKernelEnvelopeMode()
        external
        view
        returns (IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1);
    /// @notice Exact immutable downstream graph binding (factory/kernel/executor/registry and their runtimes/config).
    function permitExecutionAuthorityHash() external view returns (bytes32);
}

/// @notice Independent identity readback for a release-bound profile. A route may also be its own profile.
interface IProgrammablePermitBoundProfileV1 {
    function permitProfileId() external view returns (bytes32);
    /// @notice Exact immutable profile dependency graph (for example Hookemon PlanModule address/runtime/binding).
    function permitProfileBindingHash() external view returns (bytes32);
}

/// @notice Minimum immutable launch-registry identity required by a release binding.
interface IProgrammablePermitBoundLaunchRegistryV1 {
    function LAUNCH_PERMIT_AUTHORITY() external view returns (address);
    function LAUNCH_ROUTE() external view returns (address);
    function REGISTRY_GENERATION() external view returns (uint64);
    function CHAIN_PROFILE_HASH() external view returns (bytes32);
    function WRITER_ROLE() external view returns (bytes32);
    function hasRole(bytes32 role, address account) external view returns (bool);
}
