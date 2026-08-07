// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCustomRegistryV1 } from "./interfaces/IProgrammableCustomRegistryV1.sol";

/// @notice Deterministic, provider-neutral Generation 2 fee-policy validation.
/// @dev Provider identity is authorized separately by the exact partner-factory registry.
library ProgrammableCustomFeePolicyVerifierLibV2 {
    address internal constant PROGRAMMABLE_FEE_RECIPIENT = 0x4957f49620AFf3Adbbe8195a4f633E49cc93376c;
    bytes32 internal constant PARTNER_STATUS_ACTIVE_ID = keccak256("programmable.partner-status.active.v1");
    bytes32 internal constant FEE_POLICY_DOMAIN = keccak256("programmable.custom-fee-policy.v2");

    bytes32 private constant REASON_COMMON_EVIDENCE = keccak256("fee-policy.common-evidence");
    bytes32 private constant REASON_INACTIVE = keccak256("fee-policy.inactive");
    bytes32 private constant REASON_SHARE_SUM = keccak256("fee-policy.share-sum");
    bytes32 private constant REASON_PROGRAMMABLE_RECIPIENT = keccak256("fee-policy.programmable-recipient");
    bytes32 private constant REASON_ACTIVE_LEG = keccak256("fee-policy.active-leg");
    bytes32 private constant REASON_NATIVE = keccak256("fee-policy.native");
    bytes32 private constant REASON_NO_QUALIFYING_MARKET = keccak256("fee-policy.no-qualifying-market");
    bytes32 private constant REASON_PARTNER = keccak256("fee-policy.partner");
    bytes32 private constant REASON_SHARED_BASIS = keccak256("fee-policy.shared-basis");
    bytes32 private constant REASON_CLAIM_ISOLATION = keccak256("fee-policy.claim-isolation");
    bytes32 private constant REASON_TEMPLATE_PAIR = keccak256("fee-policy.template-pair");
    bytes32 private constant REASON_MODEL_PAIR = keccak256("fee-policy.model-pair");
    bytes32 private constant REASON_MARKET_PATH = keccak256("fee-policy.market-path");

    error InvalidFeePolicy(bytes32 reasonCode);

    function validateAndHash(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy)
        internal
        pure
        returns (bytes32)
    {
        _validate(policy);
        return _hash(policy);
    }

    function _validate(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy) private pure {
        if (
            policy.publicPolicyBindingHash == bytes32(0) || policy.verificationEvidenceHash == bytes32(0)
                || policy.accountingSafetyEvidenceHash == bytes32(0) || policy.claimIsolationEvidenceHash == bytes32(0)
        ) revert InvalidFeePolicy(REASON_COMMON_EVIDENCE);
        if (policy.paused || policy.retired) revert InvalidFeePolicy(REASON_INACTIVE);
        if (policy.kind == IProgrammableCustomRegistryV1.FeePolicyKind.NoQualifyingMarket) {
            _validateNoQualifyingMarket(policy);
            return;
        }
        if (uint256(policy.partner.shareBps) + policy.programmable.shareBps != policy.totalFeeBps) {
            revert InvalidFeePolicy(REASON_SHARE_SUM);
        }
        if (policy.programmable.recipient != PROGRAMMABLE_FEE_RECIPIENT) {
            revert InvalidFeePolicy(REASON_PROGRAMMABLE_RECIPIENT);
        }
        _validateActiveLeg(policy.programmable);
        if ((policy.templateId == bytes32(0)) != (policy.templateVersion == bytes32(0))) {
            revert InvalidFeePolicy(REASON_TEMPLATE_PAIR);
        }
        if ((policy.modelId == bytes32(0)) != (policy.modelVersion == bytes32(0))) {
            revert InvalidFeePolicy(REASON_MODEL_PAIR);
        }
        if (policy.modelId == bytes32(0) || policy.templateId == bytes32(0) || policy.marketPathId == bytes32(0)) {
            revert InvalidFeePolicy(REASON_MARKET_PATH);
        }
        if (policy.kind == IProgrammableCustomRegistryV1.FeePolicyKind.NativeCustom) {
            _validateNative(policy);
        } else {
            _validatePartner(policy);
        }
    }

    function _validateNoQualifyingMarket(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy) private pure {
        if (
            policy.providerId != bytes32(0) || policy.partnerStatusId != bytes32(0) || policy.modelId != bytes32(0)
                || policy.modelVersion != bytes32(0) || policy.templateId != bytes32(0)
                || policy.templateVersion != bytes32(0) || policy.marketPathId != bytes32(0)
                || policy.partnerRepositoryId != bytes32(0) || policy.partnerCommitId != bytes32(0)
                || policy.partnerRuntimeCodeSetHash != bytes32(0) || policy.totalFeeBps != 0
                || policy.nativeCustomFeeBps != 0 || !_isZeroLeg(policy.partner) || !_isZeroLeg(policy.programmable)
                || policy.activationVersion != bytes32(0) || policy.activationBlock != 0
        ) revert InvalidFeePolicy(REASON_NO_QUALIFYING_MARKET);
    }

    function _validateNative(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy) private pure {
        if (
            policy.providerId != bytes32(0) || policy.partnerStatusId != bytes32(0)
                || policy.partnerRepositoryId != bytes32(0) || policy.partnerCommitId != bytes32(0)
                || policy.partnerRuntimeCodeSetHash != bytes32(0) || policy.totalFeeBps != 10
                || policy.nativeCustomFeeBps != 10 || policy.programmable.shareBps != 10
                || policy.activationVersion != bytes32(0) || policy.activationBlock != 0 || !_isZeroLeg(policy.partner)
        ) revert InvalidFeePolicy(REASON_NATIVE);
    }

    function _validatePartner(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy) private pure {
        if (
            policy.providerId == bytes32(0) || policy.partnerStatusId != PARTNER_STATUS_ACTIVE_ID
                || policy.templateId == bytes32(0) || policy.templateVersion == bytes32(0)
                || policy.partnerRepositoryId == bytes32(0) || policy.partnerCommitId == bytes32(0)
                || policy.partnerRuntimeCodeSetHash == bytes32(0) || policy.totalFeeBps != 20
                || policy.nativeCustomFeeBps != 0 || policy.partner.shareBps != 15 || policy.programmable.shareBps != 5
                || policy.activationVersion == bytes32(0) || policy.activationBlock == 0
        ) revert InvalidFeePolicy(REASON_PARTNER);
        _validateActiveLeg(policy.partner);
        if (
            policy.partner.recipient == policy.programmable.recipient
                || policy.partner.currency != policy.programmable.currency
                || policy.partner.chargeModeId != policy.programmable.chargeModeId
                || policy.partner.basisId != policy.programmable.basisId
                || policy.partner.roundingId != policy.programmable.roundingId
        ) revert InvalidFeePolicy(REASON_SHARED_BASIS);
        if (policy.partner.claimRightId == policy.programmable.claimRightId) {
            revert InvalidFeePolicy(REASON_CLAIM_ISOLATION);
        }
    }

    function _validateActiveLeg(IProgrammableCustomRegistryV1.FeeLegV1 calldata leg) private pure {
        if (
            leg.shareBps == 0 || leg.recipient == address(0) || leg.chargeModeId == bytes32(0)
                || leg.basisId == bytes32(0) || leg.roundingId == bytes32(0) || leg.accrualId == bytes32(0)
                || leg.claimId == bytes32(0) || leg.claimRightId == bytes32(0) || leg.controlEvidenceHash == bytes32(0)
        ) revert InvalidFeePolicy(REASON_ACTIVE_LEG);
    }

    function _isZeroLeg(IProgrammableCustomRegistryV1.FeeLegV1 calldata leg) private pure returns (bool) {
        return leg.shareBps == 0 && leg.recipient == address(0) && leg.currency == address(0)
            && leg.chargeModeId == bytes32(0) && leg.basisId == bytes32(0) && leg.roundingId == bytes32(0)
            && leg.accrualId == bytes32(0) && leg.claimId == bytes32(0) && leg.claimRightId == bytes32(0)
            && leg.controlEvidenceHash == bytes32(0);
    }

    function _hash(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy) private pure returns (bytes32) {
        bytes32 attributionHash = keccak256(
            abi.encode(
                policy.kind,
                policy.providerId,
                policy.partnerStatusId,
                policy.modelId,
                policy.modelVersion,
                policy.templateId,
                policy.templateVersion,
                policy.marketPathId,
                policy.partnerRepositoryId,
                policy.partnerCommitId,
                policy.partnerRuntimeCodeSetHash
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                policy.totalFeeBps, policy.nativeCustomFeeBps, _legHash(policy.partner), _legHash(policy.programmable)
            )
        );
        bytes32 lifecycleAndEvidenceHash = keccak256(
            abi.encode(
                policy.activationVersion,
                policy.activationBlock,
                policy.paused,
                policy.retired,
                policy.publicPolicyBindingHash,
                policy.claimIsolationEvidenceHash,
                policy.accountingSafetyEvidenceHash,
                policy.verificationEvidenceHash
            )
        );
        return keccak256(abi.encode(FEE_POLICY_DOMAIN, attributionHash, economicsHash, lifecycleAndEvidenceHash));
    }

    function _legHash(IProgrammableCustomRegistryV1.FeeLegV1 calldata leg) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                leg.shareBps,
                leg.recipient,
                leg.currency,
                leg.chargeModeId,
                leg.basisId,
                leg.roundingId,
                leg.accrualId,
                leg.claimId,
                leg.claimRightId,
                leg.controlEvidenceHash
            )
        );
    }
}

/// @title ProgrammableCustomFeePolicyVerifierV2
/// @notice Public verifier for native and provider-neutral Generation 2 partner policies.
contract ProgrammableCustomFeePolicyVerifierV2 {
    address public constant PROGRAMMABLE_FEE_RECIPIENT =
        ProgrammableCustomFeePolicyVerifierLibV2.PROGRAMMABLE_FEE_RECIPIENT;
    bytes32 public constant PARTNER_STATUS_ACTIVE_ID =
        ProgrammableCustomFeePolicyVerifierLibV2.PARTNER_STATUS_ACTIVE_ID;

    function verify(IProgrammableCustomRegistryV1.FeePolicyV1 calldata policy) external pure returns (bytes32) {
        return ProgrammableCustomFeePolicyVerifierLibV2.validateAndHash(policy);
    }
}
