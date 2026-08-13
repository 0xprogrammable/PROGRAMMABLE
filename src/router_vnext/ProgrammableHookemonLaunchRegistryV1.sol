// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    AccessControlDefaultAdminRules
} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    IProgrammableLaunchPermitAuthorityV1
} from "../../dependencies/shards-launch-permit-8afe4548553b406bd0374b3a8958f1a186104b11/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { IProgrammableHookemonLaunchRegistryV1 } from "./IProgrammableHookemonLaunchRegistryV1.sol";

/// @title ProgrammableHookemonLaunchRegistryV1
/// @notice General Registry successor for reusable Hookemon releases using the frozen shared permit Authority.
/// @dev Only the immutable release route can register. The exact durable Authority consumption replaces any
///      per-launch Registry approval transaction and is rechecked in the same block as registration. The Registry
///      does not self-reference the route runtime hash: the shared Authority release binding pins that deployed
///      extcodehash after both Registry and route exist, avoiding an undeployable Registry/profile hash cycle.
contract ProgrammableHookemonLaunchRegistryV1 is IProgrammableHookemonLaunchRegistryV1, AccessControlDefaultAdminRules {
    using SafeCast for uint256;

    uint16 private constant REGISTRATION_SCHEMA_VERSION = 1;
    bytes32 public constant override WRITER_ROLE = keccak256("programmable.hookemon-launch-registry.writer.v1");
    bytes32 private constant TECHNICAL_APPROVAL_TYPEHASH = keccak256(
        "HookemonTechnicalApprovalV1(uint64 githubRepositoryId,bytes32 repositoryKey,bytes32 approvalId,bytes32 technicalApprovalHash,bytes32 approvedRepositoryHeadHash,bytes32 executableArtifactSourceHash,bytes32 exactContractBindingHash)"
    );
    bytes32 private constant JIT_LAUNCH_IDENTITY_TYPEHASH = keccak256(
        "HookemonJitLaunchIdentityV1(bytes32 launchId,address applicantWallet,bytes32 descriptorHash,bytes32 tokenNameHash,bytes32 tokenSymbolHash,bytes32 presentationBindingHash,bytes32 configurationHash,bytes32 executionPlanHash,bytes32 executionCoreHash,bytes32 executionCalldataKeccak256,bytes32 releaseBindingHash)"
    );
    bytes32 private constant HOOKEMON_GRAPH_TYPEHASH = keccak256(
        "HookemonGraphV1(address executor,bytes32 executorRuntimeCodeHash,address launcher,bytes32 launcherRuntimeCodeHash,address token,bytes32 tokenRuntimeCodeHash,address hook,bytes32 hookRuntimeCodeHash,address poolManager,bytes32 poolManagerRuntimeCodeHash,bytes32 canonicalPoolId,bytes32 componentGraphHash,bytes32 componentRuntimeSetHash,bytes32 architectureStateHash,bytes32 poolStateHash,bytes32 revenueStateHash,bytes32 revenueBindingHash)"
    );
    bytes32 private constant REGISTERED_RECORD_TYPEHASH = keccak256(
        "HookemonRegisteredRecordV1(uint16 schemaVersion,uint256 chainId,uint64 registryGeneration,uint64 approvalGeneration,uint64 permitGeneration,uint256 permitNonce,bytes32 permitDigest,bytes32 routeId,bytes32 profileId,bytes32 technicalApprovalHash,bytes32 jitLaunchIdentityHash,bytes32 hookemonGraphHash)"
    );
    bytes32 private constant RUNTIME_BINDING_TYPEHASH = keccak256(
        "HookemonLaunchRegistryBindingV1(uint256 chainId,address registry,uint64 registryGeneration,bytes32 chainProfileHash,address launchPermitAuthority,bytes32 launchPermitAuthorityRuntimeCodeHash,address route,bytes32 routeId,bytes32 profileId,bytes32 hookemonRevenueBindingHash)"
    );

    address public immutable override LAUNCH_PERMIT_AUTHORITY;
    bytes32 public immutable LAUNCH_PERMIT_AUTHORITY_RUNTIME_CODE_HASH;
    uint64 public immutable override REGISTRY_GENERATION;
    bytes32 public immutable override CHAIN_PROFILE_HASH;
    address public immutable override LAUNCH_ROUTE;
    bytes32 public immutable ROUTE_ID;
    bytes32 public immutable PROFILE_ID;
    bytes32 public immutable HOOKEMON_REVENUE_BINDING_HASH;
    bytes32 private immutable _runtimeBindingHash;

    uint64 public registrationCount;
    mapping(bytes32 launchId => LaunchStateV1 state) private _launchStates;
    mapping(bytes32 approvalId => TechnicalApprovalStateV1 state) private _technicalApprovalStates;
    mapping(bytes32 launchId => JitLaunchIdentityV1 identity) private _launchIdentityStates;
    mapping(bytes32 launchId => HookemonGraphV1 graph) private _hookemonGraphStates;
    mapping(bytes32 repositoryKey => bytes32 launchId) public override launchIdByRepositoryKey;
    mapping(bytes32 permitDigest => bytes32 launchId) public override launchIdByPermitDigest;
    mapping(bytes32 componentGraphHash => bytes32 launchId) public override launchIdByComponentGraphHash;
    mapping(bytes32 launchId => bytes32 repositoryKey) public override repositoryKeyByLaunchId;

    error InvalidBinding(bytes32 field);
    error RuntimeCodeHashMismatch(address account, bytes32 expected, bytes32 actual);
    error PermitNotConsumed(bytes32 permitDigest);
    error RepositoryAlreadyRegistered(bytes32 repositoryKey, bytes32 launchId);
    error LaunchAlreadyRegistered(bytes32 launchId);
    error PermitAlreadyRegistered(bytes32 permitDigest, bytes32 launchId);
    error ApprovalAlreadyRegistered(bytes32 approvalId, bytes32 launchId);
    error GraphAlreadyRegistered(bytes32 componentGraphHash, bytes32 launchId);
    error WriterRoleRestricted(address account);

    struct DeploymentConfigV1 {
        uint48 initialAdminDelay;
        address initialAdmin;
        IProgrammableLaunchPermitAuthorityV1 launchPermitAuthority;
        bytes32 launchPermitAuthorityRuntimeCodeHash;
        uint64 registryGeneration;
        bytes32 chainProfileHash;
        address route;
        bytes32 routeId;
        bytes32 profileId;
        bytes32 hookemonRevenueBindingHash;
    }

    constructor(DeploymentConfigV1 memory config)
        AccessControlDefaultAdminRules(config.initialAdminDelay, config.initialAdmin)
    {
        if (
            config.initialAdmin == address(0) || config.initialAdmin == config.route
                || address(config.launchPermitAuthority) == address(0) || config.registryGeneration == 0
                || config.chainProfileHash == bytes32(0) || config.route == address(0) || config.routeId == bytes32(0)
                || config.profileId == bytes32(0) || config.hookemonRevenueBindingHash == bytes32(0)
        ) revert InvalidBinding(bytes32("deployment"));
        _requireRuntime(address(config.launchPermitAuthority), config.launchPermitAuthorityRuntimeCodeHash);
        LAUNCH_PERMIT_AUTHORITY = address(config.launchPermitAuthority);
        LAUNCH_PERMIT_AUTHORITY_RUNTIME_CODE_HASH = config.launchPermitAuthorityRuntimeCodeHash;
        REGISTRY_GENERATION = config.registryGeneration;
        CHAIN_PROFILE_HASH = config.chainProfileHash;
        LAUNCH_ROUTE = config.route;
        ROUTE_ID = config.routeId;
        PROFILE_ID = config.profileId;
        HOOKEMON_REVENUE_BINDING_HASH = config.hookemonRevenueBindingHash;
        _runtimeBindingHash = keccak256(
            abi.encode(
                RUNTIME_BINDING_TYPEHASH,
                block.chainid,
                address(this),
                config.registryGeneration,
                config.chainProfileHash,
                address(config.launchPermitAuthority),
                config.launchPermitAuthorityRuntimeCodeHash,
                config.route,
                config.routeId,
                config.profileId,
                config.hookemonRevenueBindingHash
            )
        );
        _grantRole(WRITER_ROLE, config.route);
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControlDefaultAdminRules) returns (bool) {
        return
            interfaceId == type(IProgrammableHookemonLaunchRegistryV1).interfaceId
                || super.supportsInterface(interfaceId);
    }

    function registerLaunchFromConsumedPermitV1(LaunchRegistrationV1 calldata registration)
        external
        override
        onlyRole(WRITER_ROLE)
    {
        _requireDependencies();
        _validateRegistration(registration);
        bytes32 recordCommitment = computeRegisteredRecordCommitmentV1(registration);
        if (registration.registeredRecordCommitment != recordCommitment) {
            revert InvalidBinding(bytes32("registered-record"));
        }
        _requireUnregistered(
            registration.technicalApproval.repositoryKey,
            registration.launchIdentity.launchId,
            registration.permitDigest,
            registration.technicalApproval.approvalId,
            registration.graph.componentGraphHash
        );
        IProgrammableLaunchPermitAuthorityV1.RepositoryConsumptionV1 memory consumption = IProgrammableLaunchPermitAuthorityV1(
                LAUNCH_PERMIT_AUTHORITY
            ).repositoryConsumption(registration.technicalApproval.repositoryKey);
        if (consumption.consumedAtBlock != block.number) revert PermitNotConsumed(registration.permitDigest);
        if (
            consumption.githubRepositoryId != registration.technicalApproval.githubRepositoryId
                || consumption.approvalGeneration != registration.approvalGeneration
                || consumption.permitGeneration != registration.permitGeneration
                || consumption.nonce != registration.permitNonce
                || consumption.permitDigest != registration.permitDigest
                || consumption.launchId != registration.launchIdentity.launchId
                || consumption.routeId != registration.routeId || consumption.route != LAUNCH_ROUTE
                || consumption.applicantWallet != registration.launchIdentity.applicantWallet
        ) revert InvalidBinding(bytes32("authority-consumption"));

        uint64 observedAtBlock = block.number.toUint64();
        bytes32 launchId = registration.launchIdentity.launchId;
        _launchStates[launchId] = LaunchStateV1({
            registered: true,
            observedAtBlock: observedAtBlock,
            githubRepositoryId: registration.technicalApproval.githubRepositoryId,
            approvalGeneration: registration.approvalGeneration,
            permitGeneration: registration.permitGeneration,
            permitNonce: registration.permitNonce,
            repositoryKey: registration.technicalApproval.repositoryKey,
            permitDigest: registration.permitDigest,
            approvalId: registration.technicalApproval.approvalId,
            technicalApprovalHash: registration.technicalApproval.technicalApprovalHash,
            routeId: registration.routeId,
            profileId: registration.profileId,
            applicantWallet: registration.launchIdentity.applicantWallet,
            registeredRecordCommitment: recordCommitment
        });
        _technicalApprovalStates[registration.technicalApproval.approvalId] =
            TechnicalApprovalStateV1({ launchId: launchId, approval: registration.technicalApproval });
        _launchIdentityStates[launchId] = registration.launchIdentity;
        _hookemonGraphStates[launchId] = registration.graph;
        launchIdByRepositoryKey[registration.technicalApproval.repositoryKey] = launchId;
        launchIdByPermitDigest[registration.permitDigest] = launchId;
        launchIdByComponentGraphHash[registration.graph.componentGraphHash] = launchId;
        repositoryKeyByLaunchId[launchId] = registration.technicalApproval.repositoryKey;
        registrationCount += 1;
        emit HookemonLaunchRegisteredV1(
            launchId,
            registration.technicalApproval.repositoryKey,
            registration.permitDigest,
            registration.launchIdentity.applicantWallet,
            registration.graph.componentGraphHash,
            recordCommitment,
            registration.graph.revenueBindingHash,
            observedAtBlock
        );
    }

    function computeRepositoryKey(uint64 githubRepositoryId) public pure override returns (bytes32 repositoryKey) {
        if (githubRepositoryId == 0) revert InvalidBinding(bytes32("github-repository-id"));
        return keccak256(abi.encode("programmable.github.repository.v1", uint256(githubRepositoryId)));
    }

    function computeRegisteredRecordCommitmentV1(LaunchRegistrationV1 calldata registration)
        public
        pure
        override
        returns (bytes32 registeredRecordCommitment)
    {
        return keccak256(
            abi.encode(
                REGISTERED_RECORD_TYPEHASH,
                registration.schemaVersion,
                registration.chainId,
                registration.registryGeneration,
                registration.approvalGeneration,
                registration.permitGeneration,
                registration.permitNonce,
                registration.permitDigest,
                registration.routeId,
                registration.profileId,
                computeTechnicalApprovalCommitmentV1(registration.technicalApproval),
                computeJitLaunchIdentityCommitmentV1(registration.launchIdentity),
                keccak256(abi.encode(HOOKEMON_GRAPH_TYPEHASH, registration.graph))
            )
        );
    }

    function computeTechnicalApprovalCommitmentV1(TechnicalApprovalV1 calldata technicalApproval)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(TECHNICAL_APPROVAL_TYPEHASH, technicalApproval));
    }

    function computeJitLaunchIdentityCommitmentV1(JitLaunchIdentityV1 calldata launchIdentity)
        public
        pure
        override
        returns (bytes32)
    {
        return keccak256(abi.encode(JIT_LAUNCH_IDENTITY_TYPEHASH, launchIdentity));
    }

    function launchState(bytes32 launchId) external view override returns (LaunchStateV1 memory) {
        return _launchStates[launchId];
    }

    function technicalApprovalState(bytes32 approvalId)
        external
        view
        override
        returns (TechnicalApprovalStateV1 memory)
    {
        return _technicalApprovalStates[approvalId];
    }

    function launchIdentityState(bytes32 launchId) external view override returns (JitLaunchIdentityV1 memory) {
        return _launchIdentityStates[launchId];
    }

    function hookemonGraphState(bytes32 launchId) external view override returns (HookemonGraphV1 memory) {
        return _hookemonGraphStates[launchId];
    }

    function runtimeBindingHashV1() external view override returns (bytes32) {
        return _runtimeBindingHash;
    }

    function hasRole(bytes32 role, address account)
        public
        view
        override(AccessControl, IAccessControl, IProgrammableHookemonLaunchRegistryV1)
        returns (bool)
    {
        return super.hasRole(role, account);
    }

    function _validateRegistration(LaunchRegistrationV1 calldata registration) private view {
        TechnicalApprovalV1 calldata technical = registration.technicalApproval;
        JitLaunchIdentityV1 calldata identity = registration.launchIdentity;
        HookemonGraphV1 calldata graph = registration.graph;
        if (
            registration.schemaVersion != REGISTRATION_SCHEMA_VERSION || registration.chainId != block.chainid
                || registration.registryGeneration != REGISTRY_GENERATION || registration.approvalGeneration == 0
                || registration.permitGeneration == 0 || registration.permitDigest == bytes32(0)
                || registration.routeId != ROUTE_ID || registration.profileId != PROFILE_ID
        ) revert InvalidBinding(bytes32("registration-scope"));
        if (
            technical.githubRepositoryId == 0
                || technical.repositoryKey != computeRepositoryKey(technical.githubRepositoryId)
                || technical.approvalId == bytes32(0) || technical.technicalApprovalHash == bytes32(0)
                || technical.approvedRepositoryHeadHash == bytes32(0)
                || technical.executableArtifactSourceHash == bytes32(0)
                || technical.exactContractBindingHash == bytes32(0)
        ) revert InvalidBinding(bytes32("technical-approval"));
        if (
            identity.launchId == bytes32(0) || identity.applicantWallet == address(0)
                || identity.descriptorHash == bytes32(0) || identity.tokenNameHash == bytes32(0)
                || identity.tokenSymbolHash == bytes32(0) || identity.presentationBindingHash == bytes32(0)
                || identity.configurationHash == bytes32(0) || identity.executionPlanHash == bytes32(0)
                || identity.executionCoreHash == bytes32(0) || identity.executionCalldataKeccak256 == bytes32(0)
                || identity.releaseBindingHash == bytes32(0)
        ) revert InvalidBinding(bytes32("jit-launch-identity"));
        if (
            graph.executor == address(0) || graph.executorRuntimeCodeHash == bytes32(0) || graph.launcher == address(0)
                || graph.launcherRuntimeCodeHash == bytes32(0) || graph.token == address(0)
                || graph.tokenRuntimeCodeHash == bytes32(0) || graph.hook == address(0)
                || graph.hookRuntimeCodeHash == bytes32(0) || graph.poolManager == address(0)
                || graph.poolManagerRuntimeCodeHash == bytes32(0) || graph.canonicalPoolId == bytes32(0)
                || graph.componentGraphHash == bytes32(0) || graph.componentRuntimeSetHash == bytes32(0)
                || graph.architectureStateHash == bytes32(0) || graph.poolStateHash == bytes32(0)
                || graph.revenueStateHash == bytes32(0) || graph.revenueBindingHash != HOOKEMON_REVENUE_BINDING_HASH
        ) revert InvalidBinding(bytes32("hookemon-graph"));
        if (
            graph.executor == graph.launcher || graph.executor == graph.token || graph.executor == graph.hook
                || graph.launcher == graph.token || graph.launcher == graph.hook || graph.token == graph.hook
        ) revert InvalidBinding(bytes32("component-collision"));
        _requireRuntime(graph.executor, graph.executorRuntimeCodeHash);
        _requireRuntime(graph.launcher, graph.launcherRuntimeCodeHash);
        _requireRuntime(graph.token, graph.tokenRuntimeCodeHash);
        _requireRuntime(graph.hook, graph.hookRuntimeCodeHash);
        _requireRuntime(graph.poolManager, graph.poolManagerRuntimeCodeHash);
    }

    function _requireUnregistered(
        bytes32 repositoryKey,
        bytes32 launchId,
        bytes32 permitDigest,
        bytes32 approvalId,
        bytes32 componentGraphHash
    ) private view {
        bytes32 existing = launchIdByRepositoryKey[repositoryKey];
        if (existing != bytes32(0)) revert RepositoryAlreadyRegistered(repositoryKey, existing);
        if (_launchStates[launchId].registered) revert LaunchAlreadyRegistered(launchId);
        existing = launchIdByPermitDigest[permitDigest];
        if (existing != bytes32(0)) revert PermitAlreadyRegistered(permitDigest, existing);
        existing = _technicalApprovalStates[approvalId].launchId;
        if (existing != bytes32(0)) revert ApprovalAlreadyRegistered(approvalId, existing);
        existing = launchIdByComponentGraphHash[componentGraphHash];
        if (existing != bytes32(0)) revert GraphAlreadyRegistered(componentGraphHash, existing);
    }

    function _requireDependencies() private view {
        if (msg.sender != LAUNCH_ROUTE) revert InvalidBinding(bytes32("route"));
        _requireRuntime(LAUNCH_PERMIT_AUTHORITY, LAUNCH_PERMIT_AUTHORITY_RUNTIME_CODE_HASH);
        if (LAUNCH_ROUTE.code.length == 0) revert InvalidBinding(bytes32("route-runtime"));
    }

    function _requireRuntime(address account, bytes32 expected) private view {
        bytes32 actual = account.codehash;
        if (account == address(0) || account.code.length == 0 || expected == bytes32(0) || actual != expected) {
            revert RuntimeCodeHashMismatch(account, expected, actual);
        }
    }

    function _grantRole(bytes32 role, address account) internal override returns (bool) {
        if (role == WRITER_ROLE && LAUNCH_ROUTE != address(0) && account != LAUNCH_ROUTE) {
            revert WriterRoleRestricted(account);
        }
        return super._grantRole(role, account);
    }
}
