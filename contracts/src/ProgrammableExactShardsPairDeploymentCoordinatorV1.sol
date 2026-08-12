// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableExactShardsRegistryV1 } from "./interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "./interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { ProgrammableExactShardsAtomicLaunchRouteV1 } from "./ProgrammableExactShardsAtomicLaunchRouteV1.sol";
import { ProgrammableExactShardsRouteGatedFactoryV2 } from "./ProgrammableExactShardsRouteGatedFactoryV2.sol";

/// @title ProgrammableExactShardsPairDeploymentCoordinatorV1
/// @notice One-shot CREATE deployment which resolves the immutable Factory↔Route address dependency without a
///         CREATE2 fixed point. The first two child nonces are known independently of either child's initcode.
contract ProgrammableExactShardsPairDeploymentCoordinatorV1 {
    IProgrammableLaunchPermitAuthorityV1 public immutable PERMIT_AUTHORITY;
    IProgrammableExactShardsRegistryV1 public immutable REGISTRY;
    address public immutable REVIEWED_FACTORY_IMPLEMENTATION;
    bytes32 public immutable REVIEWED_FACTORY_IMPLEMENTATION_RUNTIME_CODE_HASH;

    address public immutable factory;
    address public immutable route;

    error DependencyRuntimeCodeHashMismatch(address dependency, bytes32 expected, bytes32 actual);
    error InvalidCoordinatorBinding(bytes32 field);
    error PredictedAddressMismatch(address produced, address predicted);

    event ExactShardsFactoryRoutePairDeployedV1(
        address indexed factory,
        address indexed route,
        address indexed reviewedFactoryImplementation,
        address permitAuthority,
        address launchRegistry,
        bytes32 factoryRuntimeCodeHash,
        bytes32 routeRuntimeCodeHash
    );

    constructor(
        IProgrammableLaunchPermitAuthorityV1 permitAuthority,
        IProgrammableExactShardsRegistryV1 registry,
        address reviewedFactoryImplementation,
        bytes32 reviewedFactoryImplementationRuntimeCodeHash
    ) {
        if (address(permitAuthority).code.length == 0) {
            revert InvalidCoordinatorBinding(bytes32("permit-authority"));
        }
        if (address(registry).code.length == 0) revert InvalidCoordinatorBinding(bytes32("registry"));
        if (registry.LAUNCH_PERMIT_AUTHORITY() != address(permitAuthority)) {
            revert InvalidCoordinatorBinding(bytes32("registry-permit-authority"));
        }
        if (
            reviewedFactoryImplementation.code.length == 0 || reviewedFactoryImplementationRuntimeCodeHash == bytes32(0)
                || reviewedFactoryImplementation.codehash != reviewedFactoryImplementationRuntimeCodeHash
        ) {
            revert DependencyRuntimeCodeHashMismatch(
                reviewedFactoryImplementation,
                reviewedFactoryImplementationRuntimeCodeHash,
                reviewedFactoryImplementation.codehash
            );
        }
        PERMIT_AUTHORITY = permitAuthority;
        REGISTRY = registry;
        REVIEWED_FACTORY_IMPLEMENTATION = reviewedFactoryImplementation;
        REVIEWED_FACTORY_IMPLEMENTATION_RUNTIME_CODE_HASH = reviewedFactoryImplementationRuntimeCodeHash;
        address predictedFactory = _createAddress(address(this), 1);
        address predictedRoute = _createAddress(address(this), 2);
        if (registry.LAUNCH_ROUTE() != predictedRoute) {
            revert InvalidCoordinatorBinding(bytes32("registry-launch-route"));
        }
        ProgrammableExactShardsRouteGatedFactoryV2 deployedFactory = new ProgrammableExactShardsRouteGatedFactoryV2(
            REVIEWED_FACTORY_IMPLEMENTATION, REVIEWED_FACTORY_IMPLEMENTATION_RUNTIME_CODE_HASH, predictedRoute
        );
        if (address(deployedFactory) != predictedFactory) {
            revert PredictedAddressMismatch(address(deployedFactory), predictedFactory);
        }
        ProgrammableExactShardsAtomicLaunchRouteV1 deployedRoute = new ProgrammableExactShardsAtomicLaunchRouteV1(
            PERMIT_AUTHORITY, deployedFactory, REGISTRY, address(deployedFactory).codehash
        );
        if (address(deployedRoute) != predictedRoute) {
            revert PredictedAddressMismatch(address(deployedRoute), predictedRoute);
        }
        if (deployedFactory.AUTHORIZED_ROUTE() != address(deployedRoute)) {
            revert InvalidCoordinatorBinding(bytes32("factory-route"));
        }
        if (
            address(deployedRoute.PERMIT_AUTHORITY()) != address(PERMIT_AUTHORITY)
                || address(deployedRoute.FACTORY()) != address(deployedFactory)
                || address(deployedRoute.REGISTRY()) != address(REGISTRY)
                || deployedRoute.FACTORY_RUNTIME_CODE_HASH() != address(deployedFactory).codehash
                || deployedFactory.IMPLEMENTATION() != REVIEWED_FACTORY_IMPLEMENTATION
                || deployedFactory.IMPLEMENTATION_RUNTIME_CODE_HASH()
                    != REVIEWED_FACTORY_IMPLEMENTATION_RUNTIME_CODE_HASH
        ) revert InvalidCoordinatorBinding(bytes32("pair-readback"));
        factory = address(deployedFactory);
        route = address(deployedRoute);
        emit ExactShardsFactoryRoutePairDeployedV1(
            address(deployedFactory),
            address(deployedRoute),
            REVIEWED_FACTORY_IMPLEMENTATION,
            address(PERMIT_AUTHORITY),
            address(REGISTRY),
            address(deployedFactory).codehash,
            address(deployedRoute).codehash
        );
    }

    function predictedPair() external view returns (address predictedFactory, address predictedRoute) {
        return (_createAddress(address(this), 1), _createAddress(address(this), 2));
    }

    function _createAddress(address deployer, uint8 nonce) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, nonce)))));
    }
}
