// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IProgrammableRuntimeBindingV1,
    IProgrammableUniversalLaunchKernelV1
} from "../../src/router_vnext/IProgrammableUniversalLaunchKernelV1.sol";
import { ProgrammableUniversalLaunchKernelV1 } from "../../src/router_vnext/ProgrammableUniversalLaunchKernelV1.sol";
import {
    IProgrammableNestedFactoryProfileV1,
    IProgrammableNestedFactoryProviderV1,
    IProgrammableNestedFactoryPostconditionVerifierV1
} from "../../src/router_vnext/IProgrammableNestedFactoryProfileV1.sol";
import { ProgrammableNestedFactoryProfileV1 } from "../../src/router_vnext/ProgrammableNestedFactoryProfileV1.sol";
import {
    ProgrammableUniversalLaunchPreflightV1
} from "../../src/router_vnext/ProgrammableUniversalLaunchPreflightV1.sol";

contract UniversalTestAuthorityV1 {
    bool private _reject;

    function setReject(bool reject_) external {
        _reject = reject_;
    }

    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        return _reject ? bytes4(0xffffffff) : bytes4(0x1626ba7e);
    }

    function registerProfile(
        ProgrammableUniversalLaunchKernelV1 kernel,
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 calldata descriptor
    ) external {
        kernel.registerProfileV1(descriptor);
    }

    function setProfileStatus(
        ProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 profileKey,
        IProgrammableUniversalLaunchKernelV1.ProfileStatus status
    ) external {
        kernel.setProfileStatusV1(profileKey, status);
    }

    function advanceControl(
        ProgrammableUniversalLaunchKernelV1 kernel,
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 calldata control
    ) external {
        kernel.advanceControlV1(control);
    }

    function setGlobalKill(ProgrammableUniversalLaunchKernelV1 kernel, bool killed) external {
        kernel.setGlobalKillV1(killed);
    }

    function revokeGrant(ProgrammableUniversalLaunchKernelV1 kernel, bytes32 grantDigest) external {
        kernel.revokeLaunchGrantV1(grantDigest);
    }
}

contract UniversalApplicantWalletV1 {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }

    function launch(
        ProgrammableNestedFactoryProfileV1 profile,
        bytes32 grantDigest,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan,
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 calldata currentness,
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 calldata intent
    ) external returns (bytes32) {
        IProgrammableNestedFactoryProfileV1.LaunchTransportV1 memory transport =
            IProgrammableNestedFactoryProfileV1.LaunchTransportV1({
                currentness: currentness, currentnessSignature: hex"01", walletIntent: intent, walletSignature: hex"02"
            });
        return profile.launchNestedFactoryV1(grantDigest, plan, transport);
    }
}

contract UniversalNestedChildV1 {
    address public owner;
    bytes32 public configurationHash;

    constructor(address owner_, bytes32 configurationHash_) {
        owner = owner_;
        configurationHash = configurationHash_;
    }
}

contract UniversalPoolManagerV1 {
    mapping(bytes32 poolId => bool initialized) private _initialized;

    function initialize(bytes32 poolId) external {
        require(!_initialized[poolId], "pool initialized");
        _initialized[poolId] = true;
    }

    function isInitialized(bytes32 poolId) external view returns (bool) {
        return _initialized[poolId];
    }
}

