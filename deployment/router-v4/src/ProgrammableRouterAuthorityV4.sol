// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {
    IProgrammableUniversalLaunchKernelV1
} from "programmable-src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import {
    IProgrammableCompletedGraphAdoptionCompatV1
} from "programmable-src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol";

/// @notice Shared, closed state for one purpose-separated Router Authority V4 role endpoint.
/// @dev The controller may be an EOA or ERC-1271 wallet. Consumer targets are bound once by the deterministic graph
///      deployer. There is no arbitrary target, selector, calldata, value, delegatecall, upgrade, or sweep surface.
abstract contract ProgrammableRouterAuthorityV4Base {
    bytes32 public constant AUTHORITY_CONTROLLER_DIGEST_TYPEHASH = keccak256(
        "ProgrammableRouterAuthorityV4ControllerDigest(uint256 chainId,address authority,bytes32 roleId,uint8 purpose,address consumer,bytes32 consumerDigest,uint64 keyEpoch,uint64 authorityGeneration,bytes32 serviceReleaseBindingHash)"
    );
    bytes32 public constant AUTHORITY_RUNTIME_BINDING_TYPEHASH = keccak256(
        "ProgrammableRouterAuthorityV4RuntimeBinding(bytes32 immutableBindingHash,bytes32 consumerBindingHash,bytes32 controlBindingHash)"
    );
    bytes32 public constant AUTHORITY_IMMUTABLE_BINDING_TYPEHASH = keccak256(
        "ProgrammableRouterAuthorityV4ImmutableBinding(uint256 chainId,address authority,bytes32 roleId,address controller,bytes32 controllerRuntimeCodeHash,address initializer)"
    );
    bytes32 public constant AUTHORITY_CONSUMER_BINDING_TYPEHASH = keccak256(
        "ProgrammableRouterAuthorityV4ConsumerBinding(address universalKernel,bytes32 universalKernelRuntimeCodeHash,address hookemonRegistry,bytes32 hookemonRegistryRuntimeCodeHash)"
    );
    bytes32 public constant AUTHORITY_CONTROL_BINDING_TYPEHASH = keccak256(
        "ProgrammableRouterAuthorityV4ControlBinding(uint64 keyEpoch,uint64 authorityGeneration,bytes32 serviceReleaseBindingHash,bool initialized,bool killed)"
    );

    address public immutable CONTROLLER;
    bytes32 public immutable CONTROLLER_RUNTIME_CODEHASH;
    address public immutable INITIALIZER;

    address public universalKernel;
    bytes32 public universalKernelRuntimeCodeHash;
    address public hookemonRegistry;
    bytes32 public hookemonRegistryRuntimeCodeHash;
    uint64 public keyEpoch;
    uint64 public authorityGeneration;
    bytes32 public serviceReleaseBindingHash;
    bool public initialized;
    bool public killed;

    error Unauthorized();
    error InvalidBinding(uint256 field);
    error InvalidState();
    error RuntimeCodeHashDrift(address account);

    event ConsumersBoundV1(
        address indexed universalKernel,
        bytes32 universalKernelRuntimeCodeHash,
        address indexed hookemonRegistry,
        bytes32 hookemonRegistryRuntimeCodeHash
    );
    event AuthorityBindingAdvancedV1(
        uint64 indexed authorityGeneration, uint64 keyEpoch, bytes32 serviceReleaseBindingHash, bool killed
    );

    constructor(
        address controller,
        bytes32 controllerRuntimeCodeHash,
        address initializer,
        uint64 initialKeyEpoch,
        bytes32 initialServiceReleaseBindingHash
    ) {
        if (
            controller == address(0) || initializer == address(0) || initialKeyEpoch == 0
                || initialServiceReleaseBindingHash == bytes32(0) || controller == address(this)
        ) revert InvalidBinding(1);
        if (controller.code.length == 0) {
            if (controllerRuntimeCodeHash != bytes32(0)) revert InvalidBinding(2);
        } else if (controller.codehash != controllerRuntimeCodeHash || controllerRuntimeCodeHash == bytes32(0)) {
            revert InvalidBinding(2);
        }
        CONTROLLER = controller;
        CONTROLLER_RUNTIME_CODEHASH = controllerRuntimeCodeHash;
        INITIALIZER = initializer;
        keyEpoch = initialKeyEpoch;
        authorityGeneration = 1;
        serviceReleaseBindingHash = initialServiceReleaseBindingHash;
    }

    /// @notice Binds both frozen consumer families exactly once during the atomic graph initializer phase.
    function initializeConsumersV1(
        address universalKernel_,
        bytes32 universalKernelRuntimeCodeHash_,
        address hookemonRegistry_,
        bytes32 hookemonRegistryRuntimeCodeHash_
    ) external {
        if (msg.sender != INITIALIZER) revert Unauthorized();
        if (initialized) revert InvalidState();
        _requireRuntime(universalKernel_, universalKernelRuntimeCodeHash_);
        _requireRuntime(hookemonRegistry_, hookemonRegistryRuntimeCodeHash_);
        if (universalKernel_ == hookemonRegistry_) revert InvalidBinding(3);
        universalKernel = universalKernel_;
        universalKernelRuntimeCodeHash = universalKernelRuntimeCodeHash_;
        hookemonRegistry = hookemonRegistry_;
        hookemonRegistryRuntimeCodeHash = hookemonRegistryRuntimeCodeHash_;
        initialized = true;
        _afterConsumersBound();
        emit ConsumersBoundV1(
            universalKernel_, universalKernelRuntimeCodeHash_, hookemonRegistry_, hookemonRegistryRuntimeCodeHash_
        );
    }

    /// @notice Invalidates every outstanding signature without making any consumer live.
    function killAuthorityV1() external {
        _requireControllerRuntime();
        if (msg.sender != CONTROLLER || killed) revert Unauthorized();
        killed = true;
        authorityGeneration += 1;
        emit AuthorityBindingAdvancedV1(authorityGeneration, keyEpoch, serviceReleaseBindingHash, true);
    }

    /// @notice Recovers a killed endpoint onto a strictly new key/release binding and generation.
    function recoverAuthorityV1(uint64 nextKeyEpoch, bytes32 nextServiceReleaseBindingHash) external {
        _requireControllerRuntime();
        if (msg.sender != CONTROLLER || !killed) revert Unauthorized();
        if (
            nextKeyEpoch < keyEpoch || nextServiceReleaseBindingHash == bytes32(0)
                || (nextKeyEpoch == keyEpoch && nextServiceReleaseBindingHash == serviceReleaseBindingHash)
        ) revert InvalidBinding(4);
        keyEpoch = nextKeyEpoch;
        serviceReleaseBindingHash = nextServiceReleaseBindingHash;
        authorityGeneration += 1;
        killed = false;
        emit AuthorityBindingAdvancedV1(authorityGeneration, nextKeyEpoch, nextServiceReleaseBindingHash, false);
    }

    /// @notice Rotates a live endpoint without reviving any signature from the prior binding.
    function rotateAuthorityBindingV1(uint64 nextKeyEpoch, bytes32 nextServiceReleaseBindingHash) external {
        _requireControllerLive();
        if (
            nextKeyEpoch < keyEpoch || nextServiceReleaseBindingHash == bytes32(0)
                || (nextKeyEpoch == keyEpoch && nextServiceReleaseBindingHash == serviceReleaseBindingHash)
        ) revert InvalidBinding(5);
        keyEpoch = nextKeyEpoch;
        serviceReleaseBindingHash = nextServiceReleaseBindingHash;
        authorityGeneration += 1;
        emit AuthorityBindingAdvancedV1(authorityGeneration, nextKeyEpoch, nextServiceReleaseBindingHash, false);
    }

    function runtimeBindingHashV1() public view returns (bytes32) {
        bytes32 immutableBindingHash = keccak256(
            abi.encode(
                AUTHORITY_IMMUTABLE_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                _roleId(),
                CONTROLLER,
                CONTROLLER_RUNTIME_CODEHASH,
                INITIALIZER
            )
        );
        bytes32 consumerBindingHash = keccak256(
            abi.encode(
                AUTHORITY_CONSUMER_BINDING_TYPEHASH,
                universalKernel,
                universalKernelRuntimeCodeHash,
                hookemonRegistry,
                hookemonRegistryRuntimeCodeHash
            )
        );
        bytes32 controlBindingHash = keccak256(
            abi.encode(
                AUTHORITY_CONTROL_BINDING_TYPEHASH,
                keyEpoch,
                authorityGeneration,
                serviceReleaseBindingHash,
                initialized,
                killed
            )
        );
        return keccak256(
            abi.encode(
                AUTHORITY_RUNTIME_BINDING_TYPEHASH, immutableBindingHash, consumerBindingHash, controlBindingHash
            )
        );
    }

    function controllerDigestV1(bytes32 consumerDigest, uint8 purpose, address consumer) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                AUTHORITY_CONTROLLER_DIGEST_TYPEHASH,
                block.chainid,
                address(this),
                _roleId(),
                purpose,
                consumer,
                consumerDigest,
                keyEpoch,
                authorityGeneration,
                serviceReleaseBindingHash
            )
        );
    }

    function _isControllerSignature(bytes32 consumerDigest, bytes calldata signature, uint8 purpose)
        internal
        view
        returns (bool)
    {
        if (!initialized || killed || signature.length < 2 || uint8(signature[0]) != purpose) return false;
        _requireControllerRuntime();
        return SignatureChecker.isValidSignatureNow(
            CONTROLLER, controllerDigestV1(consumerDigest, purpose, msg.sender), signature[1:]
        );
    }

    function _requireControllerLive() internal view {
        _requireControllerRuntime();
        if (msg.sender != CONTROLLER || !initialized || killed) revert Unauthorized();
        _requireConsumers();
    }

    function _requireControllerBound() internal view {
        _requireControllerRuntime();
        if (msg.sender != CONTROLLER || !initialized) revert Unauthorized();
        _requireConsumers();
    }

    function _requireConsumers() internal view {
        _requireRuntime(universalKernel, universalKernelRuntimeCodeHash);
        _requireRuntime(hookemonRegistry, hookemonRegistryRuntimeCodeHash);
    }

    function _requireControllerRuntime() internal view {
        if (CONTROLLER_RUNTIME_CODEHASH == bytes32(0)) {
            if (CONTROLLER.code.length != 0) revert RuntimeCodeHashDrift(CONTROLLER);
        } else {
            _requireRuntime(CONTROLLER, CONTROLLER_RUNTIME_CODEHASH);
        }
    }

    function _requireRuntime(address account, bytes32 expectedCodeHash) internal view {
        if (
            account == address(0) || expectedCodeHash == bytes32(0) || account.code.length == 0
                || account.codehash != expectedCodeHash
        ) revert RuntimeCodeHashDrift(account);
    }

    function _afterConsumersBound() internal virtual { }

    function _roleId() internal pure virtual returns (bytes32);
}

