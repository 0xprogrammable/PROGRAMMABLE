// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableCompletedGraphAdoptionCompatV1
} from "../../src/hookemon/IProgrammableCompletedGraphAdoptionCompatV1.sol";
import {
    ProgrammableCompletedGraphAdoptionCompatCodecV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";
import {
    ProgrammableCompletedGraphAdoptionValidatorV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionValidatorV1.sol";
import {
    ProgrammableCompletedGraphAdoptionGrantRegistryV1
} from "../../src/hookemon/ProgrammableCompletedGraphAdoptionGrantRegistryV1.sol";

interface VmCompatV1 {
    function warp(uint256 newTimestamp) external;
}

contract CompatAuthorityV1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function register(
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry,
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 calldata capability
    ) external {
        registry.registerAdoptionProfileV1(capability);
    }

    function revokeCurrentness(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 digest) external {
        registry.revokeExecutionCurrentnessV1(digest);
    }

    function revokeGrant(ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry, bytes32 digest) external {
        registry.revokeLaunchGrantV1(digest);
    }

    function advanceEpochs(
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry,
        bytes32 securityControlHeadHash,
        uint64 securityEpoch,
        bytes32 securityEpochHash,
        uint64 policyEpoch,
        bytes32 policyEpochHash
    ) external {
        registry.advanceSecurityPolicyEpochsV1(
            securityControlHeadHash, securityEpoch, securityEpochHash, policyEpoch, policyEpochHash
        );
    }
}

contract CompatGraphNodeV1 {
    uint256 private immutable _marker;

    constructor(uint256 marker) {
        _marker = marker;
    }
}

/// @notice Self-contained focused lifecycle/negative tests; no forge-std or legacy package imports are required.
contract ProgrammableCompletedGraphAdoptionCompatV1Test {
    VmCompatV1 private constant VM = VmCompatV1(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant SECURITY_HEAD = keccak256("compat-security-head-v1");
    bytes32 private constant SECURITY_EPOCH_HASH = keccak256("compat-security-epoch-v1");
    bytes32 private constant POLICY_EPOCH_HASH = keccak256("compat-policy-epoch-v1");

    struct Fixture {
        ProgrammableCompletedGraphAdoptionCompatCodecV1 codec;
        ProgrammableCompletedGraphAdoptionGrantRegistryV1 registry;
        CompatAuthorityV1 governance;
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphAdoptionV1 adoption;
    }

    function testAdoptConsumesEvergreenGrantAndAnchorsCanonicalReceipt() external {
        Fixture memory fixture = _fixture();
        bytes32 coreHash = fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        bytes32 grantDigest = fixture.adoption.grant.grantDigest;
        bytes32 launchId = fixture.adoption.request.launchId;

        require(coreHash != bytes32(0), "empty core hash");
        require(
            fixture.registry.launchGrantStatus(grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Consumed,
            "grant not consumed"
        );
        require(
            fixture.registry.receiptStatus(launchId)
                == IProgrammableCompletedGraphAdoptionCompatV1.ReceiptStatusV1.Adopted,
            "receipt not adopted"
        );
        IProgrammableCompletedGraphAdoptionCompatV1.CanonicalReceiptCoreV1 memory core =
            fixture.registry.canonicalReceiptCore(launchId);
        require(core.receiptCoreHash == coreHash, "receipt self hash mismatch");
        require(core.launchGrantDigest == grantDigest, "grant digest mismatch");
        require(
            core.executionReadiness
                == IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly,
            "wrong readiness"
        );
    }

    function testRevokedCurrentnessCannotConsumeActiveEvergreenGrant() external {
        Fixture memory fixture = _fixture();
        bytes32 currentnessDigest = fixture.registry.executionCurrentnessDigest(fixture.adoption.currentness);
        fixture.governance.revokeCurrentness(fixture.registry, currentnessDigest);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "revoked currentness accepted");
        require(
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed adoption consumed grant"
        );
    }

    function testConsumedGrantAndCurrentnessCannotReplay() external {
        Fixture memory fixture = _fixture();
        fixture.registry.adoptCompletedGraphV1(fixture.adoption);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "replay accepted");
    }

    function testRevokedGrantCannotConsumeEvenWithCurrentness() external {
        Fixture memory fixture = _fixture();
        bytes32 grantDigest = fixture.adoption.grant.grantDigest;
        fixture.governance.revokeGrant(fixture.registry, grantDigest);

        require(
            fixture.registry.launchGrantStatus(grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "grant did not become revoked"
        );
        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "revoked grant accepted");
        require(
            fixture.registry.launchGrantStatus(grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Revoked,
            "failed adoption changed revoked grant"
        );
    }

    function testGrantHashAndDigestVectorRemainStable() external {
        Fixture memory fixture = _fixture();
        require(
            fixture.codec.computeLaunchGrantHash(fixture.adoption.grant) == fixture.adoption.grant.grantHash,
            "grant hash drift"
        );
        require(
            fixture.registry.launchGrantDigest(fixture.adoption.grant) == fixture.adoption.grant.grantDigest,
            "grant digest drift"
        );
        require(
            fixture.codec.computePlanHash(fixture.adoption.plan) == fixture.adoption.grant.contractPlanHash,
            "plan hash drift"
        );
    }

    function testYearsLaterFreshCurrentnessConsumesTheSameActiveGrant() external {
        Fixture memory fixture = _fixture();
        VM.warp(block.timestamp + 730 days);
        fixture.adoption.currentness.nonce = keccak256("compat-years-later-currentness-nonce");
        fixture.adoption.currentness.validAfter = uint64(block.timestamp);
        fixture.adoption.currentness.deadline = uint64(block.timestamp + 1 hours);

        fixture.registry.adoptCompletedGraphV1(fixture.adoption);
        require(
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Consumed,
            "evergreen grant stranded"
        );
    }

    function testEpochAdvanceBlocksStaleCurrentnessWithoutRevokingTheGrant() external {
        Fixture memory fixture = _fixture();
        fixture.governance
            .advanceEpochs(
                fixture.registry,
                keccak256("compat-security-head-v2"),
                2,
                keccak256("compat-security-epoch-v2"),
                2,
                keccak256("compat-policy-epoch-v2")
            );

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "stale currentness accepted after epoch advance");
        require(
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "epoch block revoked evergreen grant"
        );
    }

    function testExternalExecutionConstraintRequiresEvidenceAndCannotCreateAnExecutePath() external {
        Fixture memory fixture = _fixture();
        fixture.adoption.grant.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.ExternalExecutionTimeBound;
        fixture.adoption.grant.oneWinnerNonce = keccak256("compat-external-time-bound-nonce");
        fixture.adoption.grant.grantHash = fixture.codec.computeLaunchGrantHash(fixture.adoption.grant);
        fixture.adoption.grant.grantDigest = fixture.registry.launchGrantDigest(fixture.adoption.grant);

        (bool success,) = address(fixture.registry)
            .call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (fixture.adoption.grant, hex"01")));
        require(!success, "unproven source execution constraint accepted");
    }

    function testLegacyCustomGraphRouteCannotBeSilentlyReinterpreted() external {
        Fixture memory fixture = _fixture();
        fixture.adoption.plan.routeSchemaHash = keccak256("custom-graph@1.0.0");

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.adoptCompletedGraphV1, (fixture.adoption)));
        require(!success, "legacy route silently adopted");
        require(
            fixture.registry.launchGrantStatus(fixture.adoption.grant.grantDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "failed legacy migration consumed grant"
        );
    }

    function testWinnerKeyReservationRejectsCompetingGrant() external {
        Fixture memory fixture = _fixture();
        bytes32 incumbentDigest = fixture.adoption.grant.grantDigest;
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory competing = fixture.adoption.grant;
        competing.contractPlanHash = keccak256("compat-competing-reviewed-plan");
        competing.oneWinnerNonce = keccak256("compat-competing-winner-nonce");
        competing.grantHash = fixture.codec.computeLaunchGrantHash(competing);
        competing.grantDigest = fixture.registry.launchGrantDigest(competing);

        (bool success,) =
            address(fixture.registry).call(abi.encodeCall(fixture.registry.activateLaunchGrantV1, (competing, hex"01")));
        require(!success, "winner key allowed competing grant");
        require(
            fixture.registry.launchGrantStatus(incumbentDigest)
                == IProgrammableCompletedGraphAdoptionCompatV1.GrantStatusV1.Active,
            "competing activation disturbed incumbent grant"
        );
    }

    function testPublishedTypehashesMatchTheCanonicalFormulaStrings() external {
        Fixture memory fixture = _fixture();
        require(
            fixture.codec.ADOPTION_ONLY_READINESS_CONSTRAINT_HASH()
                == keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_ONLY_NO_SOURCE_EXECUTION_V1"),
            "readiness typehash drift"
        );
        require(
            fixture.codec.LAUNCH_GRANT_TYPEHASH()
                == keccak256(
                    "ProgrammableCompletedGraphLaunchGrantV1(bytes32 bindingAHash,bytes32 bindingBHash,bytes32 reviewHash)"
                ),
            "grant typehash drift"
        );
        require(
            fixture.codec.CANONICAL_RECEIPT_CORE_TYPEHASH()
                == keccak256("ProgrammableCompletedGraphCanonicalReceiptCoreV1(bytes32 abiEncodedReceiptWithoutHash)"),
            "receipt typehash drift"
        );
    }

    function _fixture() private returns (Fixture memory fixture) {
        fixture.codec = new ProgrammableCompletedGraphAdoptionCompatCodecV1();
        ProgrammableCompletedGraphAdoptionValidatorV1 validator =
            new ProgrammableCompletedGraphAdoptionValidatorV1(address(fixture.codec));
        CompatAuthorityV1 reviewer = new CompatAuthorityV1();
        fixture.governance = new CompatAuthorityV1();
        CompatAuthorityV1 finality = new CompatAuthorityV1();
        CompatAuthorityV1 indexer = new CompatAuthorityV1();
        fixture.registry = new ProgrammableCompletedGraphAdoptionGrantRegistryV1(
            address(reviewer),
            address(fixture.governance),
            address(finality),
            address(indexer),
            address(fixture.codec),
            address(validator),
            SECURITY_HEAD,
            1,
            SECURITY_EPOCH_HASH,
            1,
            POLICY_EPOCH_HASH
        );

        _buildPlanAndGraph(fixture);
        IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability = _capability(fixture);
        fixture.governance.register(fixture.registry, capability);
        _buildGrantRequestAndCurrentness(fixture);
        fixture.registry.activateLaunchGrantV1(fixture.adoption.grant, hex"01");
    }

    function _buildPlanAndGraph(Fixture memory fixture) private {
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 memory plan;
        bytes32 profileDescriptorHash = keccak256("compat-profile-descriptor");
        bytes32 routeSchemaHash = keccak256("compat-route-schema");
        plan.profileKey = fixture.codec.computeProfileKey(profileDescriptorHash, routeSchemaHash);
        plan.profileDescriptorHash = profileDescriptorHash;
        plan.exactContractBindingHash = keccak256("compat-contract-binding");
        plan.routeSchemaHash = routeSchemaHash;
        plan.planSchemaArtifactHash = keccak256("compat-plan-schema");
        plan.sourceRepositoryHash = keccak256("compat-source-repository");
        plan.sourceCommitHash = keccak256("compat-source-commit");
        plan.sourceTreeHash = keccak256("compat-source-tree");
        plan.manifestHash = keccak256("compat-manifest");
        plan.policyHash = keccak256("compat-policy");
        plan.compilerArtifactHash = keccak256("compat-compiler-artifact");
        plan.applicantPlanArtifactHash = keccak256("compat-applicant-plan");
        plan.adoptionIntentHash = keccak256("compat-adoption-intent");
        plan.executionReadiness =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionReadinessV1.CompletedGraphAdoptionOnly;
        plan.executionReadinessConstraintHash = fixture.codec.ADOPTION_ONLY_READINESS_CONSTRAINT_HASH();
        plan.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution;
        plan.launchWallet = address(this);
        plan.launchClassification =
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchClassificationV1.CompletedGraphAdoption;
        plan.identityMask = 1 << 3;
        plan.architectureResultHash = keccak256("compat-architecture-result");
        plan.deploymentLineageHash = keccak256("compat-deployment-lineage");
        fixture.adoption.plan = plan;

        CompatGraphNodeV1 nodeA = new CompatGraphNodeV1(1);
        CompatGraphNodeV1 nodeB = new CompatGraphNodeV1(2);
        fixture.adoption.components = new IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[](2);
        address first = address(nodeA) < address(nodeB) ? address(nodeA) : address(nodeB);
        address second = address(nodeA) < address(nodeB) ? address(nodeB) : address(nodeA);
        fixture.adoption.components[0] = _externalComponent(
            first,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Application,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive,
            keccak256("compat-primary-application")
        );
        fixture.adoption.components[1] = _externalComponent(
            second,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Auxiliary,
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Exclusive,
            keccak256("compat-auxiliary")
        );
        for (uint256 i; i < fixture.adoption.components.length; ++i) {
            fixture.adoption.components[i].creationEvidenceHash = fixture.codec
                .computeComponentCreationEvidenceHash(
                    address(fixture.registry), fixture.adoption.plan, i, fixture.adoption.components[i]
                );
            fixture.adoption.components[i].configurationHash =
                fixture.codec.computeComponentConfigurationHash(fixture.adoption.components[i]);
        }
        fixture.adoption.plan.identities.applicationHash =
            fixture.codec.computeApplicationIdentityHash(fixture.adoption.components[0]);
        fixture.adoption.edges = new IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[](1);
        fixture.adoption.edges[0] = IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1({
            fromIndex: 0,
            toIndex: 1,
            kind: IProgrammableCompletedGraphAdoptionCompatV1.EdgeKindV1.Controls,
            relationHash: keccak256("compat-edge")
        });
        fixture.adoption.plan.componentGraphHash =
            fixture.codec.computeComponentGraphHash(fixture.adoption.components, fixture.adoption.edges);
        fixture.adoption.plan.exactRuntimeSetHash =
            fixture.codec.computeExactRuntimeSetHash(fixture.adoption.components);
        fixture.adoption.plan.componentConfigurationSetHash =
            fixture.codec.computeComponentConfigurationSetHash(fixture.adoption.components);
        fixture.adoption.plan.configurationHash = fixture.codec
            .computeConfigurationHash(
                fixture.adoption.plan.componentGraphHash,
                fixture.adoption.plan.componentConfigurationSetHash,
                fixture.adoption.plan.policyHash,
                address(0),
                bytes32(0),
                bytes32(0),
                fixture.adoption.plan.architectureResultHash
            );
        fixture.adoption.plan.resultHash = fixture.codec
            .computeResultHash(
                fixture.adoption.plan.componentGraphHash,
                fixture.adoption.plan.configurationHash,
                fixture.adoption.plan.architectureResultHash,
                bytes32(0),
                fixture.adoption.plan.deploymentLineageHash
            );
    }

    function _buildGrantRequestAndCurrentness(Fixture memory fixture) private view {
        bytes32 planHash = fixture.codec.computePlanHash(fixture.adoption.plan);
        bytes32 launchId = fixture.codec
            .computeLaunchId(
                address(fixture.registry),
                fixture.adoption.plan.launchWallet,
                fixture.adoption.plan.profileKey,
                planHash
            );
        fixture.adoption.request = IProgrammableCompletedGraphAdoptionCompatV1.AdoptionRequestV1({
            launchId: launchId,
            profileKey: fixture.adoption.plan.profileKey,
            componentGraphHash: fixture.adoption.plan.componentGraphHash,
            resultHash: fixture.adoption.plan.resultHash,
            currentArchitectureStateHash: keccak256("compat-current-architecture"),
            currentPoolStateHash: bytes32(0)
        });
        IProgrammableCompletedGraphAdoptionCompatV1.LaunchGrantV1 memory grant;
        grant.chainId = block.chainid;
        grant.registry = address(fixture.registry);
        grant.launchWallet = address(this);
        grant.applicantIdHash = keccak256("compat-applicant");
        grant.profileKey = fixture.adoption.plan.profileKey;
        grant.profileDescriptorHash = fixture.adoption.plan.profileDescriptorHash;
        grant.exactContractBindingHash = fixture.adoption.plan.exactContractBindingHash;
        grant.contractPlanHash = planHash;
        grant.applicantPlanArtifactHash = fixture.adoption.plan.applicantPlanArtifactHash;
        grant.adoptionIntentHash = fixture.adoption.plan.adoptionIntentHash;
        grant.executionReadiness = fixture.adoption.plan.executionReadiness;
        grant.executionReadinessConstraintHash = fixture.adoption.plan.executionReadinessConstraintHash;
        grant.executionTimeConstraint = fixture.adoption.plan.executionTimeConstraint;
        grant.sourceRepositoryHash = fixture.adoption.plan.sourceRepositoryHash;
        grant.sourceCommitHash = fixture.adoption.plan.sourceCommitHash;
        grant.sourceTreeHash = fixture.adoption.plan.sourceTreeHash;
        grant.componentGraphHash = fixture.adoption.plan.componentGraphHash;
        grant.exactRuntimeSetHash = fixture.adoption.plan.exactRuntimeSetHash;
        grant.componentConfigurationSetHash = fixture.adoption.plan.componentConfigurationSetHash;
        grant.resultHash = fixture.adoption.plan.resultHash;
        grant.builderEvidenceHash = keccak256("compat-builder-evidence");
        grant.reviewerAttestationHash = keccak256("compat-reviewer-attestation");
        grant.securityControlHeadHash = SECURITY_HEAD;
        grant.securityEpochHash = SECURITY_EPOCH_HASH;
        grant.policyHash = fixture.adoption.plan.policyHash;
        grant.policyEpochHash = POLICY_EPOCH_HASH;
        grant.securityEpoch = 1;
        grant.policyEpoch = 1;
        grant.oneWinnerNonce = keccak256("compat-one-winner-nonce");
        grant.winnerKeyHash = keccak256("compat-winner-key");
        grant.grantHash = fixture.codec.computeLaunchGrantHash(grant);
        grant.grantDigest = fixture.registry.launchGrantDigest(grant);
        fixture.adoption.grant = grant;

        fixture.adoption.currentness = IProgrammableCompletedGraphAdoptionCompatV1.ExecutionCurrentnessV1({
            chainId: block.chainid,
            registry: address(fixture.registry),
            launchWallet: address(this),
            launchGrantDigest: grant.grantDigest,
            contractPlanHash: planHash,
            receiptRequestHash: fixture.codec.computeAdoptionRequestHash(fixture.adoption.request),
            expectedResultHash: fixture.adoption.plan.resultHash,
            adoptionIntentHash: fixture.adoption.plan.adoptionIntentHash,
            securityControlHeadHash: SECURITY_HEAD,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpochHash: POLICY_EPOCH_HASH,
            securityEpoch: 1,
            policyEpoch: 1,
            nonce: keccak256("compat-currentness-nonce"),
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 1 hours)
        });
        fixture.adoption.currentnessSignature = hex"01";
    }

    function _capability(Fixture memory fixture)
        private
        pure
        returns (IProgrammableCompletedGraphAdoptionCompatV1.AdoptionProfileCapabilityV1 memory capability)
    {
        capability.profileKey = fixture.adoption.plan.profileKey;
        capability.profileDescriptorHash = fixture.adoption.plan.profileDescriptorHash;
        capability.exactContractBindingHash = fixture.adoption.plan.exactContractBindingHash;
        capability.routeSchemaHash = fixture.adoption.plan.routeSchemaHash;
        capability.planSchemaArtifactHash = fixture.adoption.plan.planSchemaArtifactHash;
        capability.policyHash = fixture.adoption.plan.policyHash;
        capability.capabilitySemantics = IProgrammableCompletedGraphAdoptionCompatV1.CapabilitySemanticsV1.Adopt;
        capability.admissionStatus = IProgrammableCompletedGraphAdoptionCompatV1.AdmissionStatusV1.Admitted;
        capability.launchClassification = fixture.adoption.plan.launchClassification;
        capability.executionReadiness = fixture.adoption.plan.executionReadiness;
        capability.executionReadinessConstraintHash = fixture.adoption.plan.executionReadinessConstraintHash;
        capability.executionTimeConstraint =
        IProgrammableCompletedGraphAdoptionCompatV1.ExecutionTimeConstraintV1.AdoptionOnlyNoExecution;
        capability.requiredIdentityMask = fixture.adoption.plan.identityMask;
        capability.enabled = true;
    }

    function _externalComponent(
        address account,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1 kind,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1 scope,
        bytes32 externalCanonicalIdHash
    ) private view returns (IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 memory component) {
        component.account = account;
        component.kind = kind;
        component.scope = scope;
        component.deploymentKind = IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.ExternalCanonical;
        component.externalCanonicalIdHash = externalCanonicalIdHash;
        component.runtimeCodeHash = account.codehash;
    }
}
