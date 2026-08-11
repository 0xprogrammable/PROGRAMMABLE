// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableUniversalLaunchKernelV1 } from "./IProgrammableUniversalLaunchKernelV1.sol";
import { IProgrammableUniversalLaunchPreflightV1 } from "./IProgrammableUniversalLaunchPreflightV1.sol";

/// @notice Side-effect-free typed readiness/currentness readback for the universal launch kernel.
/// @dev Provider quorum and simulation evidence remain reviewer-authenticated offchain commitments. This contract
///      recomputes only state that is synchronously observable on the execution chain.
contract ProgrammableUniversalLaunchPreflightV1 is IProgrammableUniversalLaunchPreflightV1 {
    uint16 private constant MASK_KERNEL = 1 << 0;
    uint16 private constant MASK_PROFILE = 1 << 1;
    uint16 private constant MASK_CONTROL_GRANT = 1 << 2;
    uint16 private constant MASK_WINNER = 1 << 3;
    uint16 private constant MASK_RESERVATIONS = 1 << 4;
    uint16 private constant MASK_RECEIPT = 1 << 5;
    uint16 private constant REQUIRED_ATOMIC_MASK =
        MASK_KERNEL | MASK_PROFILE | MASK_CONTROL_GRANT | MASK_WINNER | MASK_RESERVATIONS | MASK_RECEIPT;

    bytes32 private constant RUNTIME_HEAD_TYPEHASH = keccak256(
        "PreflightRuntimeHeadV1(uint256 chainId,address kernel,bytes32 kernelRuntimeCodeHash,bytes32 profileKey,uint8 profileStatus,address profileModule,bytes32 expectedProfileModuleRuntimeCodeHash,bytes32 actualProfileModuleRuntimeCodeHash)"
    );
    bytes32 private constant CONTROL_HEAD_TYPEHASH = keccak256(
        "PreflightControlHeadV1(bytes32 securityControlHeadHash,uint64 securityEpoch,bytes32 securityEpochHash,uint64 policyEpoch,bytes32 policyEpochHash,uint64 reviewGeneration,bytes32 reviewGenerationHash,bool globalKilled)"
    );
    bytes32 private constant LIFECYCLE_HEAD_TYPEHASH = keccak256(
        "PreflightLifecycleHeadV1(uint8 grantStatus,bytes32 grantHash,bytes32 winnerKeyHash,bytes32 grantStateHeadHash,bytes32 winnerNonceOccupant,bytes32 winnerKeyOccupant,bytes32 activeExecutionGrantDigest,uint8 receiptStatus,bytes32 receiptCoreHash,bytes32 finalityIndexingReceiptHash)"
    );
    bytes32 private constant RESERVATION_STATE_LEAF_TYPEHASH = keccak256(
        "PreflightReservationStateLeafV1(bytes32 reservationKey,uint8 scope,bytes32 exclusiveGrantDigest,bytes32 storedSharedIdentityHash,bytes32 expectedSharedIdentityHash,bytes32 expectedRuntimeCodeHash,bytes32 actualRuntimeCodeHash,bytes32 expectedManagerRuntimeCodeHash,bytes32 actualManagerRuntimeCodeHash)"
    );
    bytes32 private constant PREFLIGHT_READBACK_TYPEHASH = keccak256(
        "UniversalLaunchPreflightReadbackV1(bytes32 runtimeHeadHash,bytes32 controlHeadHash,bytes32 lifecycleHeadHash,bytes32 reservationSetHash,bytes32 reservationStateHash)"
    );

    error AtomicPreflightUnavailable(uint16 readinessMask);

    function readbackV1(
        address kernel,
        bytes32 expectedKernelRuntimeCodeHash,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations,
        bytes32 candidateCurrentnessDigest
    ) external view returns (PreflightReadbackV1 memory readback) {
        return _readback(kernel, expectedKernelRuntimeCodeHash, grantDigest, reservations, candidateCurrentnessDigest);
    }

    function atomicPreflightHashV1(
        address kernel,
        bytes32 expectedKernelRuntimeCodeHash,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations
    ) external view returns (bytes32 readbackHash) {
        PreflightReadbackV1 memory readback =
            _readback(kernel, expectedKernelRuntimeCodeHash, grantDigest, reservations, bytes32(0));
        if (readback.readinessMask != REQUIRED_ATOMIC_MASK) revert AtomicPreflightUnavailable(readback.readinessMask);
        return readback.readbackHash;
    }

    function _readback(
        address kernelAddress,
        bytes32 expectedKernelRuntimeCodeHash,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations,
        bytes32 candidateCurrentnessDigest
    ) private view returns (PreflightReadbackV1 memory readback) {
        IProgrammableUniversalLaunchKernelV1 kernel = IProgrammableUniversalLaunchKernelV1(kernelAddress);
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = kernel.launchGrantV1(grantDigest);
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory profile =
            kernel.profileDescriptorV1(grant.profileKey);
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control = kernel.controlStateV1();
        IProgrammableUniversalLaunchKernelV1.LaunchGrantStateHeadV1 memory grantHead =
            kernel.launchGrantStateHeadV1(grantDigest);
        IProgrammableUniversalLaunchKernelV1.CanonicalLaunchReceiptV1 memory receipt =
            kernel.canonicalLaunchReceiptV1(grantDigest);

        readback.chainId = block.chainid;
        readback.kernel = kernelAddress;
        readback.kernelRuntimeCodeHash = kernelAddress.codehash;
        readback.profileKey = grant.profileKey;
        readback.profileStatus = profile.status;
        readback.profileModule = profile.module;
        readback.expectedProfileModuleRuntimeCodeHash = profile.moduleRuntimeCodeHash;
        readback.actualProfileModuleRuntimeCodeHash = profile.module.codehash;
        readback.control = control;
        readback.grantStateHead = grantHead;
        readback.winnerNonceOccupant = kernel.winnerByNonceV1(grant.antiReplayNonce);
        readback.winnerKeyOccupant = kernel.winnerByKeyV1(grantHead.winnerKeyHash);
        readback.activeExecutionGrantDigest = kernel.activeExecutionGrantDigestV1();
        readback.reservationSetHash = kernel.computeReservationSetHashV1(reservations);
        readback.receiptStatus = receipt.status;
        readback.receiptCoreHash = receipt.receiptCoreHash;
        readback.finalityIndexingReceiptHash = receipt.finalityIndexingReceiptHash;
        if (candidateCurrentnessDigest != bytes32(0)) {
            (readback.candidateCurrentnessUsed, readback.candidateCurrentnessRevoked) =
                kernel.currentnessStatusV1(candidateCurrentnessDigest);
        }

        if (
            kernelAddress.code.length != 0 && kernelAddress.codehash == expectedKernelRuntimeCodeHash
                && expectedKernelRuntimeCodeHash != bytes32(0)
        ) readback.readinessMask |= MASK_KERNEL;
        if (
            profile.status == IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active
                && profile.module.code.length != 0 && profile.module.codehash == profile.moduleRuntimeCodeHash
        ) readback.readinessMask |= MASK_PROFILE;
        if (_controlAndGrantCurrent(profile, grant, grantHead, control)) readback.readinessMask |= MASK_CONTROL_GRANT;
        if (
            readback.winnerNonceOccupant == grantDigest && readback.winnerKeyOccupant == grantDigest
                && readback.activeExecutionGrantDigest == bytes32(0)
                && grantHead.winnerKeyHash == kernel.computeWinnerKeyHashV1(grant)
        ) readback.readinessMask |= MASK_WINNER;

        bool reservationsReady;
        (readback.reservationStateHash, reservationsReady) = _reservationState(kernel, grantDigest, reservations);
        if (reservationsReady) readback.readinessMask |= MASK_RESERVATIONS;
        if (
            receipt.status == IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Prepared
                && receipt.grantDigest == grantDigest && receipt.stampLaunchId == grant.stampLaunchId
                && receipt.receiptCoreHash != bytes32(0) && receipt.finalityIndexingReceiptHash == bytes32(0)
        ) readback.readinessMask |= MASK_RECEIPT;

        bytes32 runtimeHeadHash = _hashRuntime(readback);
        bytes32 controlHeadHash = _hashControl(control);
        bytes32 lifecycleHeadHash = _hashLifecycle(readback);
        readback.readbackHash = keccak256(
            abi.encode(
                PREFLIGHT_READBACK_TYPEHASH,
                runtimeHeadHash,
                controlHeadHash,
                lifecycleHeadHash,
                readback.reservationSetHash,
                readback.reservationStateHash
            )
        );
    }

    function _controlAndGrantCurrent(
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory profile,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantStateHeadV1 memory head,
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control
    ) private pure returns (bool) {
        return !control.globalKilled && head.status == IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Active
            && grant.profileKey == profile.profileKey && grant.sourceLaunchId != bytes32(0)
            && grant.stampLaunchId != bytes32(0) && grant.antiReplayNonce != bytes32(0)
            && grant.sourceLaunchId != grant.stampLaunchId && grant.sourceLaunchId != grant.antiReplayNonce
            && grant.stampLaunchId != grant.antiReplayNonce
            && profile.securityControlHeadHash == control.securityControlHeadHash
            && grant.securityControlHeadHash == control.securityControlHeadHash
            && profile.securityEpoch == control.securityEpoch && grant.securityEpoch == control.securityEpoch
            && profile.securityEpochHash == control.securityEpochHash
            && grant.securityEpochHash == control.securityEpochHash && profile.policyEpoch == control.policyEpoch
            && grant.policyEpoch == control.policyEpoch && profile.policyEpochHash == control.policyEpochHash
            && grant.policyEpochHash == control.policyEpochHash && profile.reviewGeneration == control.reviewGeneration
            && grant.reviewGeneration == control.reviewGeneration
            && profile.reviewGenerationHash == control.reviewGenerationHash
            && grant.reviewGenerationHash == control.reviewGenerationHash;
    }

    function _reservationState(
        IProgrammableUniversalLaunchKernelV1 kernel,
        bytes32,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations
    ) private view returns (bytes32 stateHash, bool allReady) {
        allReady = reservations.length != 0;
        for (uint256 i; i < reservations.length; ++i) {
            IProgrammableUniversalLaunchKernelV1.ReservationV1 calldata reservation = reservations[i];
            (bytes32 key, bytes32 exclusiveOccupant, bytes32 sharedIdentity) =
                kernel.reservationOccupantsV1(reservation);
            bytes32 actualRuntimeCodeHash;
            bytes32 actualManagerRuntimeCodeHash;
            bool runtimeReady;
            if (reservation.kind == IProgrammableUniversalLaunchKernelV1.ReservationKind.Pool) {
                actualManagerRuntimeCodeHash = reservation.manager.codehash;
                runtimeReady = reservation.manager.code.length != 0
                    && actualManagerRuntimeCodeHash == reservation.expectedManagerRuntimeCodeHash;
            } else {
                actualRuntimeCodeHash = reservation.account.codehash;
                if (reservation.scope == IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive) {
                    runtimeReady = reservation.account.code.length == 0;
                } else {
                    runtimeReady = reservation.account.code.length != 0
                        && actualRuntimeCodeHash == reservation.expectedRuntimeCodeHash;
                }
            }
            bool occupantReady;
            if (reservation.scope == IProgrammableUniversalLaunchKernelV1.ReservationScope.Exclusive) {
                occupantReady = exclusiveOccupant == bytes32(0) && sharedIdentity == bytes32(0);
            } else {
                occupantReady = exclusiveOccupant == bytes32(0)
                    && (sharedIdentity == bytes32(0) || sharedIdentity == reservation.sharedIdentityHash);
            }
            allReady = allReady && runtimeReady && occupantReady;
            bytes32 leaf = _reservationStateLeaf(
                reservation, key, exclusiveOccupant, sharedIdentity, actualRuntimeCodeHash, actualManagerRuntimeCodeHash
            );
            stateHash = keccak256(abi.encode(stateHash, i, leaf));
        }
    }

    function _hashControl(IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                CONTROL_HEAD_TYPEHASH,
                control.securityControlHeadHash,
                control.securityEpoch,
                control.securityEpochHash,
                control.policyEpoch,
                control.policyEpochHash,
                control.reviewGeneration,
                control.reviewGenerationHash,
                control.globalKilled
            )
        );
    }

    function _reservationStateLeaf(
        IProgrammableUniversalLaunchKernelV1.ReservationV1 calldata reservation,
        bytes32 key,
        bytes32 exclusiveOccupant,
        bytes32 sharedIdentity,
        bytes32 actualRuntimeCodeHash,
        bytes32 actualManagerRuntimeCodeHash
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RESERVATION_STATE_LEAF_TYPEHASH,
                key,
                uint8(reservation.scope),
                exclusiveOccupant,
                sharedIdentity,
                reservation.sharedIdentityHash,
                reservation.expectedRuntimeCodeHash,
                actualRuntimeCodeHash,
                reservation.expectedManagerRuntimeCodeHash,
                actualManagerRuntimeCodeHash
            )
        );
    }

    function _hashRuntime(PreflightReadbackV1 memory readback) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RUNTIME_HEAD_TYPEHASH,
                readback.chainId,
                readback.kernel,
                readback.kernelRuntimeCodeHash,
                readback.profileKey,
                uint8(readback.profileStatus),
                readback.profileModule,
                readback.expectedProfileModuleRuntimeCodeHash,
                readback.actualProfileModuleRuntimeCodeHash
            )
        );
    }

    function _hashLifecycle(PreflightReadbackV1 memory readback) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                LIFECYCLE_HEAD_TYPEHASH,
                uint8(readback.grantStateHead.status),
                readback.grantStateHead.grantHash,
                readback.grantStateHead.winnerKeyHash,
                readback.grantStateHead.stateHeadHash,
                readback.winnerNonceOccupant,
                readback.winnerKeyOccupant,
                readback.activeExecutionGrantDigest,
                uint8(readback.receiptStatus),
                readback.receiptCoreHash,
                readback.finalityIndexingReceiptHash
            )
        );
    }
}