/// @notice Purpose-separated ERC-1271 reviewer/currentness endpoint plus closed emergency revocation controls.
contract ProgrammableRouterReviewerAuthorityV4 is ProgrammableRouterAuthorityV4Base, IERC1271 {
    bytes32 public constant ROLE_ID = keccak256("PROGRAMMABLE_ROUTER_AUTHORITY_V4_REVIEWER");
    uint8 public constant PURPOSE_UNIVERSAL_GRANT = 1;
    uint8 public constant PURPOSE_UNIVERSAL_CURRENTNESS = 2;
    uint8 public constant PURPOSE_HOOKEMON_GRANT = 3;
    uint8 public constant PURPOSE_HOOKEMON_CURRENTNESS = 4;

    constructor(
        address controller,
        bytes32 controllerRuntimeCodeHash,
        address initializer,
        uint64 initialKeyEpoch,
        bytes32 initialServiceReleaseBindingHash
    )
        ProgrammableRouterAuthorityV4Base(
            controller, controllerRuntimeCodeHash, initializer, initialKeyEpoch, initialServiceReleaseBindingHash
        )
    { }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        if (signature.length < 2) return bytes4(0xffffffff);
        uint8 purpose = uint8(signature[0]);
        bool universal = msg.sender == universalKernel
            && (purpose == PURPOSE_UNIVERSAL_GRANT || purpose == PURPOSE_UNIVERSAL_CURRENTNESS);
        bool hookemon = msg.sender == hookemonRegistry
            && (purpose == PURPOSE_HOOKEMON_GRANT || purpose == PURPOSE_HOOKEMON_CURRENTNESS);
        return (universal || hookemon) && _isControllerSignatureMemory(digest, signature, purpose)
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    function universalRevokeLaunchGrantV1(bytes32 grantDigest) external {
        _requireControllerBound();
        IProgrammableUniversalLaunchKernelV1(universalKernel).revokeLaunchGrantV1(grantDigest);
    }

    function universalRevokeExecutionCurrentnessV1(bytes32 currentnessDigest) external {
        _requireControllerBound();
        IProgrammableUniversalLaunchKernelV1(universalKernel).revokeExecutionCurrentnessV1(currentnessDigest);
    }

    function hookemonSetGlobalKillV1() external {
        _requireControllerBound();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).setGlobalAdoptionKillV1(true);
    }

    function hookemonSetProfileStatusV1(
        bytes32 profileKey,
        IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1 status
    ) external {
        _requireControllerBound();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).setAdoptionProfileStatusV1(profileKey, status);
    }

    function hookemonRevokeLaunchGrantV1(bytes32 grantDigest) external {
        _requireControllerBound();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).revokeLaunchGrantV1(grantDigest);
    }

    function hookemonRevokeExecutionCurrentnessV1(bytes32 currentnessDigest) external {
        _requireControllerBound();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).revokeExecutionCurrentnessV1(currentnessDigest);
    }

    function _isControllerSignatureMemory(bytes32 consumerDigest, bytes memory signature, uint8 purpose)
        private
        view
        returns (bool)
    {
        if (!initialized || killed || signature.length < 2 || uint8(signature[0]) != purpose) return false;
        _requireControllerRuntime();
        bytes memory controllerSignature = new bytes(signature.length - 1);
        for (uint256 i = 1; i < signature.length; ++i) {
            controllerSignature[i - 1] = signature[i];
        }
        return SignatureChecker.isValidSignatureNow(
            CONTROLLER, controllerDigestV1(consumerDigest, purpose, msg.sender), controllerSignature
        );
    }

    function _afterConsumersBound() internal override {
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).setGlobalAdoptionKillV1(true);
    }

    function _roleId() internal pure override returns (bytes32) {
        return ROLE_ID;
    }
}

