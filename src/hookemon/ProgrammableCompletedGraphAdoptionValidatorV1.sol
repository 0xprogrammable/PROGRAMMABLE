// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IProgrammableCompletedGraphAdoptionCompatV1 } from "./IProgrammableCompletedGraphAdoptionCompatV1.sol";
import { ProgrammableCompletedGraphAdoptionCompatCodecV1 } from "./ProgrammableCompletedGraphAdoptionCompatCodecV1.sol";

/// @notice Stateless, codehash-pinnable validator for the closed completed-graph ADOPT ABI.
/// @dev It has no authority, storage mutations, deployment, target, selector, opaque action, or value surface.
///      The Registry calls its one fixed view function before reserving a canonical receipt.
contract ProgrammableCompletedGraphAdoptionValidatorV1 {
    uint256 public constant MAX_COMPONENTS = 24;
    uint256 public constant MAX_EDGES = 64;

    uint16 public constant IDENTITY_TOKEN = 1 << 0;
    uint16 public constant IDENTITY_HOOK = 1 << 1;
    uint16 public constant IDENTITY_NFT = 1 << 2;
    uint16 public constant IDENTITY_APPLICATION = 1 << 3;
    uint16 public constant IDENTITY_POOL = 1 << 4;
    uint16 public constant IDENTITY_MASK_ALL = (1 << 5) - 1;

    bytes32 public constant VALIDATOR_ID_HASH = keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_VALIDATOR_V1");

    ProgrammableCompletedGraphAdoptionCompatCodecV1 public immutable CODEC;
    bytes32 public immutable CODEC_RUNTIME_CODE_HASH;

    struct RoleScanV1 {
        bool tokenFound;
        bool hookFound;
        bool nftFound;
        bool applicationFound;
    }

    error InvalidBinding(uint8 field);

    constructor(address codec) {
        if (
            codec.code.length == 0
                || ProgrammableCompletedGraphAdoptionCompatCodecV1(codec).CODEC_ID_HASH()
                    != keccak256("PROGRAMMABLE_COMPLETED_GRAPH_ADOPTION_COMPAT_CODEC_V1")
        ) revert InvalidBinding(1);
        CODEC = ProgrammableCompletedGraphAdoptionCompatCodecV1(codec);
        CODEC_RUNTIME_CODE_HASH = codec.codehash;
    }

    function validateCompletedGraphV1(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges
    ) external view {
        if (registry == address(0)) revert InvalidBinding(2);
        _requireCodec();
        _validatePlanIdentitiesAndPool(plan);
        _validateComponents(registry, plan, components, edges);
    }

    function _validatePlanIdentitiesAndPool(
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan
    ) private pure {
        _validateIdentityBit(IDENTITY_TOKEN, plan.identityMask, plan.identities.token != address(0));
        _validateIdentityBit(IDENTITY_HOOK, plan.identityMask, plan.identities.hook != address(0));
        _validateIdentityBit(IDENTITY_NFT, plan.identityMask, plan.identities.nft != address(0));
        _validateIdentityBit(IDENTITY_APPLICATION, plan.identityMask, plan.identities.applicationHash != bytes32(0));
        if (plan.identityMask & ~IDENTITY_MASK_ALL != 0) revert InvalidBinding(3);

        bool hasPool = (plan.identityMask & IDENTITY_POOL) != 0;
        bool completePoolBinding = plan.poolManager != address(0) && plan.poolManagerRuntimeCodeHash != bytes32(0)
            && plan.poolId != bytes32(0) && plan.poolKeyHash != bytes32(0) && plan.poolResultHash != bytes32(0);
        if (hasPool != completePoolBinding) revert InvalidBinding(3);
        if (
            !hasPool
                && (plan.poolManager != address(0)
                    || plan.poolManagerRuntimeCodeHash != bytes32(0)
                    || plan.poolManagerComponentIndex != 0
                    || plan.poolId != bytes32(0)
                    || plan.poolKeyHash != bytes32(0)
                    || plan.poolResultHash != bytes32(0))
        ) revert InvalidBinding(3);
    }

    function _validateComponents(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges
    ) private view {
        if (components.length == 0 || components.length > MAX_COMPONENTS || edges.length > MAX_EDGES) {
            revert InvalidBinding(4);
        }
        if ((components.length == 1) != (edges.length == 0)) revert InvalidBinding(4);

        RoleScanV1 memory roles;
        roles.tokenFound = (plan.identityMask & IDENTITY_TOKEN) == 0;
        roles.hookFound = (plan.identityMask & IDENTITY_HOOK) == 0;
        roles.nftFound = (plan.identityMask & IDENTITY_NFT) == 0;
        roles.applicationFound = (plan.identityMask & IDENTITY_APPLICATION) == 0;

        address previous;
        for (uint256 i; i < components.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component = components[i];
            _validateComponent(registry, plan, component, i, previous);
            _captureRole(plan, component, roles);
            previous = component.account;
        }
        if (!roles.tokenFound || !roles.hookFound || !roles.nftFound || !roles.applicationFound) {
            revert InvalidBinding(5);
        }
        _validatePoolManagerComponent(plan, components);
        _validateEdges(components, edges);
        if (CODEC.computeComponentGraphHash(components, edges) != plan.componentGraphHash) revert InvalidBinding(5);
        if (CODEC.computeExactRuntimeSetHash(components) != plan.exactRuntimeSetHash) revert InvalidBinding(5);
        if (CODEC.computeComponentConfigurationSetHash(components) != plan.componentConfigurationSetHash) {
            revert InvalidBinding(5);
        }
        if (
            CODEC.computeConfigurationHash(
                        plan.componentGraphHash,
                        plan.componentConfigurationSetHash,
                        plan.policyHash,
                        plan.poolManager,
                        plan.poolManagerRuntimeCodeHash,
                        plan.poolKeyHash,
                        plan.architectureResultHash
                    ) != plan.configurationHash
                || CODEC.computeResultHash(
                        plan.componentGraphHash,
                        plan.configurationHash,
                        plan.architectureResultHash,
                        plan.poolResultHash,
                        plan.deploymentLineageHash
                    ) != plan.resultHash
        ) revert InvalidBinding(5);
    }

    function _validatePoolManagerComponent(
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components
    ) private view {
        if ((plan.identityMask & IDENTITY_POOL) == 0) return;
        if (
            plan.poolManager.code.length == 0 || plan.poolManager.codehash != plan.poolManagerRuntimeCodeHash
                || plan.poolManagerComponentIndex >= components.length
        ) revert InvalidBinding(6);
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component =
            components[plan.poolManagerComponentIndex];
        if (
            component.account != plan.poolManager || component.runtimeCodeHash != plan.poolManagerRuntimeCodeHash
                || component.deploymentKind
                    != IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.ExternalCanonical
        ) revert InvalidBinding(6);
    }

    function _validateComponent(
        address registry,
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component,
        uint256 index,
        address previous
    ) private view {
        if (
            component.account == address(0) || component.account <= previous || component.account.code.length == 0
                || component.kind == IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Invalid
                || component.scope == IProgrammableCompletedGraphAdoptionCompatV1.ComponentScopeV1.Invalid
                || component.deploymentKind == IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.Invalid
                || component.runtimeCodeHash == bytes32(0) || component.configurationHash == bytes32(0)
                || component.creationEvidenceHash == bytes32(0)
                || component.account.codehash != component.runtimeCodeHash
                || CODEC.computeComponentConfigurationHash(component) != component.configurationHash
                || CODEC.computeComponentCreationEvidenceHash(registry, plan, index, component)
                    != component.creationEvidenceHash
        ) revert InvalidBinding(7);

        if (component.deploymentKind == IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.Create) {
            if (
                component.deployer == address(0) || component.createNonce == 0 || component.create2Salt != bytes32(0)
                    || component.initCodeHash == bytes32(0) || component.externalCanonicalIdHash != bytes32(0)
                    || _computeCreateAddress(component.deployer, component.createNonce) != component.account
            ) revert InvalidBinding(7);
        } else if (component.deploymentKind == IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.Create2) {
            if (
                component.deployer == address(0) || component.createNonce != 0 || component.initCodeHash == bytes32(0)
                    || component.externalCanonicalIdHash != bytes32(0)
                    || _computeCreate2Address(component.create2Salt, component.initCodeHash, component.deployer)
                        != component.account
            ) revert InvalidBinding(7);
        } else if (
            component.deploymentKind == IProgrammableCompletedGraphAdoptionCompatV1.DeploymentKindV1.ExternalCanonical
        ) {
            if (
                component.deployer != address(0) || component.createNonce != 0 || component.create2Salt != bytes32(0)
                    || component.initCodeHash != bytes32(0) || component.externalCanonicalIdHash == bytes32(0)
            ) revert InvalidBinding(7);
        } else {
            revert InvalidBinding(7);
        }
    }

    function _captureRole(
        IProgrammableCompletedGraphAdoptionCompatV1.CompletedGraphPlanV1 calldata plan,
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1 calldata component,
        RoleScanV1 memory roles
    ) private view {
        if (
            component.kind == IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Token
                && component.account == plan.identities.token
        ) {
            if (roles.tokenFound) revert InvalidBinding(8);
            roles.tokenFound = true;
        } else if (
            component.kind == IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Hook
                && component.account == plan.identities.hook
        ) {
            if (roles.hookFound) revert InvalidBinding(8);
            roles.hookFound = true;
        } else if (
            component.kind == IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Nft
                && component.account == plan.identities.nft
        ) {
            if (roles.nftFound) revert InvalidBinding(8);
            roles.nftFound = true;
        } else if (
            component.kind == IProgrammableCompletedGraphAdoptionCompatV1.ComponentKindV1.Application
                && CODEC.computeApplicationIdentityHash(component) == plan.identities.applicationHash
        ) {
            if (roles.applicationFound) revert InvalidBinding(8);
            roles.applicationFound = true;
        }
    }

    function _validateEdges(
        IProgrammableCompletedGraphAdoptionCompatV1.ComponentV1[] calldata components,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1[] calldata edges
    ) private pure {
        uint256 reachable = 1;
        for (uint256 i; i < edges.length; ++i) {
            IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1 calldata edge = edges[i];
            if (
                edge.fromIndex >= components.length || edge.toIndex >= components.length
                    || edge.fromIndex == edge.toIndex
                    || edge.kind == IProgrammableCompletedGraphAdoptionCompatV1.EdgeKindV1.Invalid
                    || edge.relationHash == bytes32(0) || (i != 0 && !_edgeLess(edges[i - 1], edge))
            ) revert InvalidBinding(9);
        }
        for (uint256 pass; pass < components.length; ++pass) {
            uint256 before = reachable;
            for (uint256 i; i < edges.length; ++i) {
                IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1 calldata edge = edges[i];
                if ((reachable & (uint256(1) << edge.fromIndex)) != 0) reachable |= uint256(1) << edge.toIndex;
            }
            if (reachable == before) break;
        }
        if (reachable != (uint256(1) << components.length) - 1) revert InvalidBinding(9);
    }

    function _edgeLess(
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1 calldata left,
        IProgrammableCompletedGraphAdoptionCompatV1.GraphEdgeV1 calldata right
    ) private pure returns (bool) {
        if (left.fromIndex != right.fromIndex) return left.fromIndex < right.fromIndex;
        if (left.toIndex != right.toIndex) return left.toIndex < right.toIndex;
        if (left.kind != right.kind) return uint8(left.kind) < uint8(right.kind);
        return uint256(left.relationHash) < uint256(right.relationHash);
    }

    function _validateIdentityBit(uint16 bit, uint16 mask, bool present) private pure {
        if (((mask & bit) != 0) != present) revert InvalidBinding(10);
    }

    function _computeCreate2Address(bytes32 salt, bytes32 initCodeHash, address deployer)
        private
        pure
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    function _computeCreateAddress(address deployer, uint64 nonce) private pure returns (address) {
        if (nonce == 0) {
            return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, hex"80")))));
        }
        if (nonce <= 0x7f) {
            // `nonce <= 0x7f` above proves this one-byte RLP value cannot truncate.
            // forge-lint: disable-next-line(unsafe-typecast)
            return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(uint8(nonce)))))));
        }
        uint256 nonceBytes;
        uint64 remaining = nonce;
        while (remaining != 0) {
            ++nonceBytes;
            remaining >>= 8;
        }
        bytes memory encodedNonce = new bytes(nonceBytes);
        remaining = nonce;
        for (uint256 i = nonceBytes; i != 0; --i) {
            // RLP serializes the low-order octet on each iteration, then shifts it away.
            // forge-lint: disable-next-line(unsafe-typecast)
            encodedNonce[i - 1] = bytes1(uint8(remaining));
            remaining >>= 8;
        }
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            // A uint64 nonce uses at most eight bytes, so this prefix is at most 0xe6.
                            // forge-lint: disable-next-line(unsafe-typecast)
                            bytes1(uint8(0xc0 + 22 + nonceBytes)),
                            bytes1(0x94),
                            deployer,
                            // `nonceBytes` is in [1, 8], so this prefix is at most 0x88.
                            // forge-lint: disable-next-line(unsafe-typecast)
                            bytes1(uint8(0x80 + nonceBytes)),
                            encodedNonce
                        )
                    )
                )
            )
        );
    }

    function _requireCodec() private view {
        if (address(CODEC).codehash != CODEC_RUNTIME_CODE_HASH) revert InvalidBinding(11);
    }
}
