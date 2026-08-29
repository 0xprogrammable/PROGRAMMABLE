// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { CoreV1 } from "../../src/core/CoreV1.sol";
import { EngineRevisionDescriptorV1, MarketDescriptorV1 } from "../../src/core/NativeIdentityV1.sol";
import { OpaqueEngineRequestV1, OpaqueEngineResponseV1 } from "../../src/interfaces/IReturnOnlyEngineV1.sol";
import {
    OpaqueBatchAccumulatorEngineFixture
} from "../../src/reference-engines/OpaqueBatchAccumulatorEngineFixture.sol";
import { OpaqueLifecycleEngineFixture } from "../../src/reference-engines/OpaqueLifecycleEngineFixture.sol";
import { CoreTestFixtures } from "../helpers/CoreTestFixtures.sol";

contract ReferenceEngineGeneralityTest is Test {
    CoreV1 internal core;
    OpaqueBatchAccumulatorEngineFixture internal batchEngine;
    OpaqueLifecycleEngineFixture internal lifecycleEngine;

    function setUp() external {
        core = new CoreV1(CoreTestFixtures.CONSTITUTION_ID, CoreTestFixtures.COLLECTOR);
        batchEngine = new OpaqueBatchAccumulatorEngineFixture();
        lifecycleEngine = new OpaqueLifecycleEngineFixture();
    }

    function test_materiallyDifferentOpaqueEnginesRegisterAndCreateMarketsThroughOnePath() external {
        bytes32 batchRevision = _register(address(batchEngine));
        bytes32 lifecycleRevision = _register(address(lifecycleEngine));
        bytes32 batchMarket = _createMarket(batchRevision, "batch fixture market");
        bytes32 lifecycleMarket = _createMarket(lifecycleRevision, "lifecycle fixture market");

        assertNotEq(batchRevision, lifecycleRevision);
        assertNotEq(batchMarket, lifecycleMarket);
        assertEq(core.marketDescriptor(batchMarket).engineRevisionId, batchRevision);
        assertEq(core.marketDescriptor(lifecycleMarket).engineRevisionId, lifecycleRevision);
    }

    function test_fixturesHaveDistinctEngineOwnedSemanticsButReturnNoProtectedProposal() external {
        bytes32[] memory items = new bytes32[](2);
        items[0] = keccak256("first item");
        items[1] = keccak256("second item");
        OpaqueEngineRequestV1 memory batchRequest = _request(abi.encode(items), keccak256("batch target"));
        OpaqueEngineResponseV1 memory batchResponse = batchEngine.proposeOpaque(batchRequest);

        bytes32 objectId = keccak256("lifecycle object");
        bytes32 nextState = keccak256("lifecycle state one");
        OpaqueEngineRequestV1 memory lifecycleRequest =
            _request(abi.encode(objectId, uint64(0), nextState), keccak256("lifecycle target"));
        OpaqueEngineResponseV1 memory lifecycleResponse = lifecycleEngine.proposeOpaque(lifecycleRequest);

        assertEq(batchResponse.proposal.length, 0);
        assertEq(lifecycleResponse.proposal.length, 0);
        assertNotEq(batchResponse.opaqueData, lifecycleResponse.opaqueData);
        assertEq(batchEngine.batchesByTarget(batchRequest.executionTargetId), 1);
        (uint64 revision, bytes32 stateCommitment) = lifecycleEngine.lifecycle(objectId);
        assertEq(revision, 1);
        assertEq(stateCommitment, nextState);
    }

    /// Threat: actor=registered Engines; authority=own state only; pre=two Markets; attempt=protected execute;
    /// expect=blocked; post=no Core authority.
    function test_registrationNeverGrantsEitherFixtureProtectedAuthority() external {
        bytes32 batchMarket = _createMarket(_register(address(batchEngine)), "batch authority test");
        bytes32 lifecycleMarket = _createMarket(_register(address(lifecycleEngine)), "lifecycle authority test");
        bytes memory expectedError =
            abi.encodeWithSelector(CoreV1.BlockedBySpec.selector, core.DEX_EVM_SPEC_PROTECTED_EXECUTION_GRAMMAR());

        vm.expectRevert(expectedError);
        core.executeProtected(abi.encode(batchMarket));
        vm.expectRevert(expectedError);
        core.executeProtected(abi.encode(lifecycleMarket));
    }

    function _register(address engine) private returns (bytes32) {
        EngineRevisionDescriptorV1 memory descriptor = CoreTestFixtures.engineDescriptor(core, engine);
        return core.registerEngineRevision(descriptor);
    }

    function _createMarket(bytes32 engineRevisionId, string memory fixtureName) private returns (bytes32) {
        MarketDescriptorV1 memory descriptor = CoreTestFixtures.marketDescriptor(engineRevisionId);
        descriptor.immutableParametersCommitment = keccak256(bytes(fixtureName));
        return core.createMarket(descriptor);
    }

    function _request(bytes memory actionPayload, bytes32 executionTargetId)
        private
        view
        returns (OpaqueEngineRequestV1 memory request)
    {
        request = OpaqueEngineRequestV1({
            coreDeploymentId: core.CORE_DEPLOYMENT_ID(),
            engineRevisionId: keccak256("direct fixture invocation"),
            marketId: keccak256("direct fixture market"),
            authorizationScopeId: keccak256("unfrozen binding-local scope"),
            sessionDigest: keccak256("fixture session"),
            executionTargetId: executionTargetId,
            actionPayloadDigest: keccak256(actionPayload),
            segmentIndex: 0,
            phase: 2,
            actionPayload: actionPayload
        });
    }
}