/// @notice Fixed governance endpoint. Activation order is encoded so a profile can never be registered stale.
contract ProgrammableRouterGovernanceAuthorityV4 is ProgrammableRouterAuthorityV4Base {
    bytes32 public constant ROLE_ID = keccak256("PROGRAMMABLE_ROUTER_AUTHORITY_V4_GOVERNANCE");

    constructor(
        address controller,
        bytes32 controllerRuntimeCodeHash,
        address initializer,
        uint64 initialKeyEpoch,
        bytes32 initialServiceReleaseBindingHash
    )
        ProgrammableRouterAuthorityV4Base(
            controller, controllerRuntimeCodeHash, initializer, initialKeyEpoch, initialServiceReleaseBindingHash
        )
    { }

    function activateUniversalProfileV1(
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 calldata next,
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 calldata descriptor
    ) external {
        _requireControllerLive();
        IProgrammableUniversalLaunchKernelV1 kernel = IProgrammableUniversalLaunchKernelV1(universalKernel);
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory prior = kernel.controlStateV1();
        if (
            !prior.globalKilled || next.globalKilled || next.securityEpoch <= prior.securityEpoch
                || next.policyEpoch <= prior.policyEpoch || next.reviewGeneration <= prior.reviewGeneration
                || descriptor.status != IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active
                || descriptor.securityControlHeadHash != next.securityControlHeadHash
                || descriptor.securityEpoch != next.securityEpoch
                || descriptor.securityEpochHash != next.securityEpochHash || descriptor.policyEpoch != next.policyEpoch
                || descriptor.policyEpochHash != next.policyEpochHash
                || descriptor.reviewGeneration != next.reviewGeneration
                || descriptor.reviewGenerationHash != next.reviewGenerationHash
        ) revert InvalidBinding(10);
        kernel.advanceControlV1(next);
        kernel.registerProfileV1(descriptor);
    }

    function universalSetGlobalKillV1() external {
        _requireControllerBound();
        IProgrammableUniversalLaunchKernelV1(universalKernel).setGlobalKillV1(true);
    }

    function universalAdvanceControlV1(IProgrammableUniversalLaunchKernelV1.ControlStateV1 calldata next) external {
        _requireControllerLive();
        IProgrammableUniversalLaunchKernelV1(universalKernel).advanceControlV1(next);
    }

    function universalSetProfileStatusV1(bytes32 profileKey, IProgrammableUniversalLaunchKernelV1.ProfileStatus status)
        external
    {
        _requireControllerBound();
        IProgrammableUniversalLaunchKernelV1(universalKernel).setProfileStatusV1(profileKey, status);
    }

    function activateHookemonProfileV1(
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability,
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash,
        uint64 reviewGeneration,
        bytes32 reviewGenerationHash
    ) external {
        _requireControllerLive();
        IProgrammableCompletedGraphAdoptionCompatV1 registry =
            IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry);
        registry.advanceSecurityPolicyEpochsV1(
            securityControlHeadHash,
            securityEpoch,
            securityEpochHash,
            policyEpoch,
            policyEpochHash,
            reviewGeneration,
            reviewGenerationHash
        );
        registry.setGlobalAdoptionKillV1(false);
        registry.registerAdoptionProfileV1(capability);
    }

    function hookemonSetGlobalKillV1() external {
        _requireControllerBound();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).setGlobalAdoptionKillV1(true);
    }

    function hookemonAdvanceControlsV1(
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash,
        uint64 reviewGeneration,
        bytes32 reviewGenerationHash
    ) external {
        _requireControllerLive();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry)
            .advanceSecurityPolicyEpochsV1(
                securityControlHeadHash,
                securityEpoch,
                securityEpochHash,
                policyEpoch,
                policyEpochHash,
                reviewGeneration,
                reviewGenerationHash
            );
    }

    function hookemonSetProfileStatusV1(
        bytes32 profileKey,
        IProgrammableCompletedGraphAdoptionCompatV1.ProfileStatusV1 status
    ) external {
        _requireControllerBound();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).setAdoptionProfileStatusV1(profileKey, status);
    }

    function _roleId() internal pure override returns (bytes32) {
        return ROLE_ID;
    }
}

