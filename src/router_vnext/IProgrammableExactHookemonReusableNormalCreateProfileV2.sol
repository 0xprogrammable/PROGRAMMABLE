// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableLaunchPermitAuthorityV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { IProgrammableExactHookemonNormalCreateProfileV1 } from "./IProgrammableExactHookemonNormalCreateProfileV1.sol";
import { IProgrammableUniversalLaunchKernelV1 } from "./IProgrammableUniversalLaunchKernelV1.sol";

interface IProgrammableExactHookemonReusableNormalCreateProfileV2 {
    struct ExactHookemonReusablePlanV2 {
        uint16 schemaVersion;
        bytes32 executorSalt;
        address expectedExecutor;
        IProgrammableExactHookemonNormalCreateProfileV1.ExactHookemonPlanV1 hookemon;
    }

    struct PlanCommitmentsV2 {
        bytes32 planHash;
        bytes32 componentGraphHash;
        bytes32 componentSetHash;
        bytes32 componentRuntimeSetHash;
        bytes32 configurationHash;
        bytes32 valueFlowHash;
    }

    struct LaunchTransportV2 {
        bytes encodedKernelTransport;
        bytes encodedPermitTransport;
    }

    struct KernelTransportV2 {
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 grant;
        bytes reviewerGrantSignature;
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 currentness;
        bytes currentnessSignature;
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 walletIntent;
        bytes walletSignature;
    }

    struct PermitTransportV2 {
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 permit;
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 releaseBinding;
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 kernelEnvelope;
        bytes permitSignature;
    }

    function launchExactHookemonV2(ExactHookemonReusablePlanV2 calldata plan, bytes calldata encodedTransport)
        external
        returns (bytes32 receiptCoreHash);
    function ROUTE_ID() external view returns (bytes32);
    function permitProfile() external view returns (address);
    function permitProfileId() external view returns (bytes32);
    function permitProfileBindingHash() external view returns (bytes32);
    function permitLaunchRegistry() external view returns (address);
    function permitKernelEnvelopeMode()
        external
        view
        returns (IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1);
    function permitExecutionAuthorityHash() external view returns (bytes32);
    function runtimeBindingHashV1() external view returns (bytes32);
}
