// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableLaunchPermitAuthorityV1 } from "./IProgrammableLaunchPermitAuthorityV1.sol";

/// @notice Stateless, codehash-bound hash/signature/release verifier used by the single stateful Permit Authority.
interface IProgrammableLaunchPermitVerifierV1 {
    function domainSeparator(address permitAuthority, uint256 chainId) external pure returns (bytes32);
    function permitDigest(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId
    ) external pure returns (bytes32);
    function generationBindingHash(IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit)
        external
        pure
        returns (bytes32);
    function releaseBindingHash(IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding)
        external
        pure
        returns (bytes32);
    function kernelEnvelopeHash(IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope)
        external
        pure
        returns (bytes32);
    function validatePermitStatic(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId,
        uint64 maxPermitLifetime,
        uint256 currentTimestamp
    ) external pure returns (bytes32 repositoryKey, bytes32 permitDigest);
    function validatePermitIdentity(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        address permitAuthority,
        uint256 chainId
    ) external pure returns (bytes32 repositoryKey, bytes32 permitDigest);
    function validateConsumption(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 calldata actualExecution,
        uint64 authorityGeneration,
        uint64 maxPermitLifetime,
        address consumerRoute
    ) external view returns (bytes32 repositoryKey, bytes32 permitDigest, bytes32 releaseBindingHash_);
    function validateCancellation(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope
    ) external view returns (bytes32 repositoryKey, bytes32 permitDigest);
    function validateReleaseBinding(
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        address permitAuthority,
        uint64 authorityGeneration
    ) external view returns (bytes32 releaseBindingHash);
    function validateKernelEnvelope(
        bytes32 expectedKernelEnvelopeHash,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope
    ) external pure;
    function validEOASignature(address signer, bytes32 digest, bytes calldata signature) external pure returns (bool);
}
