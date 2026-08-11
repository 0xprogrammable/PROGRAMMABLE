// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ShardHookV1 } from "shards-v1/src/ShardHookV1.sol";

/// @dev Constructor-only data container. Runtime is exactly STOP followed by the supplied immutable bytes.
contract ProgrammableCodeBlobV1 {
    constructor(bytes memory data) {
        bytes memory runtime = bytes.concat(hex"00", data);
        assembly ("memory-safe") {
            return(add(runtime, 0x20), mload(runtime))
        }
    }
}

/// @notice Source-derived, deterministic store for the exact Shards hook creation code.
/// @dev The 26,402-byte creation code exceeds EIP-170, so the constructor splits it across two inert child runtimes.
///      The deployed store is small, stateless and source-verifiable; every read rechecks both child code hashes.
contract ProgrammableShardsHookCodeStoreV1 {
    uint256 public constant HOOK_CREATION_CODE_LENGTH = 26_402;
    uint256 public constant PART_0_LENGTH = 24_575;
    uint256 public constant PART_1_LENGTH = HOOK_CREATION_CODE_LENGTH - PART_0_LENGTH;
    bytes32 public constant HOOK_CREATION_CODE_HASH =
        0x3fbdbc069ee5bfcb1ded77a8d4e550f1bb0692a488b6eb5d23dac090fbca0716;
    bytes32 public constant PART_0_DATA_HASH = 0x840c83ccf05ed1d439667daad3782953091125dcbf87c787b138dd3889f63e82;
    bytes32 public constant PART_1_DATA_HASH = 0xbc7823514bc89527980370ad0be8b7cf2d50facc23c65b39140449c861e97cae;
    bytes32 public constant PART_0_RUNTIME_CODE_HASH =
        0xa7dbf60adc43d35d3c7559615f60f194d84424e196a16aaefda92b41d5453a09;
    bytes32 public constant PART_1_RUNTIME_CODE_HASH =
        0xa8280e92c30a67d9efb854b111eeba793609cd87bfc2b3f7605def2e6dfcf2a9;
    bytes32 public constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableShardsHookCodeStoreRuntimeBindingV1(uint256 chainId,address store,address part0,bytes32 part0RuntimeCodeHash,bytes32 part0DataHash,uint256 part0Length,address part1,bytes32 part1RuntimeCodeHash,bytes32 part1DataHash,uint256 part1Length,bytes32 hookCreationCodeHash,uint256 hookCreationCodeLength)"
    );

    address public immutable PART_0;
    address public immutable PART_1;

    error InvalidCodeIdentity(uint256 field, uint256 actualLength, bytes32 actualHash);

    constructor() {
        bytes memory hookCreationCode = type(ShardHookV1).creationCode;
        if (
            hookCreationCode.length != HOOK_CREATION_CODE_LENGTH
                || keccak256(hookCreationCode) != HOOK_CREATION_CODE_HASH
        ) revert InvalidCodeIdentity(1, hookCreationCode.length, keccak256(hookCreationCode));

        bytes memory part0 = new bytes(PART_0_LENGTH);
        bytes memory part1 = new bytes(PART_1_LENGTH);
        assembly ("memory-safe") {
            let source := add(hookCreationCode, 0x20)
            let target0 := add(part0, 0x20)
            for { let offset := 0 } lt(offset, 0x6000) { offset := add(offset, 0x20) } {
                mstore(add(target0, offset), mload(add(source, offset)))
            }
            let target1 := add(part1, 0x20)
            let source1 := add(source, 24575)
            for { let offset := 0 } lt(offset, 0x740) { offset := add(offset, 0x20) } {
                mstore(add(target1, offset), mload(add(source1, offset)))
            }
        }
        if (keccak256(part0) != PART_0_DATA_HASH || keccak256(part1) != PART_1_DATA_HASH) {
            revert InvalidCodeIdentity(2, part0.length + part1.length, keccak256(bytes.concat(part0, part1)));
        }

        address part0Address = address(new ProgrammableCodeBlobV1(part0));
        address part1Address = address(new ProgrammableCodeBlobV1(part1));
        if (
            part0Address.code.length != PART_0_LENGTH + 1 || part0Address.codehash != PART_0_RUNTIME_CODE_HASH
                || part1Address.code.length != PART_1_LENGTH + 1 || part1Address.codehash != PART_1_RUNTIME_CODE_HASH
        ) revert InvalidCodeIdentity(3, part0Address.code.length + part1Address.code.length, bytes32(0));
        PART_0 = part0Address;
        PART_1 = part1Address;
    }

    function readHookCreationCodeV1() external view returns (bytes memory hookCreationCode) {
        if (
            PART_0.code.length != PART_0_LENGTH + 1 || PART_0.codehash != PART_0_RUNTIME_CODE_HASH
                || PART_1.code.length != PART_1_LENGTH + 1 || PART_1.codehash != PART_1_RUNTIME_CODE_HASH
        ) revert InvalidCodeIdentity(4, PART_0.code.length + PART_1.code.length, bytes32(0));
        hookCreationCode = new bytes(HOOK_CREATION_CODE_LENGTH);
        address part0 = PART_0;
        address part1 = PART_1;
        assembly ("memory-safe") {
            extcodecopy(part0, add(hookCreationCode, 0x20), 1, 24575)
            extcodecopy(part1, add(add(hookCreationCode, 0x20), 24575), 1, 1827)
        }
        if (keccak256(hookCreationCode) != HOOK_CREATION_CODE_HASH) {
            revert InvalidCodeIdentity(5, hookCreationCode.length, keccak256(hookCreationCode));
        }
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        return keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                PART_0,
                PART_0_RUNTIME_CODE_HASH,
                PART_0_DATA_HASH,
                PART_0_LENGTH,
                PART_1,
                PART_1_RUNTIME_CODE_HASH,
                PART_1_DATA_HASH,
                PART_1_LENGTH,
                HOOK_CREATION_CODE_HASH,
                HOOK_CREATION_CODE_LENGTH
            )
        );
    }
}
