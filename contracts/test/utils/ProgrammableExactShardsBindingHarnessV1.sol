// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProgrammableExactShardsFeePolicyVerifierV2 } from "../../src/ProgrammableExactShardsFeePolicyVerifierV2.sol";
import { ProgrammableExactShardsRegistryV1 } from "../../src/ProgrammableExactShardsRegistryV1.sol";
import {
    IProgrammableExactShardsFeePolicyVerifierV1
} from "../../src/interfaces/IProgrammableExactShardsFeePolicyVerifierV1.sol";
import { IProgrammableExactShardsRegistryV1 } from "../../src/interfaces/IProgrammableExactShardsRegistryV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "../../src/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";

/// @dev Test-only independent reproduction of the offchain binding algorithm. It is never a deployment artifact.
contract ProgrammableExactShardsBindingHarnessV1 {
    ProgrammableExactShardsRegistryV1 public immutable REGISTRY;
    ProgrammableExactShardsFeePolicyVerifierV2 public immutable VERIFIER;
    IProgrammableLaunchPermitAuthorityV1 public immutable PERMIT_AUTHORITY;

    bytes32 private constant APPROVAL_DOMAIN = keccak256("programmable.exact-shards-approval-binding.v1");
    bytes32 private constant REVIEW_DEPLOYMENT_DOMAIN =
        keccak256("programmable.exact-shards-review-deployment-binding.v1");
    bytes32 private constant IDENTITY_DOMAIN = keccak256("programmable.exact-shards-launch-identity.v1");
    bytes32 private constant RECORD_DOMAIN = keccak256("programmable.exact-shards-registered-record.v1");
    bytes32 private constant METADATA_DOMAIN = keccak256("programmable.exact-shards-launch-metadata-binding.v1");
    bytes32 private constant FEE_RECORD_DOMAIN = keccak256("programmable.exact-shards-fee-policy-record.v1");
    bytes32 private constant PROJECT_ID_DOMAIN = keccak256("programmable.project-id.v1");
    bytes32 private constant APPROVAL_ID_DOMAIN = keccak256("programmable.target-approval-id.v1");
    bytes32 private constant LAUNCH_ID_DOMAIN = keccak256("programmable.target-launch-id.v1");
    bytes32 private constant EXPECTED_ROUTE_ID = keccak256("programmable.exact-shards.atomic-launch-route.v1");
    bytes32 private constant LEG_TYPEHASH = keccak256(
        "ProgrammableRevenueLegV1(bytes32 roleHash,uint16 feeBps,address recipient,bytes32 recipientModeHash)"
    );
    bytes32 private constant STORED_CLAIM_TYPEHASH = keccak256(
        "ProgrammableExactShardsStoredFeeClaimV1(uint8 ordinal,bytes32 roleHash,uint16 grossVolumeFeeBps,uint16 shareOfFeeBps,address initialRecipientOrAccumulator,bytes32 recipientModeHash,bytes4 claimSelector,bytes4 handoffSelector,bytes32 legHash)"
    );

    constructor(
        ProgrammableExactShardsRegistryV1 registry,
        ProgrammableExactShardsFeePolicyVerifierV2 verifier,
        IProgrammableLaunchPermitAuthorityV1 permitAuthority
    ) {
        REGISTRY = registry;
        VERIFIER = verifier;
        PERMIT_AUTHORITY = permitAuthority;
    }

    function computeBindings(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        external
        view
        returns (
            bytes32 approvalBindingHash,
            bytes32 launchIntentBindingHash,
            bytes32 reviewDeploymentBindingHash,
            bytes32 registeredRecordCommitment
        )
    {
        bytes32 feePolicyRecordHash = _feePolicyRecordHash(registration);
        approvalBindingHash = _approvalBindingHash(registration);
        reviewDeploymentBindingHash = _reviewDeploymentBindingHash(registration, feePolicyRecordHash);
        registeredRecordCommitment = _registeredRecordCommitment(registration, feePolicyRecordHash);
        launchIntentBindingHash =
            keccak256(abi.encode(IDENTITY_DOMAIN, REGISTRY.REGISTRY_INSTANCE_HASH(), registeredRecordCommitment));
    }

    function computeProjectId(uint64 githubRepositoryId) external view returns (bytes32 projectId) {
        projectId = keccak256(abi.encode(PROJECT_ID_DOMAIN, PERMIT_AUTHORITY.computeRepositoryKey(githubRepositoryId)));
    }

    function computeCanonicalTargetIds(bytes32 projectId, uint64 approvalGeneration, bytes32 technicalApprovalHash)
        external
        view
        returns (bytes32 approvalId, bytes32 launchId)
    {
        approvalId = keccak256(
            abi.encode(
                APPROVAL_ID_DOMAIN,
                projectId,
                approvalGeneration,
                technicalApprovalHash,
                block.chainid,
                address(REGISTRY),
                REGISTRY.REGISTRY_GENERATION(),
                EXPECTED_ROUTE_ID
            )
        );
        launchId = keccak256(abi.encode(LAUNCH_ID_DOMAIN, projectId, approvalId));
    }

    function _feePolicyRecordHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (bytes32)
    {
        bytes32 policyHash = VERIFIER.verify(registration.feePolicy, registration.orderedFeeLegs);
        bytes32 builder = _storedClaimHash(0, registration.orderedFeeLegs[0]);
        bytes32 programmable = _storedClaimHash(1, registration.orderedFeeLegs[1]);
        bytes32 holder = _storedClaimHash(2, registration.orderedFeeLegs[2]);
        return keccak256(
            abi.encode(
                FEE_RECORD_DOMAIN,
                REGISTRY.REGISTRY_INSTANCE_HASH(),
                address(VERIFIER),
                address(VERIFIER).codehash,
                VERIFIER.feePolicyBindingHashV2(),
                policyHash,
                keccak256(abi.encode(builder, programmable, holder))
            )
        );
    }

    function _approvalBindingHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (bytes32)
    {
        bytes32 reviewedSourceHash = keccak256(
            abi.encode(
                registration.githubRepositoryId,
                PERMIT_AUTHORITY.computeRepositoryKey(registration.githubRepositoryId),
                registration.commitId,
                registration.sourceCommitment,
                registration.buildCommitment
            )
        );
        bytes32 reviewedModelHash = keccak256(
            abi.encode(
                registration.modelId,
                registration.modelVersion,
                registration.templateId,
                registration.templateVersion,
                registration.providerId,
                registration.permissionsHash,
                registration.marketPathId,
                registration.capabilitySetHash
            )
        );
        bytes32 reviewedSecurityAndEconomicsHash = keccak256(
            abi.encode(
                registration.reviewPolicyHash,
                registration.securityReviewHash,
                registration.reviewResultId,
                VERIFIER.economicTemplateHashV1(),
                registration.configurationHash,
                registration.finalityPolicyHash
            )
        );
        return keccak256(
            abi.encode(
                APPROVAL_DOMAIN,
                registration.projectId,
                registration.approvalGeneration,
                reviewedSourceHash,
                reviewedModelHash,
                reviewedSecurityAndEconomicsHash
            )
        );
    }

    function _reviewDeploymentBindingHash(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration,
        bytes32 feePolicyRecordHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                REVIEW_DEPLOYMENT_DOMAIN,
                REGISTRY.REGISTRY_INSTANCE_HASH(),
                registration.approvalBindingHash,
                registration.deploymentId,
                registration.deploymentSetHash,
                registration.runtimeCodeSetHash,
                registration.primaryContract,
                registration.primaryRuntimeCodeHash,
                registration.deploymentConfigurationHash,
                registration.configurationHash,
                registration.permissionsHash,
                feePolicyRecordHash
            )
        );
    }

    function _registeredRecordCommitment(
        IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration,
        bytes32 feePolicyRecordHash
    ) private view returns (bytes32) {
        return keccak256(
            abi.encode(
                RECORD_DOMAIN,
                REGISTRY.REGISTRY_INSTANCE_HASH(),
                _scopeAndApprovalHash(registration),
                _sourceAndDeploymentHash(registration),
                _attributionHash(registration),
                _reviewHash(registration),
                keccak256(
                    abi.encode(
                        METADATA_DOMAIN,
                        registration.tokenNameHash,
                        registration.tokenSymbolHash,
                        registration.presentationBindingHash
                    )
                ),
                feePolicyRecordHash,
                registration.finalityPolicyHash
            )
        );
    }

    function _storedClaimHash(
        uint8 ordinal,
        IProgrammableExactShardsFeePolicyVerifierV1.ProgrammableRevenueLegV1 memory leg
    ) private pure returns (bytes32) {
        uint16 shareOfFeeBps = ordinal == 0 ? 1000 : ordinal == 1 ? 1000 : 8000;
        bytes4 claimSelector =
            ordinal == 0 ? bytes4(0x69f9a5f0) : ordinal == 1 ? bytes4(0x64d46b85) : bytes4(0x6ba4c138);
        bytes4 handoffSelector = ordinal == 0 ? bytes4(0x4ce11d21) : bytes4(0);
        bytes32 legHash =
            keccak256(abi.encode(LEG_TYPEHASH, leg.roleHash, leg.feeBps, leg.recipient, leg.recipientModeHash));
        return keccak256(
            abi.encode(
                STORED_CLAIM_TYPEHASH,
                ordinal,
                leg.roleHash,
                leg.feeBps,
                shareOfFeeBps,
                leg.recipient,
                leg.recipientModeHash,
                claimSelector,
                handoffSelector,
                legHash
            )
        );
    }

    function _sourceAndDeploymentHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        view
        returns (bytes32)
    {
        bytes32[15] memory words;
        words[0] = bytes32(uint256(registration.githubRepositoryId));
        words[1] = PERMIT_AUTHORITY.computeRepositoryKey(registration.githubRepositoryId);
        words[2] = registration.commitId;
        words[3] = registration.sourceCommitment;
        words[4] = registration.buildCommitment;
        words[5] = registration.artifactSetHash;
        words[6] = registration.deploymentConfigurationHash;
        words[7] = registration.configurationHash;
        words[8] = registration.permissionsHash;
        words[9] = registration.deploymentId;
        words[10] = registration.deploymentSetHash;
        words[11] = registration.runtimeCodeSetHash;
        words[12] = bytes32(uint256(uint160(registration.primaryContract)));
        words[13] = registration.primaryRuntimeCodeHash;
        words[14] = bytes32(uint256(uint160(registration.launchWallet)));
        return keccak256(abi.encode(words));
    }

    function _attributionHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        pure
        returns (bytes32)
    {
        bytes32[11] memory words;
        words[0] = registration.modelId;
        words[1] = registration.modelVersion;
        words[2] = registration.templateId;
        words[3] = registration.templateVersion;
        words[4] = registration.providerId;
        words[5] = registration.builderAttributionHash;
        words[6] = registration.originHash;
        words[7] = registration.assetSetHash;
        words[8] = registration.marketSetHash;
        words[9] = registration.marketPathId;
        words[10] = registration.capabilitySetHash;
        return keccak256(abi.encode(words));
    }

    function _reviewHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                registration.reviewPolicyHash,
                registration.securityReviewHash,
                registration.reviewResultId,
                registration.reviewDeploymentBindingHash
            )
        );
    }

    function _scopeAndApprovalHash(IProgrammableExactShardsRegistryV1.LaunchRegistrationV1 memory registration)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                registration.chainId,
                registration.registryGeneration,
                registration.launchId,
                registration.projectId,
                registration.websiteProjectIdSha256,
                registration.websiteLaunchIdSha256,
                registration.approvalId,
                registration.approvalGeneration,
                registration.approvalBindingHash
            )
        );
    }
}
