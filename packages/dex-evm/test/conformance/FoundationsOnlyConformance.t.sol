// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import { DomainVaultV1 } from "../../src/core/DomainVaultV1.sol";
import {
    DomainRevisionDescriptorV1,
    EngineRevisionDescriptorV1,
    MarketDescriptorV1,
    NativeIdentityV1
} from "../../src/core/NativeIdentityV1.sol";
import { ProtocolAssessmentV1 } from "../../src/core/ProtocolAssessmentV1.sol";
import { IReturnOnlyEngineV1 } from "../../src/interfaces/IReturnOnlyEngineV1.sol";
import { AssessmentHarness } from "../helpers/AssessmentHarness.sol";

/// @notice Foundations-only binding-vector checks. This is not a portable Conformance Report or Binding Release.
contract FoundationsOnlyConformanceTest is Test {
    string internal vectors;
    AssessmentHarness internal assessment;
    CoreV1 internal core;

    function setUp() external {
        vectors = vm.readFile("binding/vectors/foundations-v1.json");
        assessment = new AssessmentHarness();
        core = new CoreV1(keccak256("foundations-only constitution"), address(0xC011EC70));
    }

    function test_bindingOwnedNativeIdentityVectorsMatchExactSolidityEncoding() external view {
        assertFalse(vm.parseJsonBool(vectors, ".portable_conformance_claim"));
        assertFalse(vm.parseJsonBool(vectors, ".binding_release_claim"));

        uint256 chainId = vm.parseJsonUint(vectors, ".identities.core.input.chain_id");
        address coreAddress = vm.parseJsonAddress(vectors, ".identities.core.input.core");
        bytes32 constitutionId = vm.parseJsonBytes32(vectors, ".identities.core.input.constitution_id");
        uint32 coreMajor = uint32(vm.parseJsonUint(vectors, ".identities.core.input.core_major"));
        address collector = vm.parseJsonAddress(vectors, ".identities.core.input.collector");
        bytes32 coreDeploymentId =
            NativeIdentityV1.coreDeploymentId(chainId, coreAddress, constitutionId, coreMajor, collector);
        assertEq(coreDeploymentId, vm.parseJsonBytes32(vectors, ".identities.core.expected_id"));

        EngineRevisionDescriptorV1 memory engine = EngineRevisionDescriptorV1({
            chainId: vm.parseJsonUint(vectors, ".identities.engine.input.chain_id"),
            engine: vm.parseJsonAddress(vectors, ".identities.engine.input.engine"),
            runtimeCodeHash: vm.parseJsonBytes32(vectors, ".identities.engine.input.runtime_code_hash"),
            interfaceProfileId: vm.parseJsonBytes32(vectors, ".identities.engine.input.interface_profile_id"),
            selectorSetHash: vm.parseJsonBytes32(vectors, ".identities.engine.input.selector_set_hash"),
            codePolicyId: vm.parseJsonBytes32(vectors, ".identities.engine.input.code_policy_id"),
            immutableConfigurationCommitment: vm.parseJsonBytes32(
                vectors, ".identities.engine.input.immutable_configuration_commitment"
            ),
            dependencyPolicyCommitment: vm.parseJsonBytes32(
                vectors, ".identities.engine.input.dependency_policy_commitment"
            ),
            capabilityProfileCommitment: vm.parseJsonBytes32(
                vectors, ".identities.engine.input.capability_profile_commitment"
            )
        });
        bytes32 engineRevisionId = NativeIdentityV1.engineRevisionId(engine);
        assertEq(engineRevisionId, vm.parseJsonBytes32(vectors, ".identities.engine.expected_id"));

        MarketDescriptorV1 memory market = MarketDescriptorV1({
            engineRevisionId: vm.parseJsonBytes32(vectors, ".identities.market.input.engine_revision_id"),
            immutableParametersCommitment: vm.parseJsonBytes32(
                vectors, ".identities.market.input.immutable_parameters_commitment"
            ),
            domainAdmissionPolicyCommitment: vm.parseJsonBytes32(
                vectors, ".identities.market.input.domain_admission_policy_commitment"
            ),
            assetAdmissionPolicyCommitment: vm.parseJsonBytes32(
                vectors, ".identities.market.input.asset_admission_policy_commitment"
            ),
            requiredCapabilityProfileCommitment: vm.parseJsonBytes32(
                vectors, ".identities.market.input.required_capability_profile_commitment"
            )
        });
        assertEq(
            NativeIdentityV1.marketId(
                vm.parseJsonBytes32(vectors, ".identities.market.input.core_deployment_id"), market
            ),
            vm.parseJsonBytes32(vectors, ".identities.market.expected_id")
        );

        DomainRevisionDescriptorV1 memory domain = DomainRevisionDescriptorV1({
            domainId: vm.parseJsonBytes32(vectors, ".identities.domain.input.domain_id"),
            admissionPolicyCommitment: vm.parseJsonBytes32(
                vectors, ".identities.domain.input.admission_policy_commitment"
            ),
            custodyProfileId: vm.parseJsonBytes32(vectors, ".identities.domain.input.custody_profile_id"),
            exitProfileId: vm.parseJsonBytes32(vectors, ".identities.domain.input.exit_profile_id"),
            authorityPolicyCommitment: vm.parseJsonBytes32(
                vectors, ".identities.domain.input.authority_policy_commitment"
            ),
            immutableConfigurationCommitment: vm.parseJsonBytes32(
                vectors, ".identities.domain.input.immutable_configuration_commitment"
            )
        });
        bytes32 domainRevisionId = NativeIdentityV1.domainRevisionId(
            vm.parseJsonBytes32(vectors, ".identities.domain.input.core_deployment_id"), domain
        );
        assertEq(domainRevisionId, vm.parseJsonBytes32(vectors, ".identities.domain.expected_id"));

        assertEq(
            NativeIdentityV1.vaultId(
                vm.parseJsonBytes32(vectors, ".identities.vault.input.core_deployment_id"),
                vm.parseJsonBytes32(vectors, ".identities.vault.input.domain_revision_id"),
                vm.parseJsonBytes32(vectors, ".identities.vault.input.asset_profile_id"),
                vm.parseJsonAddress(vectors, ".identities.vault.input.native_asset")
            ),
            vm.parseJsonBytes32(vectors, ".identities.vault.expected_id")
        );
    }

    function test_bindingOwnedConstantsMatchSource() external view {
        assertEq(vm.parseJsonBytes32(vectors, ".constants.runtime_id"), core.EVM_RUNTIME_ID());
        assertEq(
            vm.parseJsonBytes32(vectors, ".constants.return_only_interface_profile_id"),
            core.RETURN_ONLY_ENGINE_INTERFACE_PROFILE_ID()
        );
        assertEq(
            vm.parseJsonBytes32(vectors, ".constants.entry_code_policy_id"),
            core.ENTRY_RUNTIME_CODEHASH_ONLY_POLICY_ID()
        );
        assertEq(
            vm.parseJsonBytes32(vectors, ".constants.native_eth_asset_profile_id"), core.NATIVE_ETH_ASSET_PROFILE_ID()
        );
        assertEq(
            vm.parseJsonBytes32(vectors, ".constants.strict_measured_erc20_asset_profile_id"),
            core.STRICT_MEASURED_ERC20_ASSET_PROFILE_ID()
        );
        bytes memory selector = vm.parseJsonBytes(vectors, ".constants.return_only_selector");
        assertEq(selector, abi.encodePacked(IReturnOnlyEngineV1.proposeOpaque.selector));
        assertEq(
            vm.parseJsonBytes32(vectors, ".constants.return_only_selector_set_hash"),
            core.RETURN_ONLY_SELECTOR_SET_HASH()
        );
    }

    function test_domainVaultCreationCodeInitCodeAndCreate2AddressMatchCompiledSolidity() external view {
        bytes memory creationCode =
            vm.parseBytes(vm.trim(vm.readFile("binding/vectors/domain-vault-v1.creation-code.hex")));
        assertEq(creationCode, type(DomainVaultV1).creationCode);
        assertEq(creationCode.length, vm.parseJsonUint(vectors, ".vault_deployment.creation_code_bytes"));
        assertEq(keccak256(creationCode), vm.parseJsonBytes32(vectors, ".vault_deployment.creation_code_keccak256"));

        bytes32 coreDeploymentId = vm.parseJsonBytes32(vectors, ".identities.vault.input.core_deployment_id");
        bytes32 constitutionId = vm.parseJsonBytes32(vectors, ".identities.core.input.constitution_id");
        uint32 coreMajor = uint32(vm.parseJsonUint(vectors, ".identities.core.input.core_major"));
        address collector = vm.parseJsonAddress(vectors, ".identities.core.input.collector");
        bytes32 domainRevisionId = vm.parseJsonBytes32(vectors, ".identities.vault.input.domain_revision_id");
        bytes32 assetProfileId = vm.parseJsonBytes32(vectors, ".identities.vault.input.asset_profile_id");
        address nativeAsset = vm.parseJsonAddress(vectors, ".identities.vault.input.native_asset");
        bytes memory initCode = bytes.concat(
            creationCode,
            abi.encode(
                coreDeploymentId, constitutionId, coreMajor, collector, domainRevisionId, assetProfileId, nativeAsset
            )
        );
        assertEq(initCode.length, vm.parseJsonUint(vectors, ".vault_deployment.init_code_bytes"));
        assertEq(keccak256(initCode), vm.parseJsonBytes32(vectors, ".vault_deployment.init_code_keccak256"));

        bytes32 vaultId = NativeIdentityV1.vaultId(coreDeploymentId, domainRevisionId, assetProfileId, nativeAsset);
        assertEq(vaultId, vm.parseJsonBytes32(vectors, ".vault_deployment.salt"));
        address vectorDeployer = vm.parseJsonAddress(vectors, ".vault_deployment.core_deployer");
        address vectorExpected = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), vectorDeployer, vaultId, keccak256(initCode)))))
        );
        assertEq(vectorExpected, vm.parseJsonAddress(vectors, ".vault_deployment.expected_create2_address"));

        bytes32 deployedCoreId = core.CORE_DEPLOYMENT_ID();
        bytes32 deployedCoreVaultId =
            NativeIdentityV1.vaultId(deployedCoreId, domainRevisionId, assetProfileId, nativeAsset);
        bytes32 deployedCoreInitCodeHash = keccak256(
            bytes.concat(
                type(DomainVaultV1).creationCode,
                abi.encode(
                    deployedCoreId,
                    core.CONSTITUTION_ID(),
                    core.CORE_MAJOR(),
                    core.COLLECTOR(),
                    domainRevisionId,
                    assetProfileId,
                    nativeAsset
                )
            )
        );
        address deployedCoreExpected = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), address(core), deployedCoreVaultId, deployedCoreInitCodeHash)
                    )
                )
            )
        );
        assertEq(core.expectedDomainVault(domainRevisionId, assetProfileId, nativeAsset), deployedCoreExpected);
    }

    function test_bindingOwnedAssessmentVectorsMatchUnambiguousCumulativeFloor() external view {
        for (uint256 index = 0; index < 5; ++index) {
            string memory prefix = string.concat(".assessment_cases[", vm.toString(index), "]");
            uint128 basisBefore =
                uint128(vm.parseUint(vm.parseJsonString(vectors, string.concat(prefix, ".basis_before"))));
            uint128 fillBasis = uint128(vm.parseUint(vm.parseJsonString(vectors, string.concat(prefix, ".fill_basis"))));
            uint128 expectedAfter =
                uint128(vm.parseUint(vm.parseJsonString(vectors, string.concat(prefix, ".basis_after"))));
            uint128 expectedDelta =
                uint128(vm.parseUint(vm.parseJsonString(vectors, string.concat(prefix, ".assessment_delta"))));

            ProtocolAssessmentV1.Delta memory actual = assessment.applyBasisDelta(basisBefore, fillBasis);
            assertEq(actual.cumulativeBasisAfter, expectedAfter);
            assertEq(actual.assessmentDelta, expectedDelta);
        }
    }

    function test_draftProtocolAndProtectedExecutionRemainFailClosed() external {
        assertEq(vm.parseJsonString(vectors, ".protocol.status"), "draft");
        assertFalse(vm.parseJsonBool(vectors, ".protocol.production_eligible"));
        assertEq(vm.parseJsonString(vectors, ".protocol.protected_execution_status"), "BLOCKED_BY_SPEC");

        assertEq(
            core.KNOWN_BLOCKED_SPEC_ISSUE_COUNT(), vm.parseJsonUint(vectors, ".protocol.known_blocked_issue_count")
        );
        vm.expectRevert(
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR())
        );
        core.executeProtected(hex"00");
    }
}
