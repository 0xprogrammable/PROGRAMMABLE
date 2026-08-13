// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import {
    ProgrammableExactHookemonNormalCreateExecutorV2
} from "../../src/router_vnext/ProgrammableExactHookemonNormalCreateExecutorV2.sol";

contract HookemonReusableProfileProofV2 {
    function predictedExecutorV2(bytes32 salt) external view returns (address predicted) {
        predicted = _predictedExecutor(salt);
    }

    function launchV2(
        bytes32 salt,
        bytes calldata initCode,
        bytes32 expectedInitCodeHash,
        address expectedLauncher,
        bytes32 expectedLauncherRuntimeCodeHash
    ) external returns (address executor, address launcher) {
        executor = address(new ProgrammableExactHookemonNormalCreateExecutorV2{ salt: salt }());
        require(executor == _predictedExecutor(salt), "executor prediction");
        launcher = ProgrammableExactHookemonNormalCreateExecutorV2(executor)
            .executeExactNormalCreateV2(
                initCode, expectedInitCodeHash, expectedLauncher, expectedLauncherRuntimeCodeHash
            );
    }

    function callExecutorAgain(address executor, bytes calldata initCode, address expectedLauncher, bytes32 runtimeHash)
        external
    {
        ProgrammableExactHookemonNormalCreateExecutorV2(executor)
            .executeExactNormalCreateV2(initCode, keccak256(initCode), expectedLauncher, runtimeHash);
    }

    function _predictedExecutor(bytes32 salt) private view returns (address predicted) {
        predicted = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            address(this),
                            salt,
                            keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).creationCode)
                        )
                    )
                )
            )
        );
    }
}

contract HookemonExecutorLauncherProofV2 {
    bytes32 public immutable configurationHash;

    constructor(bytes32 configurationHash_) {
        require(configurationHash_ != bytes32(0), "configuration");
        configurationHash = configurationHash_;
    }
}

contract HookemonRevertingLauncherProofV2 {
    constructor() {
        revert("constructor failed");
    }
}

