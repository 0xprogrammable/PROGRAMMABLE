// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import { IProgrammableLaunchPermitAuthorityV1 } from "./interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { IProgrammableLaunchPermitVerifierV1 } from "./interfaces/IProgrammableLaunchPermitVerifierV1.sol";
import {
    IProgrammablePermitBoundLaunchRegistryV1,
    IProgrammablePermitBoundProfileV1,
    IProgrammablePermitBoundRouteV1
} from "./interfaces/IProgrammablePermitBoundRouteV1.sol";

/// @title ProgrammableLaunchPermitVerifierV1
/// @notice Stateless verifier split from the stateful authority solely to satisfy EIP-170 under normal solc.
contract ProgrammableLaunchPermitVerifierV1 is IProgrammableLaunchPermitVerifierV1 {
    struct GenerationBindingPreimageV1 {
        uint64 githubRepositoryId;
        uint64 approvalGeneration;
        uint64 permitGeneration;
        uint64 notBefore;
        uint64 deadline;
        uint64 signerEpoch;
        uint256 nonce;
        uint256 chainId;
        bytes32 repositoryKey;
        address route;
        bytes32 routeId;
        address applicantWallet;
        bytes32 launchId;
        bytes32 approvalId;
        bytes32 technicalApprovalHash;
        bytes32 descriptorHash;
        bytes32 presentationBindingHash;
        bytes32 configurationHash;
        bytes32 walletOwnershipBindingHash;
        bytes32 executionPlanHash;
        bytes32 executionCoreHash;
        bytes32 executionCalldataKeccak256;
        uint256 executionValue;
        bytes32 releaseBindingHash;
        bytes32 kernelExecutionEnvelopeHash;
    }

    bytes32 public constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant EIP712_NAME_HASH = keccak256("ProgrammableLaunchPermitAuthority");
    bytes32 public constant EIP712_VERSION_HASH = keccak256("1");
    bytes32 public constant LAUNCH_PERMIT_TYPEHASH = keccak256(
        "LaunchPermitV1(uint64 githubRepositoryId,uint64 approvalGeneration,uint64 permitGeneration,uint64 notBefore,uint64 deadline,uint64 signerEpoch,uint256 nonce,uint256 chainId,bytes32 repositoryKey,address route,bytes32 routeId,address applicantWallet,bytes32 launchId,bytes32 approvalId,bytes32 technicalApprovalHash,bytes32 descriptorHash,bytes32 presentationBindingHash,bytes32 configurationHash,bytes32 walletOwnershipBindingHash,bytes32 executionPlanHash,bytes32 executionCoreHash,bytes32 executionCalldataKeccak256,bytes32 generationBindingHash,uint256 executionValue,bytes32 releaseBindingHash,bytes32 kernelExecutionEnvelopeHash)"
    );
    bytes32 public constant GENERATION_BINDING_TYPEHASH = keccak256(
        "GenerationBindingV1(uint64 githubRepositoryId,uint64 approvalGeneration,uint64 permitGeneration,uint64 notBefore,uint64 deadline,uint64 signerEpoch,uint256 nonce,uint256 chainId,bytes32 repositoryKey,address route,bytes32 routeId,address applicantWallet,bytes32 launchId,bytes32 approvalId,bytes32 technicalApprovalHash,bytes32 descriptorHash,bytes32 presentationBindingHash,bytes32 configurationHash,bytes32 walletOwnershipBindingHash,bytes32 executionPlanHash,bytes32 executionCoreHash,bytes32 executionCalldataKeccak256,uint256 executionValue,bytes32 releaseBindingHash,bytes32 kernelExecutionEnvelopeHash)"
    );
    bytes32 public constant RELEASE_BINDING_TYPEHASH = keccak256(
        "ReleaseBindingV1(uint64 authorityGeneration,uint64 releaseGeneration,address permitAuthority,bytes32 permitAuthorityRuntimeCodeHash,address launchRegistry,uint64 launchRegistryGeneration,bytes32 launchRegistryRuntimeCodeHash,bytes32 chainProfileHash,address profile,bytes32 profileId,bytes32 profileRuntimeCodeHash,bytes32 profileBindingHash,address route,bytes32 routeId,bytes32 routeRuntimeCodeHash,bytes32 executionAuthorityHash,uint8 kernelEnvelopeMode)"
    );
    bytes32 public constant KERNEL_EXECUTION_ENVELOPE_TYPEHASH = keccak256(
        "KernelExecutionEnvelopeV1(bytes32 kernelGrantDigest,bytes32 reviewerCurrentnessDigest,bytes32 applicantWalletIntentDigest)"
    );

    error InvalidBinding(bytes32 field);
    error ExecutionCalldataHashMismatch(bytes32 supplied, bytes32 actual);
    error ExecutionCoreHashMismatch(bytes32 supplied, bytes32 actual);
    error ExecutionValueMismatch(uint256 supplied, uint256 actual);
    error GenerationBindingHashMismatch(bytes32 supplied, bytes32 expected);
    error InvalidPermitWindow(uint64 notBefore, uint64 deadline);
    error PermitExpired(uint64 deadline, uint256 currentTimestamp);
    error PermitNotYetValid(uint64 notBefore, uint256 currentTimestamp);
    error RepositoryIdIsZero();
    error RepositoryKeyMismatch(bytes32 supplied, bytes32 expected);
    error RuntimeCodeHashMismatch(address target, bytes32 supplied, bytes32 actual);
    error WrongAuthority(address supplied, address expected);
    error WrongAuthorityGeneration(uint64 supplied, uint64 expected);
    error WrongChain(uint256 supplied, uint256 expected);
    error WrongRoute(address supplied, address expected);

    function domainSeparator(address permitAuthority, uint256 chainId) public pure returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, EIP712_NAME_HASH, EIP712_VERSION_HASH, chainId, permitAuthority)
        );
    }

    function permitDigest(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId
    ) public pure returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(
            domainSeparator(permitAuthority, chainId), keccak256(abi.encode(LAUNCH_PERMIT_TYPEHASH, permit))
        );
    }

    function generationBindingHash(IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit)
        public
        pure
        returns (bytes32)
    {
        GenerationBindingPreimageV1 memory preimage;
        preimage.githubRepositoryId = permit.githubRepositoryId;
        preimage.approvalGeneration = permit.approvalGeneration;
        preimage.permitGeneration = permit.permitGeneration;
        preimage.notBefore = permit.notBefore;
        preimage.deadline = permit.deadline;
        preimage.signerEpoch = permit.signerEpoch;
        preimage.nonce = permit.nonce;
        preimage.chainId = permit.chainId;
        preimage.repositoryKey = permit.repositoryKey;
        preimage.route = permit.route;
        preimage.routeId = permit.routeId;
        preimage.applicantWallet = permit.applicantWallet;
        preimage.launchId = permit.launchId;
        preimage.approvalId = permit.approvalId;
        preimage.technicalApprovalHash = permit.technicalApprovalHash;
        preimage.descriptorHash = permit.descriptorHash;
        preimage.presentationBindingHash = permit.presentationBindingHash;
        preimage.configurationHash = permit.configurationHash;
        preimage.walletOwnershipBindingHash = permit.walletOwnershipBindingHash;
        preimage.executionPlanHash = permit.executionPlanHash;
        preimage.executionCoreHash = permit.executionCoreHash;
        preimage.executionCalldataKeccak256 = permit.executionCalldataKeccak256;
        preimage.executionValue = permit.executionValue;
        preimage.releaseBindingHash = permit.releaseBindingHash;
        preimage.kernelExecutionEnvelopeHash = permit.kernelExecutionEnvelopeHash;
        return sha256(abi.encode(GENERATION_BINDING_TYPEHASH, preimage));
    }

    function releaseBindingHash(IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(RELEASE_BINDING_TYPEHASH, releaseBinding));
    }

    function kernelEnvelopeHash(IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(KERNEL_EXECUTION_ENVELOPE_TYPEHASH, kernelEnvelope));
    }

    function validatePermitStatic(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId,
        uint64 maxPermitLifetime,
        uint256 currentTimestamp
    ) external pure returns (bytes32 repositoryKey, bytes32 digest) {
        (repositoryKey, digest) = _validatePermitIdentity(permit, permitAuthority, chainId);
        if (permit.deadline <= permit.notBefore || permit.deadline - permit.notBefore > maxPermitLifetime) {
            revert InvalidPermitWindow(permit.notBefore, permit.deadline);
        }
        if (currentTimestamp < permit.notBefore) revert PermitNotYetValid(permit.notBefore, currentTimestamp);
        if (currentTimestamp >= permit.deadline) revert PermitExpired(permit.deadline, currentTimestamp);
    }

    function validatePermitIdentity(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId
    ) external pure returns (bytes32 repositoryKey, bytes32 digest) {
        return _validatePermitIdentity(permit, permitAuthority, chainId);
    }

    function validateConsumption(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 calldata actualExecution,
        uint64 authorityGeneration,
        uint64 maxPermitLifetime,
        address consumerRoute
    ) external view returns (bytes32 repositoryKey, bytes32 digest, bytes32 bindingHash) {
        (repositoryKey, digest) = _validatePermitIdentity(permit, msg.sender, block.chainid);
        _validatePermitWindow(permit, maxPermitLifetime, block.timestamp);
        if (consumerRoute != permit.route) revert WrongRoute(consumerRoute, permit.route);
        if (releaseBinding.route != permit.route) revert WrongRoute(releaseBinding.route, permit.route);
        if (releaseBinding.routeId != permit.routeId) revert InvalidBinding(bytes32("route-id"));
        _validateActualExecution(permit, actualExecution);
        bindingHash = _validateReleaseBinding(releaseBinding, msg.sender, authorityGeneration);
        if (permit.releaseBindingHash != bindingHash) revert InvalidBinding(bytes32("release-binding"));
        _validateKernelEnvelope(permit.kernelExecutionEnvelopeHash, releaseBinding, kernelEnvelope);
    }

    function validateCancellation(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope
    ) external view returns (bytes32 repositoryKey, bytes32 digest) {
        (repositoryKey, digest) = _validatePermitIdentity(permit, msg.sender, block.chainid);
        if (permit.releaseBindingHash != releaseBindingHash(releaseBinding)) {
            revert InvalidBinding(bytes32("release-binding"));
        }
        _validateKernelEnvelope(permit.kernelExecutionEnvelopeHash, releaseBinding, kernelEnvelope);
    }

    function _validatePermitIdentity(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId
    ) private pure returns (bytes32 repositoryKey, bytes32 digest) {
        if (permit.chainId != chainId) revert WrongChain(permit.chainId, chainId);
        _requirePermitBindings(permit);
        bytes32 expectedGenerationBindingHash = generationBindingHash(permit);
        if (permit.generationBindingHash != expectedGenerationBindingHash) {
            revert GenerationBindingHashMismatch(permit.generationBindingHash, expectedGenerationBindingHash);
        }
        repositoryKey = _repositoryKey(permit.githubRepositoryId);
        if (permit.repositoryKey != repositoryKey) revert RepositoryKeyMismatch(permit.repositoryKey, repositoryKey);
        digest = permitDigest(permit, permitAuthority, chainId);
    }

    function validateReleaseBinding(
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        address permitAuthority,
        uint64 authorityGeneration
    ) external view returns (bytes32 bindingHash) {
        return _validateReleaseBinding(releaseBinding, permitAuthority, authorityGeneration);
    }

    function _validateReleaseBinding(
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        address permitAuthority,
        uint64 authorityGeneration
    ) private view returns (bytes32 bindingHash) {
        if (releaseBinding.authorityGeneration != authorityGeneration) {
            revert WrongAuthorityGeneration(releaseBinding.authorityGeneration, authorityGeneration);
        }
        if (releaseBinding.releaseGeneration == 0) revert InvalidBinding(bytes32("release-generation"));
        if (releaseBinding.launchRegistryGeneration == 0) {
            revert InvalidBinding(bytes32("launch-registry-generation"));
        }
        if (releaseBinding.chainProfileHash == bytes32(0)) revert InvalidBinding(bytes32("chain-profile"));
        if (releaseBinding.profileId == bytes32(0)) revert InvalidBinding(bytes32("profile-id"));
        if (releaseBinding.profileBindingHash == bytes32(0)) revert InvalidBinding(bytes32("profile-binding"));
        if (releaseBinding.routeId == bytes32(0)) revert InvalidBinding(bytes32("route-id"));
        if (releaseBinding.executionAuthorityHash == bytes32(0)) {
            revert InvalidBinding(bytes32("execution-authority"));
        }
        if (releaseBinding.permitAuthority != permitAuthority) {
            revert WrongAuthority(releaseBinding.permitAuthority, permitAuthority);
        }
        _requireRuntime(permitAuthority, releaseBinding.permitAuthorityRuntimeCodeHash, bytes32("authority-runtime"));
        _requireRuntime(
            releaseBinding.launchRegistry,
            releaseBinding.launchRegistryRuntimeCodeHash,
            bytes32("launch-registry-runtime")
        );
        _requireRuntime(releaseBinding.profile, releaseBinding.profileRuntimeCodeHash, bytes32("profile-runtime"));
        _requireRuntime(releaseBinding.route, releaseBinding.routeRuntimeCodeHash, bytes32("route-runtime"));
        IProgrammablePermitBoundLaunchRegistryV1 launchRegistry =
            IProgrammablePermitBoundLaunchRegistryV1(releaseBinding.launchRegistry);
        if (launchRegistry.LAUNCH_PERMIT_AUTHORITY() != permitAuthority) {
            revert InvalidBinding(bytes32("launch-registry-authority"));
        }
        if (launchRegistry.LAUNCH_ROUTE() != releaseBinding.route) {
            revert InvalidBinding(bytes32("launch-registry-route"));
        }
        if (launchRegistry.REGISTRY_GENERATION() != releaseBinding.launchRegistryGeneration) {
            revert InvalidBinding(bytes32("launch-registry-generation"));
        }
        if (launchRegistry.CHAIN_PROFILE_HASH() != releaseBinding.chainProfileHash) {
            revert InvalidBinding(bytes32("chain-profile"));
        }
        if (!launchRegistry.hasRole(launchRegistry.WRITER_ROLE(), releaseBinding.route)) {
            revert InvalidBinding(bytes32("launch-registry-writer"));
        }
        IProgrammablePermitBoundProfileV1 profile = IProgrammablePermitBoundProfileV1(releaseBinding.profile);
        if (profile.permitProfileId() != releaseBinding.profileId) revert InvalidBinding(bytes32("profile-id"));
        if (profile.permitProfileBindingHash() != releaseBinding.profileBindingHash) {
            revert InvalidBinding(bytes32("profile-binding"));
        }
        IProgrammablePermitBoundRouteV1 route = IProgrammablePermitBoundRouteV1(releaseBinding.route);
        if (route.ROUTE_ID() != releaseBinding.routeId) revert InvalidBinding(bytes32("route-id"));
        if (route.permitProfile() != releaseBinding.profile) revert InvalidBinding(bytes32("profile"));
        if (route.permitProfileId() != releaseBinding.profileId) revert InvalidBinding(bytes32("profile-id"));
        if (route.permitLaunchRegistry() != releaseBinding.launchRegistry) {
            revert InvalidBinding(bytes32("launch-registry"));
        }
        if (route.permitKernelEnvelopeMode() != releaseBinding.kernelEnvelopeMode) {
            revert InvalidBinding(bytes32("kernel-envelope-mode"));
        }
        if (route.permitExecutionAuthorityHash() != releaseBinding.executionAuthorityHash) {
            revert InvalidBinding(bytes32("execution-authority"));
        }
        bindingHash = releaseBindingHash(releaseBinding);
    }

    function validateKernelEnvelope(
        bytes32 expectedKernelEnvelopeHash,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope
    ) external pure {
        _validateKernelEnvelope(expectedKernelEnvelopeHash, releaseBinding, kernelEnvelope);
    }

    function _validateKernelEnvelope(
        bytes32 expectedKernelEnvelopeHash,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope
    ) private pure {
        if (expectedKernelEnvelopeHash != kernelEnvelopeHash(kernelEnvelope)) {
            revert InvalidBinding(bytes32("kernel-envelope"));
        }
        bool allZero = kernelEnvelope.kernelGrantDigest == bytes32(0)
            && kernelEnvelope.reviewerCurrentnessDigest == bytes32(0)
            && kernelEnvelope.applicantWalletIntentDigest == bytes32(0);
        bool allNonZero = kernelEnvelope.kernelGrantDigest != bytes32(0)
            && kernelEnvelope.reviewerCurrentnessDigest != bytes32(0)
            && kernelEnvelope.applicantWalletIntentDigest != bytes32(0);
        if (
            releaseBinding.kernelEnvelopeMode == IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE
                && !allZero
        ) revert InvalidBinding(bytes32("kernel-envelope-mode"));
        if (
            releaseBinding.kernelEnvelopeMode == IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED
                && !allNonZero
        ) revert InvalidBinding(bytes32("kernel-envelope-mode"));
    }

    function validEOASignature(address signer, bytes32 digest, bytes calldata signature) external pure returns (bool) {
        if (signature.length != 65) return false;
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(digest, signature);
        return error == ECDSA.RecoverError.NoError && recovered == signer;
    }

    function _validatePermitWindow(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        uint64 maxPermitLifetime,
        uint256 currentTimestamp
    ) private pure {
        if (permit.deadline <= permit.notBefore || permit.deadline - permit.notBefore > maxPermitLifetime) {
            revert InvalidPermitWindow(permit.notBefore, permit.deadline);
        }
        if (currentTimestamp < permit.notBefore) revert PermitNotYetValid(permit.notBefore, currentTimestamp);
        if (currentTimestamp >= permit.deadline) revert PermitExpired(permit.deadline, currentTimestamp);
    }

    function _validateActualExecution(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 calldata actualExecution
    ) private pure {
        if (actualExecution.applicantWallet != permit.applicantWallet) {
            revert WrongAuthority(actualExecution.applicantWallet, permit.applicantWallet);
        }
        if (actualExecution.executionCoreHash != permit.executionCoreHash) {
            revert ExecutionCoreHashMismatch(permit.executionCoreHash, actualExecution.executionCoreHash);
        }
        if (actualExecution.executionCalldataKeccak256 != permit.executionCalldataKeccak256) {
            revert ExecutionCalldataHashMismatch(
                permit.executionCalldataKeccak256, actualExecution.executionCalldataKeccak256
            );
        }
        if (actualExecution.executionValue != permit.executionValue) {
            revert ExecutionValueMismatch(permit.executionValue, actualExecution.executionValue);
        }
    }

    function _requirePermitBindings(IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit) private pure {
        if (permit.route == address(0)) revert InvalidBinding(bytes32("route"));
        if (permit.routeId == bytes32(0)) revert InvalidBinding(bytes32("route-id"));
        if (permit.applicantWallet == address(0)) revert InvalidBinding(bytes32("applicant-wallet"));
        if (permit.launchId == bytes32(0)) revert InvalidBinding(bytes32("launch-id"));
        if (permit.approvalId == bytes32(0)) revert InvalidBinding(bytes32("approval-id"));
        if (permit.approvalGeneration == 0) revert InvalidBinding(bytes32("approval-generation"));
        if (permit.permitGeneration == 0) revert InvalidBinding(bytes32("permit-generation"));
        if (permit.technicalApprovalHash == bytes32(0)) revert InvalidBinding(bytes32("technical-approval"));
        if (permit.descriptorHash == bytes32(0)) revert InvalidBinding(bytes32("descriptor"));
        if (permit.presentationBindingHash == bytes32(0)) revert InvalidBinding(bytes32("presentation"));
        if (permit.configurationHash == bytes32(0)) revert InvalidBinding(bytes32("configuration"));
        if (permit.walletOwnershipBindingHash == bytes32(0)) revert InvalidBinding(bytes32("wallet-ownership"));
        if (permit.executionPlanHash == bytes32(0)) revert InvalidBinding(bytes32("execution-plan"));
        if (permit.executionCoreHash == bytes32(0)) revert InvalidBinding(bytes32("execution-core"));
        if (permit.executionCalldataKeccak256 == bytes32(0)) {
            revert InvalidBinding(bytes32("execution-calldata"));
        }
        if (permit.generationBindingHash == bytes32(0)) revert InvalidBinding(bytes32("generation-binding"));
        if (permit.releaseBindingHash == bytes32(0)) revert InvalidBinding(bytes32("release-binding"));
        if (permit.kernelExecutionEnvelopeHash == bytes32(0)) revert InvalidBinding(bytes32("kernel-envelope"));
    }

    function _repositoryKey(uint64 githubRepositoryId) private pure returns (bytes32) {
        if (githubRepositoryId == 0) revert RepositoryIdIsZero();
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }

    function _requireRuntime(address target, bytes32 expected, bytes32 field) private view {
        if (target == address(0) || target.code.length == 0 || expected == bytes32(0)) {
            revert InvalidBinding(field);
        }
        bytes32 actual = target.codehash;
        if (actual != expected) revert RuntimeCodeHashMismatch(target, expected, actual);
    }
}
