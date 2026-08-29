// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1,
    NativeIdentityV1
} from "../../src/core/NativeIdentityV1.sol";

/// @notice Mutation matrix for only the frozen native identity fields.
/// @dev Portable Scope, Capability, Refund, and protected EIP-712 grammar are deliberately excluded.
contract AuthorityFieldMutationTest is Test {
    bytes32 internal constant ALTERNATE = bytes32(uint256(0xFE));
    address internal constant ALTERNATE_ADDRESS = address(0xFE);

    function test_coreIdentityMutatesForEveryFrozenField() external pure {
        uint256 chainId = 46_630;
        address core = address(0x1111);
        bytes32 constitution = bytes32(uint256(1));
        uint32 major = 1;
        address collector = address(0x2222);
        bytes32 baseline = NativeIdentityV1.coreDeploymentId(chainId, core, constitution, major, collector);

        assertNotEq(baseline, NativeIdentityV1.coreDeploymentId(chainId + 1, core, constitution, major, collector));
        assertNotEq(
            baseline, NativeIdentityV1.coreDeploymentId(chainId, ALTERNATE_ADDRESS, constitution, major, collector)
        );
        assertNotEq(baseline, NativeIdentityV1.coreDeploymentId(chainId, core, ALTERNATE, major, collector));
        assertNotEq(baseline, NativeIdentityV1.coreDeploymentId(chainId, core, constitution, major + 1, collector));
        assertNotEq(baseline, NativeIdentityV1.coreDeploymentId(chainId, core, constitution, major, ALTERNATE_ADDRESS));
    }

    function test_engineRevisionMutatesForEveryFrozenField() external pure {
        EngineRevisionDescriptorV1 memory descriptor = _engine();
        bytes32 baseline = NativeIdentityV1.engineRevisionId(descriptor);

        descriptor.chainId += 1;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.engine = ALTERNATE_ADDRESS;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.runtimeCodeHash = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.interfaceProfileId = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.selectorSetHash = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.codePolicyId = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.immutableConfigurationCommitment = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.dependencyPolicyCommitment = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
        descriptor = _engine();
        descriptor.capabilityProfileCommitment = ALTERNATE;
        _assertEngineMutation(baseline, descriptor);
    }

    function test_marketIdentityMutatesForEveryFrozenField() external pure {
        bytes32 coreDeploymentId = bytes32(uint256(10));
        MarketDescriptorV1 memory descriptor = _market();
        bytes32 baseline = NativeIdentityV1.marketId(coreDeploymentId, descriptor);

        assertNotEq(baseline, NativeIdentityV1.marketId(ALTERNATE, descriptor));
        descriptor.engineRevisionId = ALTERNATE;
        _assertMarketMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _market();
        descriptor.immutableParametersCommitment = ALTERNATE;
        _assertMarketMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _market();
        descriptor.domainAdmissionPolicyCommitment = ALTERNATE;
        _assertMarketMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _market();
        descriptor.assetAdmissionPolicyCommitment = ALTERNATE;
        _assertMarketMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _market();
        descriptor.requiredCapabilityProfileCommitment = ALTERNATE;
        _assertMarketMutation(baseline, coreDeploymentId, descriptor);
    }

    function test_domainRevisionMutatesForEveryFrozenField() external pure {
        bytes32 coreDeploymentId = bytes32(uint256(10));
        DomainRevisionDescriptorV1 memory descriptor = _domain();
        bytes32 baseline = NativeIdentityV1.domainRevisionId(coreDeploymentId, descriptor);

        assertNotEq(baseline, NativeIdentityV1.domainRevisionId(ALTERNATE, descriptor));
        descriptor.domainId = ALTERNATE;
        _assertDomainMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _domain();
        descriptor.admissionPolicyCommitment = ALTERNATE;
        _assertDomainMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _domain();
        descriptor.custodyProfileId = ALTERNATE;
        _assertDomainMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _domain();
        descriptor.exitProfileId = ALTERNATE;
        _assertDomainMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _domain();
        descriptor.authorityPolicyCommitment = ALTERNATE;
        _assertDomainMutation(baseline, coreDeploymentId, descriptor);
        descriptor = _domain();
        descriptor.immutableConfigurationCommitment = ALTERNATE;
        _assertDomainMutation(baseline, coreDeploymentId, descriptor);
    }

    function test_vaultIdentityMutatesForEveryFrozenTupleField() external pure {
        bytes32 coreDeploymentId = bytes32(uint256(10));
        bytes32 domainRevisionId = bytes32(uint256(11));
        bytes32 assetProfileId = bytes32(uint256(12));
        address nativeAsset = address(0x1234);
        bytes32 baseline = NativeIdentityV1.vaultId(coreDeploymentId, domainRevisionId, assetProfileId, nativeAsset);

        assertNotEq(baseline, NativeIdentityV1.vaultId(ALTERNATE, domainRevisionId, assetProfileId, nativeAsset));
        assertNotEq(baseline, NativeIdentityV1.vaultId(coreDeploymentId, ALTERNATE, assetProfileId, nativeAsset));
        assertNotEq(baseline, NativeIdentityV1.vaultId(coreDeploymentId, domainRevisionId, ALTERNATE, nativeAsset));
        assertNotEq(
            baseline, NativeIdentityV1.vaultId(coreDeploymentId, domainRevisionId, assetProfileId, ALTERNATE_ADDRESS)
        );
    }

    function test_protectedScopeAndEip712RemainUnfrozenAndExcluded() external {
        CoreV1 core = new CoreV1(keccak256("mutation matrix constitution"), address(0xC011EC70));
        assertEq(core.blockedSpecIssueId(10), core.DEX_EVM_SPEC_SCOPE_EIP712_BRIDGE());
        vm.expectRevert(
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR())
        );
        core.executeProtected(hex"00");
    }

    function _assertEngineMutation(bytes32 baseline, EngineRevisionDescriptorV1 memory descriptor) private pure {
        assertNotEq(baseline, NativeIdentityV1.engineRevisionId(descriptor));
    }

    function _assertMarketMutation(bytes32 baseline, bytes32 core, MarketDescriptorV1 memory descriptor) private pure {
        assertNotEq(baseline, NativeIdentityV1.marketId(core, descriptor));
    }

    function _assertDomainMutation(bytes32 baseline, bytes32 core, DomainRevisionDescriptorV1 memory descriptor)
        private
        pure
    {
        assertNotEq(baseline, NativeIdentityV1.domainRevisionId(core, descriptor));
    }

    function _engine() private pure returns (EngineRevisionDescriptorV1 memory descriptor) {
        descriptor = EngineRevisionDescriptorV1({
            chainId: 46_630,
            engine: address(0x3333),
            runtimeCodeHash: bytes32(uint256(1)),
            interfaceProfileId: bytes32(uint256(2)),
            selectorSetHash: bytes32(uint256(3)),
            codePolicyId: bytes32(uint256(4)),
            immutableConfigurationCommitment: bytes32(uint256(5)),
            dependencyPolicyCommitment: bytes32(uint256(6)),
            capabilityProfileCommitment: bytes32(uint256(7))
        });
    }

    function _market() private pure returns (MarketDescriptorV1 memory descriptor) {
        descriptor = MarketDescriptorV1({
            engineRevisionId: bytes32(uint256(1)),
            immutableParametersCommitment: bytes32(uint256(2)),
            domainAdmissionPolicyCommitment: bytes32(uint256(3)),
            assetAdmissionPolicyCommitment: bytes32(uint256(4)),
            requiredCapabilityProfileCommitment: bytes32(uint256(5))
        });
    }

    function _domain() private pure returns (DomainRevisionDescriptorV1 memory descriptor) {
        descriptor = DomainRevisionDescriptorV1({
            domainId: bytes32(uint256(1)),
            admissionPolicyCommitment: bytes32(uint256(2)),
            custodyProfileId: bytes32(uint256(3)),
            exitProfileId: bytes32(uint256(4)),
            authorityPolicyCommitment: bytes32(uint256(5)),
            immutableConfigurationCommitment: bytes32(uint256(6))
        });
    }
}
