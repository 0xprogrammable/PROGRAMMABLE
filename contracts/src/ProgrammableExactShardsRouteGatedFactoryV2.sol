// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { ShardLaunchFactoryV1 } from "shards-v1/src/ShardLaunchFactoryV1.sol";
import { ShardNFTV1 } from "shards-v1/src/ShardNFTV1.sol";
import { ShardTokenV1 } from "shards-v1/src/ShardTokenV1.sol";

import { IProgrammableExactShardsLaunchFactoryV1 } from "./interfaces/IProgrammableExactShardsLaunchFactoryV1.sol";
import {
    IProgrammableExactShardsRouteGatedFactoryV2
} from "./interfaces/IProgrammableExactShardsRouteGatedFactoryV2.sol";

/// @title ProgrammableExactShardsRouteGatedFactoryV2
/// @notice Immutable caller gate around the exact reviewed Shards V1 factory runtime.
/// @dev The implementation is executed with DELEGATECALL. The only mutable storage is the reviewed factory's exact
///      slot-zero configuration mapping. Direct calls to the implementation use
///      a different CREATE2 deployer and therefore cannot occupy this factory's token/hook/NFT address graph.
contract ProgrammableExactShardsRouteGatedFactoryV2 is IProgrammableExactShardsRouteGatedFactoryV2 {
    struct ConfigurationDataV2 {
        uint256 chainId;
        address factory;
        address poolManager;
        address renderer;
        address launcherFeeRecipient;
        address builderFeeRecipient;
        address shard;
        address hook;
        address nft;
        int24 tickLower;
        int24 tickBand;
        int24 tickUpper;
        uint160 startSqrtPriceX96;
        bytes32 tokenNameHash;
        bytes32 tokenSymbolHash;
        bytes32 nftNameHash;
        bytes32 nftSymbolHash;
        bytes32 tokenSalt;
        bytes32 effectiveTokenSalt;
        bytes32 hookSalt;
        bytes32 hookCreationCodeHash;
    }

    uint160 public constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 public constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );
    bytes32 public constant FACTORY_BINDING_TYPEHASH = keccak256(
        "ExactShardsRouteGatedFactoryV2(address factory,address implementation,bytes32 implementationRuntimeCodeHash,address authorizedRoute,bytes20 reviewedSourceCommit,address poolManager,bytes32 poolManagerRuntimeCodeHash,address defaultRenderer,bytes32 defaultRendererRuntimeCodeHash,address launcherFeeRecipient,address builderFeeRecipient,bytes32 hookCreationCodeHash)"
    );
    bytes20 public constant REVIEWED_SOURCE_COMMIT = bytes20(hex"91b38f3de64d96cac7e29f127c004f128fc1da59");
    // slither-disable-next-line naming-convention
    address public immutable IMPLEMENTATION;
    // slither-disable-next-line naming-convention
    bytes32 public immutable IMPLEMENTATION_RUNTIME_CODE_HASH;
    // slither-disable-next-line naming-convention
    address public immutable AUTHORIZED_ROUTE;

    /// @dev Exact slot-zero layout of reviewed ShardLaunchFactoryV1. Delegate execution writes this mapping.
    mapping(address hook => bytes32 configurationHash) public configurationHashOf;

    error DirectEtherTransferUnsupported();
    error UnsupportedFactoryCall(bytes4 selector);
    error ImplementationRuntimeCodeHashMismatch(address implementation, bytes32 expected, bytes32 actual);
    error InvalidFactoryBinding(bytes32 field);
    error WrongHookCreationCode(bytes32 supplied, bytes32 expected);
    error UnauthorizedLaunchCaller(address caller, address authorizedRoute);

    constructor(address implementation, bytes32 implementationRuntimeCodeHash, address authorizedRoute) {
        if (implementation.code.length == 0) revert InvalidFactoryBinding(bytes32("implementation"));
        if (implementationRuntimeCodeHash == bytes32(0) || implementation.codehash != implementationRuntimeCodeHash) {
            revert ImplementationRuntimeCodeHashMismatch(
                implementation, implementationRuntimeCodeHash, implementation.codehash
            );
        }
        IMPLEMENTATION = implementation;
        IMPLEMENTATION_RUNTIME_CODE_HASH = implementationRuntimeCodeHash;
        if (authorizedRoute == address(0)) revert InvalidFactoryBinding(bytes32("authorized-route"));
        AUTHORIZED_ROUTE = authorizedRoute;
    }

    function isAuthorizedRoute(address route) external view returns (bool) {
        return route == AUTHORIZED_ROUTE;
    }

    function permitFactoryBindingHash() external view returns (bytes32) {
        ShardLaunchFactoryV1 reviewed = ShardLaunchFactoryV1(IMPLEMENTATION);
        address poolManager = address(reviewed.poolManager());
        address defaultRenderer = address(reviewed.renderer());
        return keccak256(
            abi.encode(
                FACTORY_BINDING_TYPEHASH,
                address(this),
                IMPLEMENTATION,
                IMPLEMENTATION_RUNTIME_CODE_HASH,
                AUTHORIZED_ROUTE,
                REVIEWED_SOURCE_COMMIT,
                poolManager,
                poolManager.codehash,
                defaultRenderer,
                defaultRenderer.codehash,
                reviewed.launcherFeeRecipient(),
                reviewed.builderFeeRecipient(),
                reviewed.hookCreationCodeHash()
            )
        );
    }

    function reviewedPoolManager() external view returns (address) {
        return address(ShardLaunchFactoryV1(IMPLEMENTATION).poolManager());
    }

    function reviewedDefaultRenderer() external view returns (address) {
        return address(ShardLaunchFactoryV1(IMPLEMENTATION).renderer());
    }

    function reviewedLauncherFeeRecipient() external view returns (address) {
        return ShardLaunchFactoryV1(IMPLEMENTATION).launcherFeeRecipient();
    }

    function reviewedBuilderFeeRecipient() external view returns (address) {
        return ShardLaunchFactoryV1(IMPLEMENTATION).builderFeeRecipient();
    }

    function reviewedHookCreationCodeHash() external view returns (bytes32) {
        return ShardLaunchFactoryV1(IMPLEMENTATION).hookCreationCodeHash();
    }

    function predictLaunch(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) external view returns (LaunchPredictionV2 memory prediction) {
        ShardLaunchFactoryV1 reviewed = ShardLaunchFactoryV1(IMPLEMENTATION);
        bytes32 expectedHookCodeHash = reviewed.hookCreationCodeHash();
        bytes32 suppliedHookCodeHash = keccak256(hookCreationCode);
        if (suppliedHookCodeHash != expectedHookCodeHash) {
            revert WrongHookCreationCode(suppliedHookCodeHash, expectedHookCodeHash);
        }
        prediction.renderer = params.renderer == address(0) ? address(reviewed.renderer()) : params.renderer;
        prediction.poolManager = address(reviewed.poolManager());
        prediction.launcherFeeRecipient = reviewed.launcherFeeRecipient();
        prediction.builderFeeRecipient = reviewed.builderFeeRecipient();
        prediction.effectiveTokenSalt = _effectiveTokenSalt(tokenSalt, hookSalt, prediction.renderer, params);
        prediction.tokenInitCodeHash = keccak256(
            bytes.concat(type(ShardTokenV1).creationCode, abi.encode(params.tokenName, params.tokenSymbol))
        );
        prediction.shard =
            Create2.computeAddress(prediction.effectiveTokenSalt, prediction.tokenInitCodeHash, address(this));
        prediction.hookInitCodeHash = keccak256(
            bytes.concat(
                hookCreationCode,
                abi.encode(
                    prediction.poolManager,
                    ShardTokenV1(prediction.shard),
                    params.tickLower,
                    params.tickBand,
                    params.tickUpper,
                    params.startSqrtPriceX96,
                    address(this),
                    prediction.launcherFeeRecipient,
                    prediction.builderFeeRecipient
                )
            )
        );
        prediction.hook = Create2.computeAddress(hookSalt, prediction.hookInitCodeHash, address(this));
        prediction.nftInitCodeHash = keccak256(
            bytes.concat(
                type(ShardNFTV1).creationCode,
                abi.encode(prediction.hook, prediction.renderer, params.nftName, params.nftSymbol)
            )
        );
        prediction.nft =
            Create2.computeAddress(keccak256(abi.encode(prediction.hook)), prediction.nftInitCodeHash, address(this));
        prediction.deploymentConfigurationHash =
            _configurationHash(tokenSalt, hookSalt, expectedHookCodeHash, prediction, params);
        prediction.innerCalldataKeccak256 = _innerCalldataHash(tokenSalt, hookSalt, hookCreationCode, params);
    }

    function computeInnerExecutionCalldataKeccak256(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) external pure returns (bytes32) {
        return _innerCalldataHash(tokenSalt, hookSalt, hookCreationCode, params);
    }

    function hasRequiredHookFlags(address hook) external pure returns (bool) {
        return uint160(hook) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS;
    }

    function launch(bytes32, bytes32, bytes calldata, IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata)
        external
        returns (address, address, address)
    {
        if (msg.sender != AUTHORIZED_ROUTE) revert UnauthorizedLaunchCaller(msg.sender, AUTHORIZED_ROUTE);
        _delegateToReviewedImplementation();
    }

    fallback() external {
        revert UnsupportedFactoryCall(msg.sig);
    }

    receive() external payable {
        revert DirectEtherTransferUnsupported();
    }

    function _delegateToReviewedImplementation() private {
        address implementation = IMPLEMENTATION;
        bytes32 expected = IMPLEMENTATION_RUNTIME_CODE_HASH;
        bytes32 actual = implementation.codehash;
        if (actual != expected) revert ImplementationRuntimeCodeHashMismatch(implementation, expected, actual);
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch success
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    function _effectiveTokenSalt(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        address renderer,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                tokenSalt,
                hookSalt,
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                renderer,
                keccak256(bytes(params.tokenName)),
                keccak256(bytes(params.tokenSymbol)),
                keccak256(bytes(params.nftName)),
                keccak256(bytes(params.nftSymbol))
            )
        );
    }

    function _configurationHash(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes32 hookCreationCodeHash,
        LaunchPredictionV2 memory prediction,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private view returns (bytes32) {
        ConfigurationDataV2 memory data;
        data.chainId = block.chainid;
        data.factory = address(this);
        data.poolManager = prediction.poolManager;
        data.renderer = prediction.renderer;
        data.launcherFeeRecipient = prediction.launcherFeeRecipient;
        data.builderFeeRecipient = prediction.builderFeeRecipient;
        data.shard = prediction.shard;
        data.hook = prediction.hook;
        data.nft = prediction.nft;
        data.tickLower = params.tickLower;
        data.tickBand = params.tickBand;
        data.tickUpper = params.tickUpper;
        data.startSqrtPriceX96 = params.startSqrtPriceX96;
        data.tokenNameHash = keccak256(bytes(params.tokenName));
        data.tokenSymbolHash = keccak256(bytes(params.tokenSymbol));
        data.nftNameHash = keccak256(bytes(params.nftName));
        data.nftSymbolHash = keccak256(bytes(params.nftSymbol));
        data.tokenSalt = tokenSalt;
        data.effectiveTokenSalt = prediction.effectiveTokenSalt;
        data.hookSalt = hookSalt;
        data.hookCreationCodeHash = hookCreationCodeHash;
        return keccak256(abi.encode(data));
    }

    function _innerCalldataHash(
        bytes32 tokenSalt,
        bytes32 hookSalt,
        bytes calldata hookCreationCode,
        IProgrammableExactShardsLaunchFactoryV1.LaunchParams calldata params
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encodeCall(
                IProgrammableExactShardsLaunchFactoryV1.launch, (tokenSalt, hookSalt, hookCreationCode, params)
            )
        );
    }
}