contract UniversalNestedProviderV1 is IProgrammableNestedFactoryProviderV1 {
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "UniversalNestedProviderRuntimeBindingV1(bytes32 seed,uint8 failureMode,address controlMutationGovernance,address controlMutationKernel)"
    );
    bytes32 private constant ACTION_IDENTITY_TYPEHASH = keccak256(
        "NestedFactoryActionIdentityV1(bytes32 providerPlanId,bytes32 factorySalt,address applicantWallet,bytes32 sourceLaunchId,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolId,address tokenOwner,address hookOwner,address treasury)"
    );
    bytes32 private constant ACTION_ECONOMICS_TYPEHASH = keccak256(
        "NestedFactoryActionEconomicsV1(uint256 tokenSupply,uint256 nativeValue,bytes32 hookPermissionsHash,bytes32 configurationHash)"
    );
    bytes32 private constant ACTION_TYPEHASH =
        keccak256("NestedFactoryActionV1(bytes32 identityHash,bytes32 economicsHash)");
    bytes32 private constant COMPONENT_TYPEHASH = keccak256(
        "NestedFactoryComponentV1(uint8 role,uint8 scope,address account,bytes32 runtimeCodeHash,bytes32 creationProvenanceHash,bytes32 ownershipBindingHash,bytes32 configurationHash)"
    );
    bytes32 private constant PROVIDER_EXECUTION_ID_TYPEHASH = keccak256(
        "NestedFactoryProviderExecutionIdV1(bytes32 providerBindingHash,bytes32 executionKey,bytes32 grantDigest,bytes32 stampLaunchId,bytes32 antiReplayNonce,bytes32 actionHash,bytes32 orderedComponentHeadHash)"
    );

    bytes32 private immutable _providerBindingHash;
    uint8 private immutable _failureMode;
    address private immutable _controlMutationGovernance;
    ProgrammableUniversalLaunchKernelV1 private immutable _controlMutationKernel;

    constructor(
        bytes32 providerBindingSeed,
        uint8 failureMode,
        address controlMutationGovernance,
        ProgrammableUniversalLaunchKernelV1 controlMutationKernel
    ) {
        _failureMode = failureMode;
        _controlMutationGovernance = controlMutationGovernance;
        _controlMutationKernel = controlMutationKernel;
        _providerBindingHash = keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH,
                providerBindingSeed,
                failureMode,
                controlMutationGovernance,
                address(controlMutationKernel)
            )
        );
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        return _providerBindingHash;
    }

    function executeNestedFactoryV1(
        bytes32 executionKey,
        bytes32 grantDigest,
        bytes32 stampLaunchId,
        bytes32 antiReplayNonce,
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action,
        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] calldata components
    ) external payable returns (IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 memory result) {
        if (_controlMutationGovernance != address(0)) {
            IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory nextControl =
                IProgrammableUniversalLaunchKernelV1.ControlStateV1({
                    securityControlHeadHash: keccak256("universal-security-head-v2"),
                    securityEpoch: 2,
                    securityEpochHash: keccak256("universal-security-epoch-v2"),
                    policyEpoch: 2,
                    policyEpochHash: keccak256("universal-policy-epoch-v2"),
                    reviewGeneration: 2,
                    reviewGenerationHash: keccak256("universal-review-generation-v2"),
                    globalKilled: false
                });
            bytes memory mutation =
                abi.encodeCall(UniversalTestAuthorityV1.advanceControl, (_controlMutationKernel, nextControl));
            (bool mutationSucceeded,) = _controlMutationGovernance.call(mutation);
            require(!mutationSucceeded, "control mutation escaped execution lock");
        }
        if (_failureMode == 1) revert("provider failure");
        if (_failureMode == 2) {
            assembly ("memory-safe") {
                mstore(0, 0x1626ba7e)
                return(28, 4)
            }
        }
        if (_failureMode == 3) {
            assembly ("memory-safe") {
                return(0, 8192)
            }
        }
        require(components.length == 2, "components");
        require(msg.value == action.nativeValue, "value");
        UniversalNestedChildV1 child =
            new UniversalNestedChildV1{ salt: action.factorySalt }(action.tokenOwner, action.configurationHash);
        require(address(child) == components[0].account, "child");
        require(components[1].account == address(this), "shared");
        UniversalPoolManagerV1(action.poolManager).initialize(action.poolId);

        (bytes32 orderedHead, bytes32 componentSetHash, bytes32 runtimeSetHash) = _componentHashes(components);
        bytes32 actionHash = _hashAction(action);
        result.providerExecutionId = keccak256(
            abi.encode(
                PROVIDER_EXECUTION_ID_TYPEHASH,
                _providerBindingHash,
                executionKey,
                grantDigest,
                stampLaunchId,
                antiReplayNonce,
                actionHash,
                orderedHead
            )
        );
        result.configurationHash = action.configurationHash;
        result.componentSetHash = componentSetHash;
        result.componentRuntimeSetHash = runtimeSetHash;
        result.architectureStateHash = _architectureState(action, address(child));
        result.poolStateHash = keccak256(abi.encode(action.poolManager, action.poolId));
        result.supplyValueFlowHash = _valueFlow(action);
        result.returnedIdentitiesHash = _returnedIdentities(action, address(child));
    }

    function childAddress(bytes32 salt, address owner, bytes32 configurationHash) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(UniversalNestedChildV1).creationCode, abi.encode(owner, configurationHash))
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initCodeHash)))));
    }

    function _architectureState(
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action,
        address child
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(action.providerPlanId, child, action.tokenOwner, action.hookOwner, action.treasury));
    }

    function _valueFlow(IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(action.tokenSupply, action.nativeValue, action.treasury));
    }

    function _returnedIdentities(
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action,
        address child
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(child, action.poolManager, action.poolId, action.tokenOwner, action.hookOwner, action.treasury)
        );
    }

    function _hashAction(IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 calldata action)
        private
        pure
        returns (bytes32)
    {
        bytes32 identityHash = keccak256(
            abi.encode(
                ACTION_IDENTITY_TYPEHASH,
                action.providerPlanId,
                action.factorySalt,
                action.applicantWallet,
                action.sourceLaunchId,
                action.poolManager,
                action.poolManagerRuntimeCodeHash,
                action.poolId,
                action.tokenOwner,
                action.hookOwner,
                action.treasury
            )
        );
        bytes32 economicsHash = keccak256(
            abi.encode(
                ACTION_ECONOMICS_TYPEHASH,
                action.tokenSupply,
                action.nativeValue,
                action.hookPermissionsHash,
                action.configurationHash
            )
        );
        return keccak256(abi.encode(ACTION_TYPEHASH, identityHash, economicsHash));
    }

    function _componentHashes(IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] calldata components)
        private
        pure
        returns (bytes32 orderedHead, bytes32 componentSetHash, bytes32 runtimeSetHash)
    {
        for (uint256 i; i < components.length; ++i) {
            IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 calldata component = components[i];
            bytes32 leaf = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.role,
                    uint8(component.scope),
                    component.account,
                    component.runtimeCodeHash,
                    component.creationProvenanceHash,
                    component.ownershipBindingHash,
                    component.configurationHash
                )
            );
            orderedHead = keccak256(abi.encode(orderedHead, i, leaf));
            componentSetHash = keccak256(abi.encode(componentSetHash, i, component.role, component.account, leaf));
            runtimeSetHash = keccak256(
                abi.encode(runtimeSetHash, i, component.role, component.account, component.runtimeCodeHash)
            );
        }
    }
}

contract UniversalNestedVerifierV1 is IProgrammableNestedFactoryPostconditionVerifierV1 {
    bytes32 private constant RUNTIME_BINDING_HASH = keccak256("universal-nested-verifier-runtime-binding-v1");
    bytes32 private constant PROFILE_PREFLIGHT_TYPEHASH = keccak256(
        "NestedFactoryProfilePreflightV1(address profile,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 poolId,bool poolInitialized,bytes32 configurationHash,bytes32 expectedRevenueStateHash)"
    );

    function runtimeBindingHashV1() external pure returns (bytes32) {
        return RUNTIME_BINDING_HASH;
    }

    function verifyNestedPreflightV1(
        address profile,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan
    ) external view returns (bytes32 profilePreflightReadbackHash) {
        UniversalPoolManagerV1 poolManager = UniversalPoolManagerV1(plan.action.poolManager);
        require(plan.action.poolManager.codehash == plan.action.poolManagerRuntimeCodeHash, "manager runtime");
        bool initialized = poolManager.isInitialized(plan.action.poolId);
        require(!initialized, "pool occupied");
        return keccak256(
            abi.encode(
                PROFILE_PREFLIGHT_TYPEHASH,
                profile,
                plan.action.poolManager,
                plan.action.poolManagerRuntimeCodeHash,
                plan.action.poolId,
                initialized,
                plan.action.configurationHash,
                plan.expectedRevenueStateHash
            )
        );
    }

    function verifyNestedPostconditionsV1(
        address,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 calldata plan,
        IProgrammableNestedFactoryProfileV1.NestedFactoryResultV1 calldata result
    ) external view returns (IProgrammableNestedFactoryProfileV1.NestedPostconditionResultV1 memory postconditions) {
        require(plan.components.length == 2, "components");
        UniversalNestedChildV1 child = UniversalNestedChildV1(plan.components[0].account);
        require(child.owner() == plan.action.tokenOwner, "owner");
        require(child.configurationHash() == plan.action.configurationHash, "configuration");
        bytes32 architectureStateHash = keccak256(
            abi.encode(
                plan.action.providerPlanId,
                address(child),
                plan.action.tokenOwner,
                plan.action.hookOwner,
                plan.action.treasury
            )
        );
        bytes32 poolStateHash = keccak256(abi.encode(plan.action.poolManager, plan.action.poolId));
        require(UniversalPoolManagerV1(plan.action.poolManager).isInitialized(plan.action.poolId), "pool missing");
        bytes32 revenueStateHash = keccak256(abi.encode(plan.action.treasury, plan.action.configurationHash));
        bytes32 valueFlowHash =
            keccak256(abi.encode(plan.action.tokenSupply, plan.action.nativeValue, plan.action.treasury));
        require(result.architectureStateHash == architectureStateHash, "architecture");
        require(result.poolStateHash == poolStateHash, "pool");
        postconditions = IProgrammableNestedFactoryProfileV1.NestedPostconditionResultV1({
            architectureStateHash: architectureStateHash,
            poolStateHash: poolStateHash,
            revenueStateHash: revenueStateHash,
            valueFlowHash: valueFlowHash
        });
    }
}

