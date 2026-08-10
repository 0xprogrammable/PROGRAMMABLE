// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";

import { IProgrammableExactShardsProfileV1 } from "./interfaces/IProgrammableExactShardsProfileV1.sol";
import { IProgrammableLaunchStampRouterV2 } from "./interfaces/IProgrammableLaunchStampRouterV2.sol";
import {
    IProgrammableNestedFactoryV1,
    IProgrammableNestedHookV1,
    IProgrammableNestedNftV1
} from "./interfaces/IProgrammableNestedFactoryV1.sol";

/// @title ProgrammableExactShardsProfileV1
/// @notice Stateless validator for exactly jesse-stahl/shards-v1@91b38f3 and its frozen launch plan.
/// @dev The platform predeploys the exact factory. The Router performs the applicant's one factory launch itself.
contract ProgrammableExactShardsProfileV1 is IProgrammableExactShardsProfileV1 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    bytes32 public constant PROFILE_ID_HASH = keccak256("exact-shards-nested-factory");
    bytes32 public constant PROFILE_VERSION_HASH = keccak256("1.0.0");
    bytes32 public constant PROFILE_KEY = 0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c;
    address public constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 public constant POOL_MANAGER_RUNTIME_CODE_HASH =
        0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    address public constant LAUNCH_WALLET = 0xceeBB3A6543CeBEB2ED66963897A0abEA52A50cC;
    address public constant FACTORY_DEPLOYMENT_PROXY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 public constant FACTORY_DEPLOYMENT_PROXY_RUNTIME_CODE_HASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    bytes32 public constant FACTORY_SALT = 0x655a4b5a2b704bef84b4ff94adde0a7ac40ad0366c82ddca5290180fe4c3986d;
    bytes32 public constant FACTORY_CREATION_CODE_HASH =
        0xc6b8a2cd51ccf198c4e6e41f668c4e4f558f81de0e677ef27373c614bf4c02f8;
    bytes32 public constant FACTORY_INIT_CODE_HASH = 0x7d05592489495559b1288f8ad342239b3fb95a6aa005b5b0b1551c9523401585;
    bytes32 public constant FACTORY_DEPLOYMENT_CALLDATA_HASH =
        0xf37ce9748abe4d5243cbd26f48c6ea5789ab1ebe8e19ea96d2198693e957c4ec;
    address public constant FACTORY = 0x9442a520e7b31D10177C75A363355C2C29141ac5;
    bytes32 public constant FACTORY_RUNTIME_CODE_HASH =
        0x134a9e5674f22e62e939c2238693077b8027c553bb26d6a4e9e3d8554e5f85b5;
    address public constant RENDERER = 0x090DBD2FaB1a467f90ed82a443eFa9AAb658DE14;
    bytes32 public constant RENDERER_CREATION_CODE_HASH =
        0x910d02d740c71d608b1dc3f49e26288b0f8a62abda0c7767e251d53520a6b51e;
    bytes32 public constant RENDERER_RUNTIME_CODE_HASH =
        0x9b54a61918b2ddf9b7daf41d9bf2d705cbef3a0fd618275762b99e19c53459bf;
    address public constant LAUNCHER_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    address public constant BUILDER_FEE_RECIPIENT = LAUNCH_WALLET;
    bytes32 public constant TOKEN_CREATION_CODE_HASH =
        0xa6461c32c0121f0090519945d9c22ed6406a783994e020f72a20e85796cad107;
    bytes32 public constant HOOK_CREATION_CODE_HASH =
        0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716;
    bytes32 public constant NFT_CREATION_CODE_HASH = 0x888e18b33ff193b65eb61f44bc578d8d9365b505014af3782762a9d61fa39150;
    bytes32 public constant TOKEN_SALT = 0xca9944c923e24ba5cb3188a29b18c3305158e686e39473e91bbe31fc019816ab;
    bytes32 public constant EFFECTIVE_TOKEN_SALT = 0x2fb771368a131f3ebf686980b44c57230bf257f4b82e95a10ef46d9b2bd7db37;
    bytes32 public constant HOOK_SALT = bytes32(uint256(0x52e1));
    address public constant TOKEN = 0x50d17EAaeB52c66E64b918385AbF6523fDAE57CF;
    bytes32 public constant TOKEN_RUNTIME_CODE_HASH =
        0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8;
    address public constant HOOK = 0xbA318baA8649962fD77CC7082d098f2C09Fd60cC;
    bytes32 public constant HOOK_RUNTIME_CODE_HASH = 0x2a2174aff52c3ea9ddf0a6081464c9c6dbc43ddc93609c74d9610f50f486c1e1;
    address public constant NFT = 0x9fDA98dE1B7061ae02A9Aec7A6f8ed75a8Feb8F3;
    bytes32 public constant NFT_RUNTIME_CODE_HASH = 0xc3e3ea6cf4d2e13fa07a3b053d57cd7d6a6ecac7633aed86ab971d5e53959bb3;
    bytes32 public constant CONFIGURATION_HASH = 0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1;
    bytes32 public constant POOL_ID = 0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d;
    bytes32 public constant POOL_KEY_HASH = 0x95c1d301b4a0be5bf2ec99270902aae6e8d8bd16a96a005d5985583c0b49835a;
    bytes32 public constant SOURCE_REVISION_HASH = 0x3352fe14662ce467e98f475cf91f10304ce4d69b6342fae4bf3dc968c494d6dc;
    bytes32 public constant MANIFEST_HASH = 0x4672dfda95c9765916397701479483b8e1db852165949518cdc9932fd8e1b359;
    bytes32 public constant REVENUE_POLICY_HASH = 0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2;
    bytes32 public constant LAUNCH_CALLDATA_HASH = 0x39d08baf1cdececc5829853fd1274547c2e8260779d0c227ec30dc44daf1ae89;
    int24 public constant TICK_LOWER = -887_220;
    int24 public constant TICK_BAND = 22_980;
    int24 public constant TICK_UPPER = 69_060;
    uint160 public constant START_SQRT_PRICE_X96 = 2_502_784_483_440_051_878_955_016_419_363;
    uint160 public constant REQUIRED_HOOK_FLAGS = 0x20cc;
    uint160 private constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    bytes32 private constant POOL_KEY_TYPEHASH = keccak256(
        "ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"
    );
    bytes32 private constant EXPECTED_RESULT_TYPEHASH = keccak256(
        "ProgrammableNestedFactoryResultV1(address factory,bytes32 factoryRuntimeCodeHash,address renderer,bytes32 rendererRuntimeCodeHash,address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address nft,bytes32 nftRuntimeCodeHash,bytes32 configurationHash,bytes32 poolKeyHash,uint160 sqrtPriceX96)"
    );

    uint8 private constant BIND_ROUTE = 1;
    uint8 private constant BIND_PARAMS = 2;
    uint8 private constant BIND_COMPONENTS = 3;
    uint8 private constant BIND_FACTORY = 4;
    uint8 private constant BIND_PREDICTIONS = 5;
    uint8 private constant BIND_POOL = 6;
    uint8 private constant BIND_HOOK = 7;
    uint8 private constant BIND_NFT = 8;
    uint8 private constant BIND_CONFIG = 9;
    uint8 private constant BIND_BALANCE = 10;

    error InvalidShardsBinding(uint8 field);
    error InvalidRuntime(address component, bytes32 expected, bytes32 actual);
    error Occupied(address component);

    function validatePreV1(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request,
        IPoolManager poolManager
    ) external view returns (bytes32 poolId, bytes32 poolKeyHash, bytes32 expectedResultHash) {
        _validateExactRoute(route, request, poolManager);
        _validateFactory(route, poolManager);
        _requireVacant(request.token);
        _requireVacant(request.hook);
        _requireVacant(request.nft);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(request.poolKey.toId());
        if (sqrtPriceX96 != 0) revert InvalidShardsBinding(BIND_POOL);
        poolId = PoolId.unwrap(request.poolKey.toId());
        poolKeyHash = _poolKeyHash(request.poolKey);
        expectedResultHash = computeExpectedResultHash(route, request);
    }

    function validatePostV1(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request,
        IPoolManager poolManager
    ) external view returns (bytes32 observedResultHash) {
        _validateFactory(route, poolManager);
        _requireRuntime(request.token, TOKEN_RUNTIME_CODE_HASH);
        _requireRuntime(request.hook, HOOK_RUNTIME_CODE_HASH);
        _requireRuntime(request.nft, NFT_RUNTIME_CODE_HASH);

        IProgrammableNestedHookV1 hook = IProgrammableNestedHookV1(request.hook);
        if (
            address(hook.poolManager()) != POOL_MANAGER || hook.deployer() != FACTORY || hook.shard() != TOKEN
                || hook.nft() != NFT || !hook.initialised() || _poolKeyHash(hook.poolKey()) != POOL_KEY_HASH
        ) revert InvalidShardsBinding(BIND_HOOK);
        IProgrammableNestedNftV1 nft = IProgrammableNestedNftV1(request.nft);
        if (nft.hook() != HOOK || nft.renderer() != RENDERER) revert InvalidShardsBinding(BIND_NFT);

        IProgrammableNestedFactoryV1 factory = IProgrammableNestedFactoryV1(FACTORY);
        if (
            factory.configurationHashOf(HOOK) != CONFIGURATION_HASH
                || factory.computeConfigurationHash(HOOK, TOKEN, NFT, TOKEN_SALT, HOOK_SALT, route.params)
                    != CONFIGURATION_HASH
        ) revert InvalidShardsBinding(BIND_CONFIG);
        if (IERC20(TOKEN).balanceOf(FACTORY) != 0) revert InvalidShardsBinding(BIND_BALANCE);
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(request.poolKey.toId());
        if (sqrtPriceX96 != START_SQRT_PRICE_X96) revert InvalidShardsBinding(BIND_POOL);

        observedResultHash = _resultHash(
            FACTORY_RUNTIME_CODE_HASH,
            RENDERER_RUNTIME_CODE_HASH,
            TOKEN_RUNTIME_CODE_HASH,
            HOOK_RUNTIME_CODE_HASH,
            NFT_RUNTIME_CODE_HASH,
            CONFIGURATION_HASH,
            POOL_KEY_HASH,
            sqrtPriceX96
        );
    }

    function computeExpectedResultHash(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request
    ) public pure returns (bytes32) {
        return _resultHash(
            route.factoryRuntimeCodeHash,
            route.rendererRuntimeCodeHash,
            request.tokenRuntimeCodeHash,
            request.hookRuntimeCodeHash,
            request.nftRuntimeCodeHash,
            route.expectedConfigurationHash,
            _poolKeyHash(request.poolKey),
            route.params.startSqrtPriceX96
        );
    }

    function _validateExactRoute(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IProgrammableLaunchStampRouterV2.StampRequestV2 calldata request,
        IPoolManager poolManager
    ) private view {
        if (
            block.chainid != 1 || address(poolManager) != POOL_MANAGER || route.profileIdHash != PROFILE_ID_HASH
                || route.profileVersionHash != PROFILE_VERSION_HASH || route.profileKey != PROFILE_KEY
                || route.sourceRevisionHash != SOURCE_REVISION_HASH || route.manifestHash != MANIFEST_HASH
                || route.revenuePolicyHash != REVENUE_POLICY_HASH
                || route.factoryDeploymentProxy != FACTORY_DEPLOYMENT_PROXY || route.factorySalt != FACTORY_SALT
                || route.factoryCreationCodeHash != FACTORY_CREATION_CODE_HASH
                || route.factoryInitCodeHash != FACTORY_INIT_CODE_HASH
                || route.factoryDeploymentCalldataHash != FACTORY_DEPLOYMENT_CALLDATA_HASH || route.factory != FACTORY
                || route.factoryRuntimeCodeHash != FACTORY_RUNTIME_CODE_HASH || route.renderer != RENDERER
                || route.rendererCreationCodeHash != RENDERER_CREATION_CODE_HASH
                || route.rendererRuntimeCodeHash != RENDERER_RUNTIME_CODE_HASH
                || route.launcherFeeRecipient != LAUNCHER_FEE_RECIPIENT
                || route.builderFeeRecipient != BUILDER_FEE_RECIPIENT
                || _factoryAddress(route.factoryDeploymentProxy, route.factorySalt, route.factoryInitCodeHash)
                    != route.factory
        ) revert InvalidShardsBinding(BIND_ROUTE);
        if (
            route.tokenCreationCodeHash != TOKEN_CREATION_CODE_HASH
                || route.hookCreationCodeHash != HOOK_CREATION_CODE_HASH
                || route.nftCreationCodeHash != NFT_CREATION_CODE_HASH || route.tokenSalt != TOKEN_SALT
                || route.effectiveTokenSalt != EFFECTIVE_TOKEN_SALT || route.hookSalt != HOOK_SALT
                || keccak256(route.hookCreationCode) != HOOK_CREATION_CODE_HASH
                || route.expectedLaunchCalldataHash != LAUNCH_CALLDATA_HASH
                || keccak256(
                        abi.encodeWithSelector(
                            IProgrammableNestedFactoryV1.launch.selector,
                            route.tokenSalt,
                            route.hookSalt,
                            route.hookCreationCode,
                            route.params
                        )
                    ) != LAUNCH_CALLDATA_HASH
        ) revert InvalidShardsBinding(BIND_ROUTE);
        if (
            route.params.tickLower != TICK_LOWER || route.params.tickBand != TICK_BAND
                || route.params.tickUpper != TICK_UPPER || route.params.startSqrtPriceX96 != START_SQRT_PRICE_X96
                || route.params.renderer != address(0) || keccak256(bytes(route.params.tokenName)) != keccak256("Shard")
                || keccak256(bytes(route.params.tokenSymbol)) != keccak256("SHARD")
                || keccak256(bytes(route.params.nftName)) != keccak256("Shards")
                || keccak256(bytes(route.params.nftSymbol)) != keccak256("SHARDS")
        ) revert InvalidShardsBinding(BIND_PARAMS);
        if (
            route.expectedToken != TOKEN || route.expectedTokenRuntimeCodeHash != TOKEN_RUNTIME_CODE_HASH
                || route.expectedHook != HOOK || route.expectedHookRuntimeCodeHash != HOOK_RUNTIME_CODE_HASH
                || route.expectedNft != NFT || route.expectedNftRuntimeCodeHash != NFT_RUNTIME_CODE_HASH
                || route.expectedConfigurationHash != CONFIGURATION_HASH || request.token != TOKEN
                || request.tokenRuntimeCodeHash != TOKEN_RUNTIME_CODE_HASH || request.hook != HOOK
                || request.hookRuntimeCodeHash != HOOK_RUNTIME_CODE_HASH || request.nft != NFT
                || request.nftRuntimeCodeHash != NFT_RUNTIME_CODE_HASH
                || PoolId.unwrap(request.poolKey.toId()) != POOL_ID || _poolKeyHash(request.poolKey) != POOL_KEY_HASH
                || (uint160(request.hook) & ALL_HOOK_MASK) != REQUIRED_HOOK_FLAGS
        ) revert InvalidShardsBinding(BIND_COMPONENTS);
        _requireRuntime(POOL_MANAGER, POOL_MANAGER_RUNTIME_CODE_HASH);
        _requireRuntime(FACTORY_DEPLOYMENT_PROXY, FACTORY_DEPLOYMENT_PROXY_RUNTIME_CODE_HASH);
    }

    function _validateFactory(
        IProgrammableLaunchStampRouterV2.NestedFactoryRouteV1 calldata route,
        IPoolManager poolManager
    ) private view {
        _requireRuntime(FACTORY, FACTORY_RUNTIME_CODE_HASH);
        _requireRuntime(RENDERER, RENDERER_RUNTIME_CODE_HASH);
        IProgrammableNestedFactoryV1 factory = IProgrammableNestedFactoryV1(FACTORY);
        if (
            address(factory.poolManager()) != address(poolManager) || factory.renderer() != RENDERER
                || factory.resolveRenderer(address(0)) != RENDERER
                || factory.hookCreationCodeHash() != HOOK_CREATION_CODE_HASH
                || factory.launcherFeeRecipient() != LAUNCHER_FEE_RECIPIENT
                || factory.builderFeeRecipient() != BUILDER_FEE_RECIPIENT
                || factory.effectiveTokenSalt(TOKEN_SALT, HOOK_SALT, route.params) != EFFECTIVE_TOKEN_SALT
        ) revert InvalidShardsBinding(BIND_FACTORY);
        if (
            factory.predictToken(TOKEN_SALT, HOOK_SALT, route.params) != TOKEN
                || factory.predictHook(HOOK_SALT, route.hookCreationCode, TOKEN, route.params) != HOOK
                || factory.predictNFT(HOOK, route.params) != NFT
                || factory.computeConfigurationHash(HOOK, TOKEN, NFT, TOKEN_SALT, HOOK_SALT, route.params)
                    != CONFIGURATION_HASH
        ) revert InvalidShardsBinding(BIND_PREDICTIONS);
    }

    function _resultHash(
        bytes32 factoryRuntimeCodeHash,
        bytes32 rendererRuntimeCodeHash,
        bytes32 tokenRuntimeCodeHash,
        bytes32 hookRuntimeCodeHash,
        bytes32 nftRuntimeCodeHash,
        bytes32 configurationHash,
        bytes32 poolKeyHash,
        uint160 sqrtPriceX96
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXPECTED_RESULT_TYPEHASH,
                FACTORY,
                factoryRuntimeCodeHash,
                RENDERER,
                rendererRuntimeCodeHash,
                TOKEN,
                tokenRuntimeCodeHash,
                HOOK,
                hookRuntimeCodeHash,
                NFT,
                nftRuntimeCodeHash,
                configurationHash,
                poolKeyHash,
                sqrtPriceX96
            )
        );
    }

    function _poolKeyHash(PoolKey memory poolKey) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                POOL_KEY_TYPEHASH,
                Currency.unwrap(poolKey.currency0),
                Currency.unwrap(poolKey.currency1),
                poolKey.fee,
                poolKey.tickSpacing,
                address(poolKey.hooks)
            )
        );
    }

    function _requireRuntime(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (account.code.length == 0 || actual != expected) revert InvalidRuntime(account, expected, actual);
    }

    function _requireVacant(address account) private view {
        if (account.code.length != 0) revert Occupied(account);
    }

    function _factoryAddress(address proxy, bytes32 salt, bytes32 initCodeHash) private pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), proxy, salt, initCodeHash)))));
    }
}