contract ProgrammableExactHookemonNormalCreateExecutorV2Test is Test {
    function testReusableProfileCreatesDeterministicExecutorWhoseFirstCreateIsNonceOne() external {
        HookemonReusableProfileProofV2 profile = new HookemonReusableProfileProofV2();
        bytes32 salt = keccak256(abi.encode("hookemon-executor-v2", uint64(1_324_982_531), address(this)));
        address predictedExecutor = profile.predictedExecutorV2(salt);
        address predictedLauncher = vm.computeCreateAddress(predictedExecutor, 1);
        bytes memory initCode =
            bytes.concat(type(HookemonExecutorLauncherProofV2).creationCode, abi.encode(keccak256("exact-config")));
        bytes32 expectedRuntimeHash = _launcherRuntimeHash(keccak256("exact-config"));

        (address executor, address launcher) =
            profile.launchV2(salt, initCode, keccak256(initCode), predictedLauncher, expectedRuntimeHash);

        assertEq(executor, predictedExecutor, "CREATE2 executor");
        assertEq(launcher, predictedLauncher, "NORMAL_CREATE nonce one launcher");
        assertEq(
            executor.codehash,
            keccak256(type(ProgrammableExactHookemonNormalCreateExecutorV2).runtimeCode),
            "fixed executor runtime"
        );
        assertEq(ProgrammableExactHookemonNormalCreateExecutorV2(executor).profile(), address(profile), "bound profile");
        assertEq(ProgrammableExactHookemonNormalCreateExecutorV2(executor).executionState(), 2, "one-shot state");
        assertEq(
            ProgrammableExactHookemonNormalCreateExecutorV2(executor).completeInitCodeHash(),
            keccak256(initCode),
            "initcode binding"
        );
    }

    function testExecutorSaltDoesNotDependOnMinedHookSaltOrDynamicIdentity() external {
        HookemonReusableProfileProofV2 profile = new HookemonReusableProfileProofV2();
        bytes32 repositoryKey = keccak256(abi.encode("programmable.github.repository.v1", uint256(1_324_982_531)));
        bytes32 sourceLaunchId = keccak256("source-launch-id");
        address applicant = address(0xA11CE);
        bytes32 salt =
            keccak256(abi.encode("programmable.hookemon.executor.v2", repositoryKey, sourceLaunchId, applicant));
        address first = profile.predictedExecutorV2(salt);

        bytes32 hookSaltA = keccak256("mined-after-first-prediction-a");
        bytes32 hookSaltB = keccak256("mined-after-first-prediction-b");
        bytes32 nameHash = keccak256("Hookemon Alpha");
        bytes32 symbolHash = keccak256("ALPHA");
        assertTrue(hookSaltA != hookSaltB && nameHash != symbolHash, "proof inputs collapsed");
        assertEq(profile.predictedExecutorV2(salt), first, "dynamic config changed executor");
    }

    function testLauncherCreationFailureRollsBackExecutorAndCanRetrySameSalt() external {
        HookemonReusableProfileProofV2 profile = new HookemonReusableProfileProofV2();
        bytes32 salt = keccak256("rollback-executor-salt");
        address executor = profile.predictedExecutorV2(salt);
        address launcher = vm.computeCreateAddress(executor, 1);
        bytes memory revertingInitCode = type(HookemonRevertingLauncherProofV2).creationCode;

        vm.expectRevert();
        profile.launchV2(
            salt, revertingInitCode, keccak256(revertingInitCode), launcher, keccak256("unreachable-runtime")
        );
        assertEq(executor.code.length, 0, "failed executor survived");
        assertEq(launcher.code.length, 0, "failed launcher survived");

        bytes32 configurationHash = keccak256("retry-config");
        bytes memory retryInitCode =
            bytes.concat(type(HookemonExecutorLauncherProofV2).creationCode, abi.encode(configurationHash));
        (address retriedExecutor, address retriedLauncher) = profile.launchV2(
            salt, retryInitCode, keccak256(retryInitCode), launcher, _launcherRuntimeHash(configurationHash)
        );
        assertEq(retriedExecutor, executor, "retry executor changed");
        assertEq(retriedLauncher, launcher, "retry launcher changed");
    }

    function testExecutorRejectsWrongCallerHashAddressRuntimeAndReplay() external {
        HookemonReusableProfileProofV2 profile = new HookemonReusableProfileProofV2();
        bytes32 salt = keccak256("closed-executor-salt");
        address executor = profile.predictedExecutorV2(salt);
        address launcher = vm.computeCreateAddress(executor, 1);
        bytes32 configurationHash = keccak256("closed-config");
        bytes memory initCode =
            bytes.concat(type(HookemonExecutorLauncherProofV2).creationCode, abi.encode(configurationHash));
        bytes32 runtimeHash = _launcherRuntimeHash(configurationHash);

        profile.launchV2(salt, initCode, keccak256(initCode), launcher, runtimeHash);

        vm.expectRevert(ProgrammableExactHookemonNormalCreateExecutorV2.UnauthorizedProfile.selector);
        ProgrammableExactHookemonNormalCreateExecutorV2(executor)
            .executeExactNormalCreateV2(initCode, keccak256(initCode), launcher, runtimeHash);
        vm.expectRevert(ProgrammableExactHookemonNormalCreateExecutorV2.ReentrantOrConsumed.selector);
        profile.callExecutorAgain(executor, initCode, launcher, runtimeHash);

        _assertInvalidInputFails(1);
        _assertInvalidInputFails(2);
        _assertInvalidInputFails(3);
    }

    function _assertInvalidInputFails(uint8 mutation) private {
        HookemonReusableProfileProofV2 profile = new HookemonReusableProfileProofV2();
        bytes32 salt = keccak256(abi.encode("invalid-executor", mutation));
        address executor = profile.predictedExecutorV2(salt);
        address predictedLauncher = vm.computeCreateAddress(executor, 1);
        bytes32 configurationHash = keccak256(abi.encode("invalid-config", mutation));
        bytes memory initCode =
            bytes.concat(type(HookemonExecutorLauncherProofV2).creationCode, abi.encode(configurationHash));
        bytes32 selectedInitCodeHash = mutation == 1 ? keccak256("wrong-initcode-hash") : keccak256(initCode);
        address selectedLauncher = mutation == 2 ? address(0x1234) : predictedLauncher;
        bytes32 selectedRuntime = mutation == 3 ? keccak256("wrong-runtime") : _launcherRuntimeHash(configurationHash);

        vm.expectRevert();
        profile.launchV2(salt, initCode, selectedInitCodeHash, selectedLauncher, selectedRuntime);
        assertEq(executor.code.length, 0, "invalid executor survived");
        assertEq(predictedLauncher.code.length, 0, "invalid launcher survived");
    }

    function _launcherRuntimeHash(bytes32 configurationHash) private returns (bytes32 runtimeHash) {
        HookemonExecutorLauncherProofV2 deployedReference = new HookemonExecutorLauncherProofV2(configurationHash);
        return address(deployedReference).codehash;
    }
}
