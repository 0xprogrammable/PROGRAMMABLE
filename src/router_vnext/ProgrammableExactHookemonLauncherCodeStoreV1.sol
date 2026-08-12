// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableExactHookemonLauncherCodeStoreV1 } from "./IProgrammableExactHookemonNormalCreateProfileV1.sol";

/// @notice Immutable two-chunk store for one compiler-frozen HookemonAtomicLauncher creation artifact.
/// @dev The chunks use Hookemon's existing CodeChunk convention: their complete runtime is the immutable raw data.
///      This store never executes either chunk and rechecks both runtime identities on every reconstruction.
contract ProgrammableExactHookemonLauncherCodeStoreV1 is IProgrammableExactHookemonLauncherCodeStoreV1 {
    uint256 public constant MAXIMUM_CHUNK_BYTES = 23_552;
    uint256 public constant MAXIMUM_INITCODE_BYTES = 49_152;
    bytes32 public constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableExactHookemonLauncherCodeStoreBindingV1(uint256 chainId,address store,address part0,bytes32 part0RuntimeCodeHash,uint256 part0Length,address part1,bytes32 part1RuntimeCodeHash,uint256 part1Length,bytes32 creationCodeHash,uint256 creationCodeLength)"
    );

    address public immutable PART_0;
    bytes32 public immutable PART_0_RUNTIME_CODE_HASH;
    uint256 public immutable PART_0_LENGTH;
    address public immutable PART_1;
    bytes32 public immutable PART_1_RUNTIME_CODE_HASH;
    uint256 public immutable PART_1_LENGTH;
    bytes32 private immutable _creationCodeHash;
    uint256 private immutable _creationCodeLength;

    error InvalidCodeIdentity(uint256 field);

    constructor(address part0, address part1) {
        if (part0 == address(0) || part1 == address(0) || part0 == part1) revert InvalidCodeIdentity(1);
        uint256 part0Length = part0.code.length;
        uint256 part1Length = part1.code.length;
        if (
            part0Length == 0 || part1Length == 0 || part0Length > MAXIMUM_CHUNK_BYTES
                || part1Length > MAXIMUM_CHUNK_BYTES || part0Length + part1Length > MAXIMUM_INITCODE_BYTES
        ) revert InvalidCodeIdentity(2);

        bytes32 part0Hash = part0.codehash;
        bytes32 part1Hash = part1.codehash;
        bytes memory creationCode = _copyParts(part0, part0Length, part1, part1Length);
        bytes32 creationHash = keccak256(creationCode);
        if (creationHash == bytes32(0)) revert InvalidCodeIdentity(3);

        PART_0 = part0;
        PART_0_RUNTIME_CODE_HASH = part0Hash;
        PART_0_LENGTH = part0Length;
        PART_1 = part1;
        PART_1_RUNTIME_CODE_HASH = part1Hash;
        PART_1_LENGTH = part1Length;
        _creationCodeHash = creationHash;
        _creationCodeLength = creationCode.length;
    }

    function creationCodeHashV1() external view returns (bytes32) {
        return _creationCodeHash;
    }

    function creationCodeLengthV1() external view returns (uint256) {
        return _creationCodeLength;
    }

    function partV1(uint256 index)
        external
        view
        returns (address account, bytes32 runtimeCodeHash, uint256 dataLength)
    {
        if (index == 0) {
            return (PART_0, PART_0_RUNTIME_CODE_HASH, PART_0_LENGTH);
        }
        if (index == 1) return (PART_1, PART_1_RUNTIME_CODE_HASH, PART_1_LENGTH);
        revert InvalidCodeIdentity(4);
    }

    function readCreationCodeV1() external view returns (bytes memory creationCode) {
        _requirePartsCurrent();
        creationCode = _copyParts(PART_0, PART_0_LENGTH, PART_1, PART_1_LENGTH);
        if (creationCode.length != _creationCodeLength || keccak256(creationCode) != _creationCodeHash) {
            revert InvalidCodeIdentity(5);
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
                PART_0_LENGTH,
                PART_1,
                PART_1_RUNTIME_CODE_HASH,
                PART_1_LENGTH,
                _creationCodeHash,
                _creationCodeLength
            )
        );
    }

    function _requirePartsCurrent() private view {
        if (
            PART_0.code.length != PART_0_LENGTH || PART_0.codehash != PART_0_RUNTIME_CODE_HASH
                || PART_1.code.length != PART_1_LENGTH || PART_1.codehash != PART_1_RUNTIME_CODE_HASH
        ) revert InvalidCodeIdentity(6);
    }

    function _copyParts(address part0, uint256 part0Length, address part1, uint256 part1Length)
        private
        view
        returns (bytes memory creationCode)
    {
        creationCode = new bytes(part0Length + part1Length);
        assembly ("memory-safe") {
            extcodecopy(part0, add(creationCode, 32), 0, part0Length)
            extcodecopy(part1, add(add(creationCode, 32), part0Length), 0, part1Length)
        }
    }
}
