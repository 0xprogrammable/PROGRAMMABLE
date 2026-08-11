// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableUniversalLaunchKernelV1 } from "./IProgrammableUniversalLaunchKernelV1.sol";

interface IProgrammableUniversalLaunchPreflightV1 {
    struct PreflightReadbackV1 {
        uint256 chainId;
        address kernel;
        bytes32 kernelRuntimeCodeHash;
        bytes32 profileKey;
        IProgrammableUniversalLaunchKernelV1.ProfileStatus profileStatus;
        address profileModule;
        bytes32 expectedProfileModuleRuntimeCodeHash;
        bytes32 actualProfileModuleRuntimeCodeHash;
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 control;
        IProgrammableUniversalLaunchKernelV1.LaunchGrantStateHeadV1 grantStateHead;
        bytes32 winnerNonceOccupant;
        bytes32 winnerKeyOccupant;
        bytes32 activeExecutionGrantDigest;
        bytes32 reservationSetHash;
        bytes32 reservationStateHash;
        IProgrammableUniversalLaunchKernelV1.ReceiptStatus receiptStatus;
        bytes32 receiptCoreHash;
        bytes32 finalityIndexingReceiptHash;
        bool candidateCurrentnessUsed;
        bool candidateCurrentnessRevoked;
        uint16 readinessMask;
        bytes32 readbackHash;
    }

    function readbackV1(
        address kernel,
        bytes32 expectedKernelRuntimeCodeHash,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations,
        bytes32 candidateCurrentnessDigest
    ) external view returns (PreflightReadbackV1 memory readback);

    function atomicPreflightHashV1(
        address kernel,
        bytes32 expectedKernelRuntimeCodeHash,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] calldata reservations
    ) external view returns (bytes32 readbackHash);

    function closedRuntimeBindingHashV1(
        address account,
        bytes32 expectedRuntimeCodeHash,
        bytes32 expectedRuntimeBindingHash,
        bool requireStateless
    ) external view returns (bytes32 attestationHash);
}