/// @notice Finality role: Universal finality signatures and the fixed Hookemon finality transition.
contract ProgrammableRouterFinalityAuthorityV4 is ProgrammableRouterAuthorityV4Base, IERC1271 {
    bytes32 public constant ROLE_ID = keccak256("PROGRAMMABLE_ROUTER_AUTHORITY_V4_FINALITY");
    uint8 public constant PURPOSE_UNIVERSAL_FINALITY = 5;

    constructor(
        address controller,
        bytes32 controllerRuntimeCodeHash,
        address initializer,
        uint64 initialKeyEpoch,
        bytes32 initialServiceReleaseBindingHash
    )
        ProgrammableRouterAuthorityV4Base(
            controller, controllerRuntimeCodeHash, initializer, initialKeyEpoch, initialServiceReleaseBindingHash
        )
    { }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return msg.sender == universalKernel && _isSinglePurposeSignature(digest, signature, PURPOSE_UNIVERSAL_FINALITY)
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    function hookemonAdvanceFinalityV1(
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 calldata receipt
    ) external {
        _requireControllerLive();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).advanceFinalityIndexingV1(receipt);
    }

    function _isSinglePurposeSignature(bytes32 digest, bytes memory signature, uint8 purpose)
        private
        view
        returns (bool)
    {
        if (!initialized || killed || signature.length < 2 || uint8(signature[0]) != purpose) return false;
        _requireControllerRuntime();
        bytes memory controllerSignature = new bytes(signature.length - 1);
        for (uint256 i = 1; i < signature.length; ++i) {
            controllerSignature[i - 1] = signature[i];
        }
        return SignatureChecker.isValidSignatureNow(
            CONTROLLER, controllerDigestV1(digest, purpose, msg.sender), controllerSignature
        );
    }

    function _roleId() internal pure override returns (bytes32) {
        return ROLE_ID;
    }
}

