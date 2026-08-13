// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Fixed one-shot boundary that gives each reusable Hookemon profile launch a fresh nonce-one deployer.
/// @dev The reusable profile CREATE2-deploys this exact no-argument creation code and calls it atomically. The
///      profile reconstructs the reviewed Hookemon initcode; this executor independently closes its hash, the
///      NORMAL_CREATE nonce-one address and the resulting launcher runtime hash.
contract ProgrammableExactHookemonNormalCreateExecutorV2 {
    uint256 public constant MAXIMUM_INITCODE_BYTES = 49_152;

    // Runtime must be compiler-fixed across every CREATE2 instance; storing the profile avoids immutable patching.
    // slither-disable-next-line immutable-states
    address public profile;
    address public launcher;
    bytes32 public completeInitCodeHash;
    uint8 public executionState;

    error UnauthorizedProfile();
    error InvalidExecutionInput();
    error ReentrantOrConsumed();
    error CreateFailed();

    event ExactNormalCreateExecuted(address indexed profile, address indexed launcher, bytes32 completeInitCodeHash);

    constructor() {
        profile = msg.sender;
    }

    function predictedLauncherV2() public view returns (address predicted) {
        predicted = address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", address(this), hex"01")))));
    }

    function executeExactNormalCreateV2(
        bytes calldata initCode,
        bytes32 expectedInitCodeHash,
        address expectedLauncher,
        bytes32 expectedLauncherRuntimeCodeHash
    ) external returns (address createdLauncher) {
        if (msg.sender != profile) revert UnauthorizedProfile();
        if (executionState != 0) revert ReentrantOrConsumed();
        if (
            initCode.length == 0 || initCode.length > MAXIMUM_INITCODE_BYTES || expectedInitCodeHash == bytes32(0)
                || expectedLauncherRuntimeCodeHash == bytes32(0) || keccak256(initCode) != expectedInitCodeHash
                || expectedLauncher == address(0) || expectedLauncher != predictedLauncherV2()
                || expectedLauncher.code.length != 0
        ) revert InvalidExecutionInput();

        executionState = 1;
        bytes memory creation = initCode;
        assembly ("memory-safe") {
            createdLauncher := create(0, add(creation, 32), mload(creation))
        }
        if (
            createdLauncher == address(0) || createdLauncher != expectedLauncher
                || createdLauncher.codehash != expectedLauncherRuntimeCodeHash
        ) revert CreateFailed();

        launcher = createdLauncher;
        completeInitCodeHash = expectedInitCodeHash;
        executionState = 2;
        emit ExactNormalCreateExecuted(profile, createdLauncher, expectedInitCodeHash);
    }
}