contract UniversalDelegateProxyDependencyV1 is IProgrammableRuntimeBindingV1 {
    address private immutable _implementation;
    bytes32 private immutable _bindingHash;

    constructor(address implementation, bytes32 bindingHash) {
        _implementation = implementation;
        _bindingHash = bindingHash;
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        return _bindingHash;
    }

    fallback() external payable {
        address implementation = _implementation;
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

contract UniversalStatefulDependencyV1 is IProgrammableRuntimeBindingV1 {
    bytes32 private _bindingHash;

    constructor(bytes32 bindingHash) {
        _bindingHash = bindingHash;
    }

    function setRuntimeBindingHash(bytes32 bindingHash) external {
        _bindingHash = bindingHash;
    }

    function runtimeBindingHashV1() external view returns (bytes32) {
        return _bindingHash;
    }
}

contract UniversalRawRuntimeDependencyV1 {
    constructor(bytes memory runtime) {
        assembly ("memory-safe") {
            return(add(runtime, 32), mload(runtime))
        }
    }
}

contract ProgrammableUniversalLaunchKernelV1Test {
    bytes32 private constant SECURITY_HEAD = keccak256("universal-security-head-v1");
    bytes32 private constant SECURITY_EPOCH_HASH = keccak256("universal-security-epoch-v1");
    bytes32 private constant POLICY_EPOCH_HASH = keccak256("universal-policy-epoch-v1");
    bytes32 private constant REVIEW_GENERATION_HASH = keccak256("universal-review-generation-v1");
    bytes32 private constant PROFILE_KEY = keccak256("NESTED_FACTORY:universal:v1");
    bytes32 private constant PROVIDER_BINDING_HASH = keccak256("universal-nested-provider-binding-v1");
    bytes32 private constant CONTRACT_BINDING_HASH = keccak256("universal-contract-binding-v1");
    bytes32 private constant REVENUE_POLICY_HASH = keccak256("universal-revenue-policy-v1");
    bytes32 private constant COMPONENT_TYPEHASH = keccak256(
        "NestedFactoryComponentV1(uint8 role,uint8 scope,address account,bytes32 runtimeCodeHash,bytes32 creationProvenanceHash,bytes32 ownershipBindingHash,bytes32 configurationHash)"
    );

    struct Fixture {
        ProgrammableUniversalLaunchKernelV1 kernel;
        ProgrammableNestedFactoryProfileV1 profile;
        UniversalNestedProviderV1 provider;
        UniversalNestedVerifierV1 verifier;
        ProgrammableUniversalLaunchPreflightV1 preflight;
        UniversalPoolManagerV1 poolManager;
        UniversalTestAuthorityV1 reviewer;
        UniversalTestAuthorityV1 governance;
        UniversalTestAuthorityV1 finality;
        UniversalTestAuthorityV1 indexer;
    }

    struct PreparedLaunch {
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 plan;
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 grant;
        bytes32 grantDigest;
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] reservations;
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 currentness;
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 intent;
    }

    function testTwoMateriallyDifferentApplicantsUseSameNestedProfile() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicantOne = new UniversalApplicantWalletV1();
        UniversalApplicantWalletV1 applicantTwo = new UniversalApplicantWalletV1();

        _launch(fixture, applicantOne, keccak256("plan-one"), bytes32(uint256(101)), 1_000_000 ether);
        _launch(fixture, applicantTwo, keccak256("plan-two"), bytes32(uint256(202)), 2_500_000 ether);

        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            fixture.kernel.profileDescriptorV1(PROFILE_KEY);
        require(descriptor.module == address(fixture.profile), "profile module changed");
        require(descriptor.moduleRuntimeCodeHash == address(fixture.profile).codehash, "profile runtime changed");
    }

    function testPairwiseLaunchIdentitiesFailClosed() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        (, IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant) =
            _planAndGrant(fixture, applicant, keccak256("identity-negative"), bytes32(uint256(303)), 3000 ether);
        grant.antiReplayNonce = grant.sourceLaunchId;
        grant.stampLaunchId = fixture.kernel.computeStampLaunchIdV1(grant);
        (bool success,) = address(fixture.kernel)
            .call(abi.encodeCall(ProgrammableUniversalLaunchKernelV1.activateLaunchGrantV1, (grant, hex"01")));
        require(!success, "identity alias accepted");
    }

    function testFuzzWinnerKeyIsPermanentAcrossDifferentNonces(bytes32 entropy) external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        (, IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant) =
            _planAndGrant(fixture, applicant, keccak256("winner"), bytes32(uint256(404)), 4000 ether);
        bytes32 firstDigest = fixture.kernel.activateLaunchGrantV1(grant, hex"01");
        require(firstDigest != bytes32(0), "first grant");
        grant.antiReplayNonce = keccak256(abi.encode(entropy, "different-nonce"));
        require(grant.antiReplayNonce != bytes32(0), "zero fuzz nonce");
        grant.stampLaunchId = fixture.kernel.computeStampLaunchIdV1(grant);
        (bool success,) = address(fixture.kernel)
            .call(abi.encodeCall(ProgrammableUniversalLaunchKernelV1.activateLaunchGrantV1, (grant, hex"01")));
        require(!success, "winner key reused");
    }

    function testSignedExecutionModeMismatchFailsClosed() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("mode-mismatch"), bytes32(uint256(405)), 4500 ether);
        prepared.currentness.executionMode = IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Adopt;
        require(!_tryLaunch(applicant, fixture.profile, prepared), "mode mismatch launched");
        _assertGrantStatus(
            fixture.kernel, prepared.grantDigest, IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Active
        );
    }

    function testPlanDriftFailsClosed() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("plan-drift"), bytes32(uint256(415)), 5500 ether);
        prepared.plan.action.tokenSupply += 1;
        require(!_tryLaunch(applicant, fixture.profile, prepared), "changed plan launched");
    }

    function testApplicantWalletDriftFailsClosed() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 approvedApplicant = new UniversalApplicantWalletV1();
        UniversalApplicantWalletV1 differentApplicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, approvedApplicant, keccak256("wallet-drift"), bytes32(uint256(416)), 5600 ether);
        require(!_tryLaunch(differentApplicant, fixture.profile, prepared), "different wallet launched");
    }

    function testCurrentnessPolicyDriftFailsClosed() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("policy-drift"), bytes32(uint256(417)), 5700 ether);
        prepared.currentness.policyEpochHash = keccak256("unreviewed-policy");
        require(!_tryLaunch(applicant, fixture.profile, prepared), "changed policy currentness launched");
    }

    function testGrantAndCurrentnessAreConsumedExactlyOnce() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("consume-once"), bytes32(uint256(418)), 5800 ether);
        bytes32 currentnessDigest = fixture.kernel.computeExecutionCurrentnessDigestV1(prepared.currentness);
        applicant.launch(fixture.profile, prepared.grantDigest, prepared.plan, prepared.currentness, prepared.intent);
        _assertGrantStatus(
            fixture.kernel, prepared.grantDigest, IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Consumed
        );
        (bool currentnessUsed, bool currentnessRevoked) = fixture.kernel.currentnessStatusV1(currentnessDigest);
        require(currentnessUsed && !currentnessRevoked, "currentness not consumed");
        require(!_tryLaunch(applicant, fixture.profile, prepared), "consumed launch replayed");
    }

    function testSuspensionIsTerminalAndOldCurrentnessCannotRevive() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("suspension"), bytes32(uint256(406)), 4600 ether);
        fixture.governance
            .setProfileStatus(fixture.kernel, PROFILE_KEY, IProgrammableUniversalLaunchKernelV1.ProfileStatus.Suspended);
        require(!_tryLaunch(applicant, fixture.profile, prepared), "suspended profile launched");
        (bool revived,) = address(fixture.governance)
            .call(
                abi.encodeCall(
                    UniversalTestAuthorityV1.setProfileStatus,
                    (fixture.kernel, PROFILE_KEY, IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active)
                )
            );
        require(!revived, "suspended profile revived");
    }

    function testKillClearRequiresAllControlAxesAndOldGrantStaysStale() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("kill-control"), bytes32(uint256(407)), 4700 ether);
        fixture.governance.setGlobalKill(fixture.kernel, true);
        require(!_tryLaunch(applicant, fixture.profile, prepared), "killed kernel launched");

        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory incomplete = _control();
        incomplete.reviewGeneration = 2;
        incomplete.reviewGenerationHash = keccak256("review-generation-v2");
        incomplete.globalKilled = false;
        (bool incompleteClear,) = address(fixture.governance)
            .call(abi.encodeCall(UniversalTestAuthorityV1.advanceControl, (fixture.kernel, incomplete)));
        require(!incompleteClear, "partial kill clear accepted");

        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory next = _nextControl();
        fixture.governance.advanceControl(fixture.kernel, next);
        require(!_tryLaunch(applicant, fixture.profile, prepared), "old grant revived after control advance");
    }

    function testRevokedGrantCannotLaunch() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("revoked"), bytes32(uint256(408)), 4800 ether);
        fixture.reviewer.revokeGrant(fixture.kernel, prepared.grantDigest);
        require(!_tryLaunch(applicant, fixture.profile, prepared), "revoked grant launched");
        _assertGrantStatus(
            fixture.kernel, prepared.grantDigest, IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Revoked
        );
    }

    function testAtomicPreflightRejectsRuntimeAndVacancyDrift() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("preflight-negative"), bytes32(uint256(409)), 4900 ether);
        (bool wrongKernel,) = address(fixture.preflight)
            .staticcall(
                abi.encodeCall(
                    ProgrammableUniversalLaunchPreflightV1.atomicPreflightHashV1,
                    (
                        address(fixture.kernel),
                        keccak256("wrong-kernel-runtime"),
                        prepared.grantDigest,
                        prepared.reservations
                    )
                )
            );
        require(!wrongKernel, "wrong kernel runtime preflighted");
        prepared.reservations[prepared.reservations.length - 1].expectedManagerRuntimeCodeHash =
            keccak256("wrong-manager-runtime");
        (bool wrongManager,) = address(fixture.preflight)
            .staticcall(
                abi.encodeCall(
                    ProgrammableUniversalLaunchPreflightV1.atomicPreflightHashV1,
                    (
                        address(fixture.kernel),
                        address(fixture.kernel).codehash,
                        prepared.grantDigest,
                        prepared.reservations
                    )
                )
            );
        require(!wrongManager, "wrong manager runtime preflighted");
    }

    function testAtomicPreflightRejectsExternallyOccupiedPool() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared = _prepareLaunch(
            fixture, applicant, keccak256("external-pool-occupation"), bytes32(uint256(419)), 5900 ether
        );
        fixture.poolManager.initialize(prepared.plan.action.poolId);
        require(
            !_tryLaunch(applicant, fixture.profile, prepared),
            "externally occupied pool passed signed profile preflight"
        );
        _assertGrantStatus(
            fixture.kernel, prepared.grantDigest, IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Active
        );
    }

    function testCrossPlanPoolCollisionFailsBeforeProviderCall() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicantOne = new UniversalApplicantWalletV1();
        PreparedLaunch memory first =
            _prepareLaunch(fixture, applicantOne, keccak256("pool-owner"), bytes32(uint256(410)), 5000 ether);
        applicantOne.launch(fixture.profile, first.grantDigest, first.plan, first.currentness, first.intent);

        UniversalApplicantWalletV1 applicantTwo = new UniversalApplicantWalletV1();
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan =
            _plan(fixture, applicantTwo, keccak256("pool-collider"), bytes32(uint256(411)), 5100 ether);
        plan.action.poolId = first.plan.action.poolId;
        plan.expectedPoolStateHash = keccak256(abi.encode(plan.action.poolManager, plan.action.poolId));
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = _grantForPlan(fixture, applicantTwo, plan);
        bytes32 grantDigest = fixture.kernel.activateLaunchGrantV1(grant, hex"01");
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations =
            fixture.profile.nestedFactoryReservationsV1(plan);
        (bool success,) = address(fixture.preflight)
            .staticcall(
                abi.encodeCall(
                    ProgrammableUniversalLaunchPreflightV1.atomicPreflightHashV1,
                    (address(fixture.kernel), address(fixture.kernel).codehash, grantDigest, reservations)
                )
            );
        require(!success, "occupied pool preflighted");
    }

    function testProviderReturndataBombRollsBackGrantAndReservations() external {
        Fixture memory fixture = _fixtureWithProvider(3, false);
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        PreparedLaunch memory prepared =
            _prepareLaunch(fixture, applicant, keccak256("returndata-bomb"), bytes32(uint256(412)), 5200 ether);
        require(!_tryLaunch(applicant, fixture.profile, prepared), "returndata bomb launched");
        _assertGrantStatus(
            fixture.kernel, prepared.grantDigest, IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Active
        );
        (, bytes32 exclusiveGrantDigest, bytes32 sharedIdentityHash) =
            fixture.kernel.reservationOccupantsV1(prepared.reservations[0]);
        require(exclusiveGrantDigest == bytes32(0) && sharedIdentityHash == bytes32(0), "reservation leaked");
        require(fixture.kernel.activeExecutionGrantDigestV1() == bytes32(0), "execution lock leaked");
    }

    function testProviderCannotMutateControlDuringExecution() external {
        Fixture memory fixture = _fixtureWithProvider(0, true);
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        bytes32 grantDigest =
            _launch(fixture, applicant, keccak256("control-reentrancy"), bytes32(uint256(413)), 5300 ether);
        require(grantDigest != bytes32(0), "launch failed");
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control = fixture.kernel.controlStateV1();
        require(control.securityEpoch == 1 && control.reviewGeneration == 1, "control mutated mid execution");
    }

    function testProxyAndMutableDependencyBindingsFailClosed() external {
        Fixture memory fixture = _fixture();
        bytes32 bindingHash = keccak256("adversarial-runtime-binding");
        UniversalDelegateProxyDependencyV1 proxy =
            new UniversalDelegateProxyDependencyV1(address(fixture.provider), bindingHash);
        bool proxyAccepted;
        try new ProgrammableNestedFactoryProfileV1(
            fixture.kernel,
            address(fixture.kernel).codehash,
            address(proxy),
            address(proxy).codehash,
            address(fixture.verifier),
            address(fixture.verifier).codehash,
            fixture.verifier.runtimeBindingHashV1(),
            keccak256("PROXY_PROFILE"),
            bindingHash,
            2_000_000,
            500_000
        ) returns (
            ProgrammableNestedFactoryProfileV1
        ) {
            proxyAccepted = true;
        } catch { }
        require(!proxyAccepted, "delegate proxy dependency accepted");

        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory proxyDescriptor =
            fixture.kernel.profileDescriptorV1(PROFILE_KEY);
        proxyDescriptor.profileKey = keccak256("PROXY_MODULE_PROFILE");
        proxyDescriptor.module = address(proxy);
        proxyDescriptor.moduleRuntimeCodeHash = address(proxy).codehash;
        proxyDescriptor.providerBindingHash = bindingHash;
        (bool proxyRegistered,) = address(fixture.governance)
            .call(abi.encodeCall(UniversalTestAuthorityV1.registerProfile, (fixture.kernel, proxyDescriptor)));
        require(!proxyRegistered, "delegate proxy module registered");

        UniversalStatefulDependencyV1 stateful = new UniversalStatefulDependencyV1(bindingHash);
        bool statefulAccepted;
        try new ProgrammableNestedFactoryProfileV1(
            fixture.kernel,
            address(fixture.kernel).codehash,
            address(stateful),
            address(stateful).codehash,
            address(fixture.verifier),
            address(fixture.verifier).codehash,
            fixture.verifier.runtimeBindingHashV1(),
            keccak256("STATEFUL_PROFILE"),
            bindingHash,
            2_000_000,
            500_000
        ) returns (
            ProgrammableNestedFactoryProfileV1
        ) {
            statefulAccepted = true;
        } catch { }
        require(!statefulAccepted, "mutable dependency accepted");
    }

    function testClosedRuntimeScannerContinuesPastInvalidDelimiter() external {
        ProgrammableUniversalLaunchPreflightV1 preflight = new ProgrammableUniversalLaunchPreflightV1();
        bytes32 bindingHash = keccak256("reachable-delegatecall-after-invalid");
        bytes memory runtime = abi.encodePacked(
            hex"5f3560e01c63",
            IProgrammableRuntimeBindingV1.runtimeBindingHashV1.selector,
            hex"14601c57601256fe5b5f5f5f5f5f5ff450005b7f",
            bindingHash,
            hex"5f5260205ff3"
        );
        address dependency = address(new UniversalRawRuntimeDependencyV1(runtime));

        (bool accepted,) = address(preflight)
            .staticcall(
                abi.encodeCall(
                    ProgrammableUniversalLaunchPreflightV1.closedRuntimeBindingHashV1,
                    (dependency, dependency.codehash, bindingHash, true)
                )
            );
        require(!accepted, "delegatecall after INVALID accepted");
    }

    function testClosedRuntimeScannerRejectsTransientStorageOpcodes() external {
        ProgrammableUniversalLaunchPreflightV1 preflight = new ProgrammableUniversalLaunchPreflightV1();
        bytes32 bindingHash = keccak256("transient-storage-runtime-binding");
        bytes memory tloadRuntime = abi.encodePacked(
            hex"5f3560e01c63",
            IProgrammableRuntimeBindingV1.runtimeBindingHashV1.selector,
            hex"14601757601256fe5b5f5c50005b7f",
            bindingHash,
            hex"5f5260205ff3"
        );
        address tloadDependency = address(new UniversalRawRuntimeDependencyV1(tloadRuntime));
        bytes memory tstoreRuntime = abi.encodePacked(
            hex"5f3560e01c63",
            IProgrammableRuntimeBindingV1.runtimeBindingHashV1.selector,
            hex"14601757601256fe5b5f5f5d005b7f",
            bindingHash,
            hex"5f5260205ff3"
        );
        address tstoreDependency = address(new UniversalRawRuntimeDependencyV1(tstoreRuntime));

        (bool tloadAccepted,) = address(preflight)
            .staticcall(
                abi.encodeCall(
                    ProgrammableUniversalLaunchPreflightV1.closedRuntimeBindingHashV1,
                    (tloadDependency, tloadDependency.codehash, bindingHash, true)
                )
            );
        (bool tstoreAccepted,) = address(preflight)
            .staticcall(
                abi.encodeCall(
                    ProgrammableUniversalLaunchPreflightV1.closedRuntimeBindingHashV1,
                    (tstoreDependency, tstoreDependency.codehash, bindingHash, true)
                )
            );
        require(!tloadAccepted, "TLOAD dependency accepted");
        require(!tstoreAccepted, "TSTORE dependency accepted");
    }

    function testZeroRevenuePolicyAndPlanFailClosed() external {
        Fixture memory fixture = _fixture();
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            fixture.kernel.profileDescriptorV1(PROFILE_KEY);
        descriptor.profileKey = keccak256("ZERO_REVENUE_PROFILE");
        descriptor.revenuePolicyHash = bytes32(0);
        (bool registered,) = address(fixture.governance)
            .call(abi.encodeCall(UniversalTestAuthorityV1.registerProfile, (fixture.kernel, descriptor)));
        require(!registered, "zero revenue policy registered");

        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan =
            _plan(fixture, applicant, keccak256("zero-revenue-plan"), bytes32(uint256(415)), 5500 ether);
        plan.expectedRevenueStateHash = bytes32(0);
        IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant = _grantForPlan(fixture, applicant, plan);
        bytes32 grantDigest = fixture.kernel.activateLaunchGrantV1(grant, hex"01");
        IProgrammableUniversalLaunchKernelV1.ReservationV1[] memory reservations =
            fixture.profile.nestedFactoryReservationsV1(plan);
        bytes32 kernelPreflightHash = fixture.preflight
            .atomicPreflightHashV1(address(fixture.kernel), address(fixture.kernel).codehash, grantDigest, reservations);
        bytes32 profilePreflightHash = fixture.profile.computeNestedFactoryPreflightHashV1(plan);
        IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 memory currentness = _currentness(
            grantDigest,
            grant.planHash,
            keccak256("zero-revenue-currentness"),
            kernelPreflightHash,
            profilePreflightHash
        );
        IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1 memory intent =
            IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1({
                grantDigest: grantDigest,
                stampLaunchId: grant.stampLaunchId,
                antiReplayNonce: grant.antiReplayNonce,
                profileModule: address(fixture.profile),
                intentNonce: keccak256("zero-revenue-wallet-intent"),
                validAfter: uint64(block.timestamp),
                deadline: uint64(block.timestamp + 300)
            });
        (bool launched, bytes memory reason) = address(applicant)
            .call(
                abi.encodeCall(
                    UniversalApplicantWalletV1.launch, (fixture.profile, grantDigest, plan, currentness, intent)
                )
            );
        require(
            !launched && _revertSelector(reason) == ProgrammableNestedFactoryProfileV1.InvalidField.selector,
            "zero revenue plan reached provider"
        );
        _assertGrantStatus(fixture.kernel, grantDigest, IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus.Active);
    }

    function testFinalityAndIndexingAppendAreTypedAndOrdered() external {
        Fixture memory fixture = _fixture();
        UniversalApplicantWalletV1 applicant = new UniversalApplicantWalletV1();
        bytes32 grantDigest = _launch(fixture, applicant, keccak256("finality"), bytes32(uint256(414)), 5400 ether);
        IProgrammableUniversalLaunchKernelV1.CanonicalLaunchReceiptV1 memory receipt =
            fixture.kernel.canonicalLaunchReceiptV1(grantDigest);
        IProgrammableUniversalLaunchKernelV1.FinalityIndexingReceiptV1 memory append =
            IProgrammableUniversalLaunchKernelV1.FinalityIndexingReceiptV1({
                grantDigest: grantDigest,
                stampLaunchId: receipt.stampLaunchId,
                receiptCoreHash: receipt.receiptCoreHash,
                transactionHash: keccak256("launch-transaction"),
                blockNumber: 100,
                blockHash: keccak256("launch-block"),
                finalizedAt: 101,
                deploymentReceiptHash: keccak256("deployment-receipt"),
                sourceVerificationReceiptHash: keccak256("source-verification"),
                indexingReceiptHash: bytes32(0),
                status: IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Finalized
            });
        IProgrammableUniversalLaunchKernelV1.FinalityIndexingReceiptV1 memory invalidFinality = append;
        invalidFinality.indexingReceiptHash = keccak256("premature-indexing");
        (bool prematureIndexing,) = address(fixture.kernel)
            .call(
                abi.encodeCall(ProgrammableUniversalLaunchKernelV1.appendFinalityIndexingV1, (invalidFinality, hex"01"))
            );
        require(!prematureIndexing, "finality accepted indexing payload");
        append.indexingReceiptHash = bytes32(0);
        fixture.kernel.appendFinalityIndexingV1(append, hex"01");
        receipt = fixture.kernel.canonicalLaunchReceiptV1(grantDigest);
        require(receipt.status == IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Finalized, "not finalized");
        bytes32 finalizedAppendHash = receipt.finalityIndexingReceiptHash;
        append.status = IProgrammableUniversalLaunchKernelV1.ReceiptStatus.IndexedPublished;
        append.indexingReceiptHash = keccak256("indexing-receipt");
        IProgrammableUniversalLaunchKernelV1.FinalityIndexingReceiptV1 memory poisonedIndex = append;
        poisonedIndex.transactionHash = keccak256("contradictory-transaction");
        (bool poisoned,) = address(fixture.kernel)
            .call(
                abi.encodeCall(ProgrammableUniversalLaunchKernelV1.appendFinalityIndexingV1, (poisonedIndex, hex"01"))
            );
        require(!poisoned, "indexer replaced finality baseline");
        append.transactionHash = keccak256("launch-transaction");
        fixture.kernel.appendFinalityIndexingV1(append, hex"01");
        receipt = fixture.kernel.canonicalLaunchReceiptV1(grantDigest);
        require(receipt.status == IProgrammableUniversalLaunchKernelV1.ReceiptStatus.IndexedPublished, "not indexed");
        require(
            receipt.finalityIndexingReceiptHash != bytes32(0)
                && receipt.finalityIndexingReceiptHash != finalizedAppendHash,
            "append head unchanged"
        );
        (bool replay,) = address(fixture.kernel)
            .call(abi.encodeCall(ProgrammableUniversalLaunchKernelV1.appendFinalityIndexingV1, (append, hex"01")));
        require(!replay, "finality replay accepted");
    }

    function _launch(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        bytes32 planTag,
        bytes32 salt,
        uint256 tokenSupply
    ) private returns (bytes32 grantDigest) {
        PreparedLaunch memory prepared = _prepareLaunch(fixture, applicant, planTag, salt, tokenSupply);
        grantDigest = prepared.grantDigest;
        bytes32 receiptHash =
            applicant.launch(fixture.profile, grantDigest, prepared.plan, prepared.currentness, prepared.intent);
        require(receiptHash != bytes32(0), "receipt hash");
        IProgrammableUniversalLaunchKernelV1.CanonicalLaunchReceiptV1 memory receipt =
            fixture.kernel.canonicalLaunchReceiptV1(grantDigest);
        require(receipt.status == IProgrammableUniversalLaunchKernelV1.ReceiptStatus.Executed, "receipt status");
        require(receipt.applicantWallet == address(applicant), "receipt applicant");
        require(receipt.planHash == prepared.grant.planHash, "receipt plan");
    }

    function _prepareLaunch(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        bytes32 planTag,
        bytes32 salt,
        uint256 tokenSupply
    ) private returns (PreparedLaunch memory prepared) {
        (prepared.plan, prepared.grant) = _planAndGrant(fixture, applicant, planTag, salt, tokenSupply);
        prepared.grantDigest = fixture.kernel.activateLaunchGrantV1(prepared.grant, hex"01");
        prepared.reservations = fixture.profile.nestedFactoryReservationsV1(prepared.plan);
        bytes32 preflightHash = fixture.preflight
            .atomicPreflightHashV1(
                address(fixture.kernel), address(fixture.kernel).codehash, prepared.grantDigest, prepared.reservations
            );
        bytes32 profilePreflightHash = fixture.profile.computeNestedFactoryPreflightHashV1(prepared.plan);
        prepared.currentness = _currentness(
            prepared.grantDigest,
            prepared.grant.planHash,
            keccak256(abi.encode(planTag, "currentness")),
            preflightHash,
            profilePreflightHash
        );
        prepared.intent = IProgrammableUniversalLaunchKernelV1.ApplicantWalletIntentV1({
            grantDigest: prepared.grantDigest,
            stampLaunchId: prepared.grant.stampLaunchId,
            antiReplayNonce: prepared.grant.antiReplayNonce,
            profileModule: address(fixture.profile),
            intentNonce: keccak256(abi.encode(planTag, "wallet-intent")),
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 300)
        });
    }

    function _tryLaunch(
        UniversalApplicantWalletV1 applicant,
        ProgrammableNestedFactoryProfileV1 profile,
        PreparedLaunch memory prepared
    ) private returns (bool success) {
        (success,) = address(applicant)
            .call(
                abi.encodeCall(
                    UniversalApplicantWalletV1.launch,
                    (profile, prepared.grantDigest, prepared.plan, prepared.currentness, prepared.intent)
                )
            );
    }

    function _revertSelector(bytes memory reason) private pure returns (bytes4 selector) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") {
            selector := mload(add(reason, 32))
        }
    }

    function _assertGrantStatus(
        ProgrammableUniversalLaunchKernelV1 kernel,
        bytes32 grantDigest,
        IProgrammableUniversalLaunchKernelV1.LaunchGrantStatus expected
    ) private view {
        IProgrammableUniversalLaunchKernelV1.LaunchGrantStateHeadV1 memory head =
            kernel.launchGrantStateHeadV1(grantDigest);
        require(head.status == expected, "grant status");
    }

    function _fixture() private returns (Fixture memory fixture) {
        return _fixtureWithProvider(0, false);
    }

    function _fixtureWithProvider(uint8 failureMode, bool mutateControl) private returns (Fixture memory fixture) {
        fixture.reviewer = new UniversalTestAuthorityV1();
        fixture.governance = new UniversalTestAuthorityV1();
        fixture.finality = new UniversalTestAuthorityV1();
        fixture.indexer = new UniversalTestAuthorityV1();
        fixture.verifier = new UniversalNestedVerifierV1();
        fixture.preflight = new ProgrammableUniversalLaunchPreflightV1();
        fixture.poolManager = new UniversalPoolManagerV1();
        IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory control = _control();
        fixture.kernel = new ProgrammableUniversalLaunchKernelV1(
            address(fixture.reviewer),
            address(fixture.reviewer).codehash,
            address(fixture.governance),
            address(fixture.governance).codehash,
            address(fixture.finality),
            address(fixture.finality).codehash,
            address(fixture.indexer),
            address(fixture.indexer).codehash,
            address(fixture.preflight),
            address(fixture.preflight).codehash,
            control
        );
        fixture.provider = new UniversalNestedProviderV1(
            PROVIDER_BINDING_HASH, failureMode, mutateControl ? address(fixture.governance) : address(0), fixture.kernel
        );
        bytes32 providerBindingHash = fixture.provider.runtimeBindingHashV1();
        bytes32 verifierBindingHash = fixture.verifier.runtimeBindingHashV1();
        fixture.profile = new ProgrammableNestedFactoryProfileV1(
            fixture.kernel,
            address(fixture.kernel).codehash,
            address(fixture.provider),
            address(fixture.provider).codehash,
            address(fixture.verifier),
            address(fixture.verifier).codehash,
            verifierBindingHash,
            PROFILE_KEY,
            providerBindingHash,
            2_000_000,
            500_000
        );
        IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1 memory descriptor =
            IProgrammableUniversalLaunchKernelV1.ProfileDescriptorV1({
                profileKey: PROFILE_KEY,
                schemaId: keccak256("NESTED_FACTORY_SCHEMA_V1"),
                profileVersion: 1,
                capabilitySemantics: IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute,
                module: address(fixture.profile),
                moduleRuntimeCodeHash: address(fixture.profile).codehash,
                actionTypeHash: fixture.profile.NESTED_FACTORY_PLAN_TYPEHASH(),
                exactContractBindingHash: CONTRACT_BINDING_HASH,
                providerBindingHash: providerBindingHash,
                revenuePolicyHash: REVENUE_POLICY_HASH,
                securityControlHeadHash: control.securityControlHeadHash,
                securityEpoch: control.securityEpoch,
                securityEpochHash: control.securityEpochHash,
                policyEpoch: control.policyEpoch,
                policyEpochHash: control.policyEpochHash,
                reviewGeneration: control.reviewGeneration,
                reviewGenerationHash: control.reviewGenerationHash,
                status: IProgrammableUniversalLaunchKernelV1.ProfileStatus.Active
            });
        fixture.governance.registerProfile(fixture.kernel, descriptor);
    }

    function _planAndGrant(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        bytes32 planTag,
        bytes32 salt,
        uint256 tokenSupply
    )
        private
        view
        returns (
            IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan,
            IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant
        )
    {
        plan = _plan(fixture, applicant, planTag, salt, tokenSupply);
        bytes32 planHash = fixture.profile.computeNestedFactoryPlanHashV1(plan);
        bytes32 antiReplayNonce = keccak256(abi.encode(planTag, "anti-replay"));
        grant = _grant(
            fixture,
            applicant,
            plan,
            planHash,
            plan.action.sourceLaunchId,
            antiReplayNonce,
            plan.action.configurationHash
        );
        grant.stampLaunchId = fixture.kernel.computeStampLaunchIdV1(grant);
    }

    function _grantForPlan(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan
    ) private view returns (IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant) {
        bytes32 planHash = fixture.profile.computeNestedFactoryPlanHashV1(plan);
        grant = _grant(
            fixture,
            applicant,
            plan,
            planHash,
            plan.action.sourceLaunchId,
            keccak256(abi.encode(planHash, "anti-replay-successor")),
            plan.action.configurationHash
        );
        grant.stampLaunchId = fixture.kernel.computeStampLaunchIdV1(grant);
    }

    function _plan(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        bytes32 planTag,
        bytes32 salt,
        uint256 tokenSupply
    ) private view returns (IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan) {
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 memory action =
            _action(fixture, applicant, planTag, salt, tokenSupply);
        address child = fixture.provider.childAddress(salt, action.tokenOwner, action.configurationHash);
        IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components =
            _components(fixture, action, child, salt);
        (bytes32 componentSetHash, bytes32 runtimeSetHash) = _componentHashes(components);
        plan.schemaVersion = 1;
        plan.action = action;
        plan.components = components;
        plan.componentGraphHash = keccak256(abi.encode(planTag, "graph"));
        plan.componentSetHash = componentSetHash;
        plan.componentRuntimeSetHash = runtimeSetHash;
        plan.expectedReturnedIdentitiesHash = keccak256(
            abi.encode(child, action.poolManager, action.poolId, action.tokenOwner, action.hookOwner, action.treasury)
        );
        plan.expectedArchitectureStateHash =
            keccak256(abi.encode(planTag, child, action.tokenOwner, action.hookOwner, action.treasury));
        plan.expectedPoolStateHash = keccak256(abi.encode(action.poolManager, action.poolId));
        plan.expectedRevenueStateHash = keccak256(abi.encode(action.treasury, action.configurationHash));
        plan.expectedValueFlowHash = keccak256(abi.encode(tokenSupply, uint256(0), action.treasury));
    }

    function _action(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        bytes32 planTag,
        bytes32 salt,
        uint256 tokenSupply
    ) private view returns (IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 memory action) {
        action.providerPlanId = planTag;
        action.factorySalt = salt;
        action.applicantWallet = address(applicant);
        action.sourceLaunchId = keccak256(abi.encode(planTag, "source-launch"));
        action.poolManager = address(fixture.poolManager);
        action.poolManagerRuntimeCodeHash = address(fixture.poolManager).codehash;
        action.poolId = keccak256(abi.encode(planTag, "pool"));
        action.tokenOwner = address(applicant);
        action.hookOwner = address(fixture.provider);
        action.treasury = address(0x22223333444455556666777788889999aaAaBBbB);
        action.tokenSupply = tokenSupply;
        action.nativeValue = 0;
        action.hookPermissionsHash = keccak256(abi.encode(planTag, "permissions"));
        action.configurationHash = keccak256(abi.encode(planTag, tokenSupply, "configuration"));
    }

    function _components(
        Fixture memory fixture,
        IProgrammableNestedFactoryProfileV1.NestedFactoryActionV1 memory action,
        address child,
        bytes32 salt
    ) private view returns (IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components) {
        components = new IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[](2);
        components[0] = IProgrammableNestedFactoryProfileV1.ComponentExpectationV1({
            role: 1,
            scope: IProgrammableNestedFactoryProfileV1.ComponentScopeV1.ExclusiveCreate,
            account: child,
            runtimeCodeHash: keccak256(type(UniversalNestedChildV1).runtimeCode),
            creationProvenanceHash: keccak256(abi.encode(address(fixture.provider), salt, action.configurationHash)),
            ownershipBindingHash: keccak256(abi.encode(action.tokenOwner)),
            configurationHash: action.configurationHash
        });
        components[1] = IProgrammableNestedFactoryProfileV1.ComponentExpectationV1({
            role: 2,
            scope: IProgrammableNestedFactoryProfileV1.ComponentScopeV1.SharedInfrastructure,
            account: address(fixture.provider),
            runtimeCodeHash: address(fixture.provider).codehash,
            creationProvenanceHash: keccak256("shared-provider-provenance"),
            ownershipBindingHash: keccak256("shared-provider-ownerless"),
            configurationHash: fixture.provider.runtimeBindingHashV1()
        });
    }

    function _grant(
        Fixture memory fixture,
        UniversalApplicantWalletV1 applicant,
        IProgrammableNestedFactoryProfileV1.NestedFactoryPlanV1 memory plan,
        bytes32 planHash,
        bytes32 sourceLaunchId,
        bytes32 antiReplayNonce,
        bytes32 configurationHash
    ) private view returns (IProgrammableUniversalLaunchKernelV1.LaunchGrantV1 memory grant) {
        grant = IProgrammableUniversalLaunchKernelV1.LaunchGrantV1({
            schemaVersion: 1,
            applicantWallet: address(applicant),
            applicantIdHash: keccak256(abi.encode(address(applicant), "applicant")),
            profileKey: PROFILE_KEY,
            planHash: planHash,
            sourceRepoHash: keccak256("https://example.invalid/universal-nested"),
            sourceCommit: bytes20(keccak256(abi.encode(sourceLaunchId, "commit"))),
            sourceTree: bytes20(keccak256(abi.encode(sourceLaunchId, "tree"))),
            sourceLaunchId: sourceLaunchId,
            stampLaunchId: bytes32(uint256(1)),
            antiReplayNonce: antiReplayNonce,
            componentGraphHash: plan.componentGraphHash,
            componentRuntimeSetHash: plan.componentRuntimeSetHash,
            configurationHash: configurationHash,
            builderEvidenceHash: keccak256(abi.encode(sourceLaunchId, "builder")),
            reviewerAttestationHash: keccak256(abi.encode(sourceLaunchId, "reviewer")),
            exactContractBindingHash: CONTRACT_BINDING_HASH,
            providerBindingHash: fixture.provider.runtimeBindingHashV1(),
            revenueBindingHash: REVENUE_POLICY_HASH,
            securityControlHeadHash: SECURITY_HEAD,
            securityEpoch: 1,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpoch: 1,
            policyEpochHash: POLICY_EPOCH_HASH,
            reviewGeneration: 1,
            reviewGenerationHash: REVIEW_GENERATION_HASH
        });
    }

    function _currentness(
        bytes32 grantDigest,
        bytes32 planHash,
        bytes32 nonce,
        bytes32 kernelPreflightHash,
        bytes32 profilePreflightHash
    ) private view returns (IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1 memory) {
        return IProgrammableUniversalLaunchKernelV1.ExecutionCurrentnessV1({
            grantDigest: grantDigest,
            profileKey: PROFILE_KEY,
            planHash: planHash,
            executionMode: IProgrammableUniversalLaunchKernelV1.CapabilitySemantics.Execute,
            kernelPreflightReadbackHash: kernelPreflightHash,
            profilePreflightReadbackHash: profilePreflightHash,
            dualProviderQuorumEvidenceHash: keccak256(abi.encode(nonce, "quorum")),
            simulationEvidenceHash: keccak256(abi.encode(nonce, "simulation")),
            serviceDeploymentBindingHash: keccak256(abi.encode(nonce, "service")),
            currentnessNonce: nonce,
            securityControlHeadHash: SECURITY_HEAD,
            securityEpoch: 1,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpoch: 1,
            policyEpochHash: POLICY_EPOCH_HASH,
            reviewGeneration: 1,
            reviewGenerationHash: REVIEW_GENERATION_HASH,
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 600)
        });
    }

    function _control() private pure returns (IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory) {
        return IProgrammableUniversalLaunchKernelV1.ControlStateV1({
            securityControlHeadHash: SECURITY_HEAD,
            securityEpoch: 1,
            securityEpochHash: SECURITY_EPOCH_HASH,
            policyEpoch: 1,
            policyEpochHash: POLICY_EPOCH_HASH,
            reviewGeneration: 1,
            reviewGenerationHash: REVIEW_GENERATION_HASH,
            globalKilled: false
        });
    }

    function _nextControl() private pure returns (IProgrammableUniversalLaunchKernelV1.ControlStateV1 memory) {
        return IProgrammableUniversalLaunchKernelV1.ControlStateV1({
            securityControlHeadHash: keccak256("universal-security-head-v2"),
            securityEpoch: 2,
            securityEpochHash: keccak256("universal-security-epoch-v2"),
            policyEpoch: 2,
            policyEpochHash: keccak256("universal-policy-epoch-v2"),
            reviewGeneration: 2,
            reviewGenerationHash: keccak256("universal-review-generation-v2"),
            globalKilled: false
        });
    }

    function _componentHashes(IProgrammableNestedFactoryProfileV1.ComponentExpectationV1[] memory components)
        private
        pure
        returns (bytes32 componentSetHash, bytes32 runtimeSetHash)
    {
        for (uint256 i; i < components.length; ++i) {
            IProgrammableNestedFactoryProfileV1.ComponentExpectationV1 memory component = components[i];
            bytes32 leaf = keccak256(
                abi.encode(
                    COMPONENT_TYPEHASH,
                    component.role,
                    uint8(component.scope),
                    component.account,
                    component.runtimeCodeHash,
                    component.creationProvenanceHash,
                    component.ownershipBindingHash,
                    component.configurationHash
                )
            );
            componentSetHash = keccak256(abi.encode(componentSetHash, i, component.role, component.account, leaf));
            runtimeSetHash = keccak256(
                abi.encode(runtimeSetHash, i, component.role, component.account, component.runtimeCodeHash)
            );
        }
    }
}
