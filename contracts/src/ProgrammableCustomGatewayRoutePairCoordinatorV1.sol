// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableCustomLaunchGatewayV1 } from "./ProgrammableCustomLaunchGatewayV1.sol";
import { ProgrammableCreate2GraphDeployerV1 } from "./ProgrammableCreate2GraphDeployerV1.sol";
import { ProgrammableRouteGatedCreate2GraphFactoryV1 } from "./ProgrammableRouteGatedCreate2GraphFactoryV1.sol";

/// @title ProgrammableCustomGatewayRoutePairCoordinatorV1
/// @notice One-shot CREATE coordinator for the immutable Factory-to-Gateway circular address binding.
/// @dev Child addresses depend only on this coordinator and CREATE nonces one through three; no CREATE2 fixed point
///      exists. The frozen Generic-v2 implementation is deployed in the same atomic transaction.
contract ProgrammableCustomGatewayRoutePairCoordinatorV1 {
    address public immutable IMPLEMENTATION;
    bytes32 public immutable ROUTE_ADAPTER_BINDING_HASH;
    ProgrammableRouteGatedCreate2GraphFactoryV1 public immutable factory;
    ProgrammableCustomLaunchGatewayV1 public immutable gateway;

    error InvalidBinding(bytes32 field);
    error PredictedAddressMismatch(address produced, address predicted);

    event ProgrammableCustomGatewayRoutePairDeployedV1(
        address indexed factory,
        address indexed gateway,
        address indexed implementation,
        address registry,
        address poolManager,
        bytes32 factoryRuntimeCodeHash,
        bytes32 gatewayRuntimeCodeHash,
        bytes32 routeAdapterBindingHash
    );

    constructor(bytes32 routeAdapterBindingHash) {
        if (routeAdapterBindingHash == bytes32(0)) revert InvalidBinding(bytes32("adapter-binding"));
        ROUTE_ADAPTER_BINDING_HASH = routeAdapterBindingHash;

        address predictedImplementation = _createAddress(address(this), 1);
        address predictedFactory = _createAddress(address(this), 2);
        address predictedGateway = _createAddress(address(this), 3);
        ProgrammableCreate2GraphDeployerV1 deployedImplementation = new ProgrammableCreate2GraphDeployerV1();
        if (address(deployedImplementation) != predictedImplementation) {
            revert PredictedAddressMismatch(address(deployedImplementation), predictedImplementation);
        }
        address implementation = address(deployedImplementation);
        IMPLEMENTATION = implementation;
        ProgrammableRouteGatedCreate2GraphFactoryV1 deployedFactory = new ProgrammableRouteGatedCreate2GraphFactoryV1(
            implementation, predictedGateway, routeAdapterBindingHash
        );
        if (address(deployedFactory) != predictedFactory) {
            revert PredictedAddressMismatch(address(deployedFactory), predictedFactory);
        }
        ProgrammableCustomLaunchGatewayV1 deployedGateway = new ProgrammableCustomLaunchGatewayV1(
            deployedFactory, address(deployedFactory).codehash, routeAdapterBindingHash
        );
        if (address(deployedGateway) != predictedGateway) {
            revert PredictedAddressMismatch(address(deployedGateway), predictedGateway);
        }
        if (
            deployedFactory.AUTHORIZED_GATEWAY() != address(deployedGateway)
                || address(deployedGateway.FACTORY()) != address(deployedFactory)
                || deployedGateway.FACTORY_RUNTIME_CODE_HASH() != address(deployedFactory).codehash
                || deployedFactory.IMPLEMENTATION() != implementation
                || deployedFactory.ROUTE_ADAPTER_BINDING_HASH() != routeAdapterBindingHash
                || deployedGateway.ROUTE_ADAPTER_BINDING_HASH() != routeAdapterBindingHash
        ) revert InvalidBinding(bytes32("pair-readback"));

        factory = deployedFactory;
        gateway = deployedGateway;
        emit ProgrammableCustomGatewayRoutePairDeployedV1(
            address(deployedFactory),
            address(deployedGateway),
            implementation,
            deployedFactory.REGISTRY(),
            deployedFactory.POOL_MANAGER(),
            address(deployedFactory).codehash,
            address(deployedGateway).codehash,
            routeAdapterBindingHash
        );
    }

    function predictedStack()
        external
        view
        returns (address predictedImplementation, address predictedFactory, address predictedGateway)
    {
        return (_createAddress(address(this), 1), _createAddress(address(this), 2), _createAddress(address(this), 3));
    }

    function _createAddress(address deployer, uint8 nonce) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, nonce)))));
    }
}
