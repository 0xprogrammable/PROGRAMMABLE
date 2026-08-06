// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import { ShardHookV1 } from "../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../src/ShardLaunchFactoryV1.sol";
import { ShardTokenV1 } from "../src/ShardTokenV1.sol";

/// @notice Reproducible prediction and narrowly separated broadcast entry points for Shards V1.
contract LaunchShardsV1 is Script {
    struct MinedPrediction {
        bytes32 hookSalt;
        address shard;
        address hook;
        bytes32 hookInitCodeHash;
        address nft;
        bytes32 configurationHash;
    }

    error WrongCanonicalHookCodeHash(bytes32 expected, bytes32 actual);
    error PredictionMismatch(address expected, address actual);
    error ConfigurationMismatch(bytes32 expected, bytes32 actual);

    function predictAndMine(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        bytes32 hookSaltStart,
        ShardLaunchFactoryV1.LaunchParams calldata params
    ) external view returns (bytes32, address, address, address, bytes32) {
        bytes memory hookCreationCode = type(ShardHookV1).creationCode;
        bytes32 canonicalHash = keccak256(hookCreationCode);
        _requireCanonicalHash(factory.hookCreationCodeHash(), canonicalHash);

        MinedPrediction memory prediction = _mine(factory, tokenSalt, hookSaltStart, hookCreationCode, params);
        _completePrediction(factory, tokenSalt, params, prediction);
        _logPrediction(factory, tokenSalt, params, canonicalHash, prediction);
        return (prediction.hookSalt, prediction.shard, prediction.hook, prediction.nft, prediction.configurationHash);
    }

    function deployFactory(IPoolManager poolManager, address launcherFeeRecipient, bytes32 hookCreationCodeHash)
        external
        returns (address factory)
    {
        bytes32 canonicalHash = keccak256(type(ShardHookV1).creationCode);
        _requireCanonicalHash(hookCreationCodeHash, canonicalHash);
        vm.startBroadcast();
        factory = address(new ShardLaunchFactoryV1(poolManager, launcherFeeRecipient, hookCreationCodeHash));
        vm.stopBroadcast();
        console2.log("factory", factory);
    }

    function launch(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        bytes32 hookSalt,
        ShardLaunchFactoryV1.LaunchParams calldata params
    ) external returns (address hook, address shard, address nft) {
        bytes32 canonicalHash = keccak256(type(ShardHookV1).creationCode);
        _requireCanonicalHash(factory.hookCreationCodeHash(), canonicalHash);
        address predictedShard = factory.predictToken(tokenSalt, hookSalt, params);
        address predictedHook = factory.predictHook(hookSalt, type(ShardHookV1).creationCode, predictedShard, params);
        address predictedNft = factory.predictNFT(predictedHook);
        bytes32 predictedConfiguration =
            factory.computeConfigurationHash(predictedHook, predictedShard, predictedNft, tokenSalt, hookSalt, params);

        vm.startBroadcast();
        (hook, shard, nft) = factory.launch(tokenSalt, hookSalt, type(ShardHookV1).creationCode, params);
        vm.stopBroadcast();

        if (shard != predictedShard) revert PredictionMismatch(predictedShard, shard);
        if (hook != predictedHook) revert PredictionMismatch(predictedHook, hook);
        if (nft != predictedNft) revert PredictionMismatch(predictedNft, nft);
        bytes32 actualConfiguration = factory.configurationHashOf(hook);
        if (actualConfiguration != predictedConfiguration) {
            revert ConfigurationMismatch(predictedConfiguration, actualConfiguration);
        }
        console2.log("hook", hook);
        console2.log("SHARD", shard);
        console2.log("NFT", nft);
        console2.log("configuration hash");
        console2.logBytes32(actualConfiguration);
    }

    function _hookInitCodeTemplate(
        ShardLaunchFactoryV1 factory,
        bytes memory hookCreationCode,
        ShardLaunchFactoryV1.LaunchParams calldata params
    ) private view returns (bytes memory) {
        return bytes.concat(
            hookCreationCode,
            abi.encode(
                factory.poolManager(),
                ShardTokenV1(address(0)),
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                address(factory),
                factory.launcherFeeRecipient(),
                params.builderFeeRecipient
            )
        );
    }

    function _mine(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        bytes32 hookSaltStart,
        bytes memory hookCreationCode,
        ShardLaunchFactoryV1.LaunchParams calldata params
    ) private view returns (MinedPrediction memory prediction) {
        bytes32 tokenCreationCodeHash = keccak256(type(ShardTokenV1).creationCode);
        bytes memory initCode = _hookInitCodeTemplate(factory, hookCreationCode, params);
        uint256 shardWord = hookCreationCode.length + 64;
        uint256 candidate = uint256(hookSaltStart);
        uint160 mask = factory.ALL_HOOK_MASK();
        uint160 requiredFlags = factory.REQUIRED_HOOK_FLAGS();
        while (true) {
            prediction.hookSalt = bytes32(candidate);
            prediction.shard = Create2.computeAddress(
                _effectiveTokenSalt(tokenSalt, prediction.hookSalt, params), tokenCreationCodeHash, address(factory)
            );
            address shard = prediction.shard;
            assembly ("memory-safe") {
                mstore(add(initCode, shardWord), shard)
            }
            prediction.hookInitCodeHash = keccak256(initCode);
            prediction.hook = Create2.computeAddress(prediction.hookSalt, prediction.hookInitCodeHash, address(factory));
            if (uint160(prediction.hook) & mask == requiredFlags) break;
            unchecked {
                ++candidate;
            }
        }

        address factoryShard = factory.predictToken(tokenSalt, prediction.hookSalt, params);
        if (factoryShard != prediction.shard) revert PredictionMismatch(prediction.shard, factoryShard);
        address factoryHook = factory.predictHook(prediction.hookSalt, hookCreationCode, prediction.shard, params);
        if (factoryHook != prediction.hook) revert PredictionMismatch(prediction.hook, factoryHook);
    }

    function _logPrediction(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        ShardLaunchFactoryV1.LaunchParams calldata params,
        bytes32 canonicalHash,
        MinedPrediction memory prediction
    ) private view {
        console2.log("factory", address(factory));
        console2.log("pool manager", address(factory.poolManager()));
        console2.log("renderer", address(factory.renderer()));
        console2.log("launcher fee recipient", factory.launcherFeeRecipient());
        console2.log("builder fee recipient", params.builderFeeRecipient);
        console2.log("raw token salt");
        console2.logBytes32(tokenSalt);
        console2.log("effective token salt");
        console2.logBytes32(factory.effectiveTokenSalt(tokenSalt, prediction.hookSalt, params));
        console2.log("hook salt");
        console2.logBytes32(prediction.hookSalt);
        console2.log("hook creation-code hash");
        console2.logBytes32(canonicalHash);
        console2.log("hook initcode hash");
        console2.logBytes32(prediction.hookInitCodeHash);
        console2.log("predicted SHARD", prediction.shard);
        console2.log("predicted hook", prediction.hook);
        console2.log("predicted NFT", prediction.nft);
        console2.log("predicted configuration hash");
        console2.logBytes32(prediction.configurationHash);
        console2.log("tick lower", int256(params.tickLower));
        console2.log("tick band", int256(params.tickBand));
        console2.log("tick upper", int256(params.tickUpper));
        console2.log("start sqrt price X96", uint256(params.startSqrtPriceX96));
    }

    function _completePrediction(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        ShardLaunchFactoryV1.LaunchParams calldata params,
        MinedPrediction memory prediction
    ) private view {
        prediction.nft = factory.predictNFT(prediction.hook);
        prediction.configurationHash = factory.computeConfigurationHash(
            prediction.hook, prediction.shard, prediction.nft, tokenSalt, prediction.hookSalt, params
        );
    }

    function _effectiveTokenSalt(bytes32 tokenSalt, bytes32 hookSalt, ShardLaunchFactoryV1.LaunchParams calldata params)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                tokenSalt,
                hookSalt,
                params.tickLower,
                params.tickBand,
                params.tickUpper,
                params.startSqrtPriceX96,
                params.builderFeeRecipient
            )
        );
    }

    function _requireCanonicalHash(bytes32 supplied, bytes32 canonical) private pure {
        if (supplied != canonical) revert WrongCanonicalHookCodeHash(canonical, supplied);
    }
}
