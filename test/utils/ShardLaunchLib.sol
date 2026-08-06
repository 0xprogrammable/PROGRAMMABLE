// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { ShardHookV1 } from "../../src/ShardHookV1.sol";
import { ShardLaunchFactoryV1 } from "../../src/ShardLaunchFactoryV1.sol";
import { ShardNFTV1 } from "../../src/ShardNFTV1.sol";
import { ShardTokenV1 } from "../../src/ShardTokenV1.sol";

library ShardLaunchLib {
    uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);
    uint160 internal constant REQUIRED_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    );

    function mine(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        bytes32 hookSaltStart,
        bytes memory hookCreationCode,
        ShardLaunchFactoryV1.LaunchParams memory params
    ) internal view returns (bytes32 hookSalt, address predictedShard, address predictedHook) {
        bytes32 tokenCreationCodeHash = keccak256(type(ShardTokenV1).creationCode);
        bytes memory initCode = _hookInitCodeTemplate(factory, hookCreationCode, params);
        uint256 shardWord = hookCreationCode.length + 64;
        // Preallocate the effective-token-salt preimage once (the seven abi.encode words) and rewrite
        // only the hook-salt word in place each iteration, so the search does not allocate — and thus
        // grow EVM memory — per candidate. The layout matches {ShardLaunchFactoryV1.effectiveTokenSalt}:
        // word 0 tokenSalt, word 1 hookSalt, then the four tick/price fields and the builder recipient.
        bytes memory saltPreimage = abi.encode(
            tokenSalt,
            bytes32(0),
            params.tickLower,
            params.tickBand,
            params.tickUpper,
            params.startSqrtPriceX96,
            params.builderFeeRecipient
        );
        uint256 candidate = uint256(hookSaltStart);
        while (true) {
            hookSalt = bytes32(candidate);
            predictedShard = Create2.computeAddress(
                _effectiveSaltFromPreimage(saltPreimage, hookSalt), tokenCreationCodeHash, address(factory)
            );
            assembly ("memory-safe") {
                mstore(add(initCode, shardWord), predictedShard)
            }
            predictedHook = Create2.computeAddress(hookSalt, keccak256(initCode), address(factory));
            if (uint160(predictedHook) & ALL_HOOK_MASK == REQUIRED_HOOK_FLAGS) {
                return (hookSalt, predictedShard, predictedHook);
            }
            unchecked {
                candidate++;
            }
        }
    }

    /// @dev Rewrites the hook-salt word of a preallocated effective-token-salt preimage in place and
    ///      hashes it, so the mining loop never allocates. Equal to
    ///      {ShardLaunchFactoryV1.effectiveTokenSalt} for the same inputs.
    function _effectiveSaltFromPreimage(bytes memory preimage, bytes32 hookSalt) private pure returns (bytes32 out) {
        assembly ("memory-safe") {
            mstore(add(preimage, 0x40), hookSalt) // second encoded word == hookSalt
            out := keccak256(add(preimage, 0x20), mload(preimage))
        }
    }

    function _hookInitCodeTemplate(
        ShardLaunchFactoryV1 factory,
        bytes memory hookCreationCode,
        ShardLaunchFactoryV1.LaunchParams memory params
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

    function mineCanonical(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        bytes32 hookSaltStart,
        ShardLaunchFactoryV1.LaunchParams memory params
    ) internal view returns (bytes32 hookSalt, address predictedShard, address predictedHook) {
        return mine(factory, tokenSalt, hookSaltStart, type(ShardHookV1).creationCode, params);
    }

    function mineAndLaunch(
        ShardLaunchFactoryV1 factory,
        bytes32 tokenSalt,
        bytes32 hookSaltStart,
        ShardLaunchFactoryV1.LaunchParams memory params
    ) internal returns (ShardHookV1 hook, ShardTokenV1 shard, ShardNFTV1 nft, bytes32 hookSalt) {
        bytes memory hookCreationCode = type(ShardHookV1).creationCode;
        address predictedShard;
        address predictedHook;
        (hookSalt, predictedShard, predictedHook) = mine(factory, tokenSalt, hookSaltStart, hookCreationCode, params);
        (address hookAddress, address shardAddress, address nftAddress) =
            factory.launch(tokenSalt, hookSalt, hookCreationCode, params);
        assert(hookAddress == predictedHook && shardAddress == predictedShard);
        hook = ShardHookV1(payable(hookAddress));
        shard = ShardTokenV1(shardAddress);
        nft = ShardNFTV1(nftAddress);
    }
}