/// @notice Indexer role: Universal indexing signatures and the fixed Hookemon indexing transition.
contract ProgrammableRouterIndexerAuthorityV4 is ProgrammableRouterAuthorityV4Base, IERC1271 {
    bytes32 public constant ROLE_ID = keccak256("PROGRAMMABLE_ROUTER_AUTHORITY_V4_INDEXER");
    uint8 public constant PURPOSE_UNIVERSAL_INDEXING = 6;

    constructor(
        address controller,
        bytes32 controllerRuntimeCodeHash,
        address initializer,
        uint64 initialKeyEpoch,
        bytes32 initialServiceReleaseBindingHash
    )
        ProgrammableRouterAuthorityV4Base(
            controller, controllerRuntimeCodeHash, initializer, initialKeyEpoch, initialServiceReleaseBindingHash
        )
    { }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return msg.sender == universalKernel && _isSinglePurposeSignature(digest, signature, PURPOSE_UNIVERSAL_INDEXING)
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    function hookemonAdvanceIndexingV1(
        IProgrammableCompletedGraphAdoptionCompatV1.FinalityIndexingReceiptV1 calldata receipt
    ) external {
        _requireControllerLive();
        IProgrammableCompletedGraphAdoptionCompatV1(hookemonRegistry).advanceFinalityIndexingV1(receipt);
    }

    function _isSinglePurposeSignature(bytes32 digest, bytes memory signature, uint8 purpose)
        private
        view
        returns (bool)
    {
        if (!initialized || killed || signature.length < 2 || uint8(signature[0]) != purpose) return false;
        _requireControllerRuntime();
        bytes memory controllerSignature = new bytes(signature.length - 1);
        for (uint256 i = 1; i < signature.length; ++i) {
            controllerSignature[i - 1] = signature[i];
        }
        return SignatureChecker.isValidSignatureNow(
            CONTROLLER, controllerDigestV1(digest, purpose, msg.sender), controllerSignature
        );
    }

    function _roleId() internal pure override returns (bytes32) {
        return ROLE_ID;
    }
}
