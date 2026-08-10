// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { Test } from "forge-std/Test.sol";
import { LibRLP } from "solady/utils/LibRLP.sol";

import { ProgrammableCompletedGraphAdoptionRouterV2_1 } from "../src/ProgrammableCompletedGraphAdoptionRouterV2_1.sol";
import {
    IProgrammableCompletedGraphAdoptionRouterV2_1
} from "../src/interfaces/IProgrammableCompletedGraphAdoptionRouterV2_1.sol";

contract CompletedGraphAuthorityV2_1Mock is IERC1271 {
    mapping(bytes32 digest => bool approved) private _approved;

    function setApproved(bytes32 digest, bool approved) external {
        _approved[digest] = approved;
    }

    function isValidSignature(bytes32 digest, bytes memory) external view returns (bytes4) {
        return _approved[digest] ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract CompletedGraphCapabilityAdminV2_1Mock {
    uint256 public registrationCount;

    function register(
        ProgrammableCompletedGraphAdoptionRouterV2_1 router,
        bytes32 profileIdHash,
        bytes32 profileVersionHash,
        bytes32 schemaHash,
        bytes32 policyHash
    ) external returns (bytes32 profileKey) {
        profileKey = router.registerCompletedGraphProfileV1(profileIdHash, profileVersionHash, schemaHash, policyHash);
        ++registrationCount;
    }
}

contract CompletedGraphParentRouterV2Mock {
    mapping(address component => bytes32 launchId) public launchIdByComponent;
    mapping(address token => bytes32 launchId) public launchIdByToken;
    mapping(bytes32 lookupKey => bytes32 launchId) private _launchIdByPool;

    function setComponentLaunchId(address component, bytes32 launchId) external {
        launchIdByComponent[component] = launchId;
    }

    function setTokenLaunchId(address token, bytes32 launchId) external {
        launchIdByToken[token] = launchId;
    }

    function setPoolLaunchId(address poolManager, bytes32 poolId, bytes32 launchId) external {
        _launchIdByPool[keccak256(abi.encode(poolManager, poolId))] = launchId;
    }

    function launchIdByPool(address poolManager, bytes32 poolId) external view returns (bytes32) {
        return _launchIdByPool[keccak256(abi.encode(poolManager, poolId))];
    }
}

contract CompletedGraphComponentV1Mock {
    uint256 public constant MARKER = 1;
}

/// @notice Fork coverage for the separately versioned, inactive normal-CREATE adoption candidate.
contract ProgrammableCompletedGraphAdoptionRouterV2_1Test is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant SNAPSHOT_BLOCK = 25_724_010;
    address internal constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bytes32 internal constant POOL_MANAGER_RUNTIME = 0x785f1014552b7ce7d5fb7d0c970ca60edee94fd00425d7ca21609acac7ce1293;
    uint160 internal constant START_SQRT_PRICE_X96 = 1 << 96;
    uint24 internal constant LP_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    struct ApplicantFixture {
        IProgrammableCompletedGraphAdoptionRouterV2_1.CompletedGraphPlanV1 plan;
        IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentV1[] components;
        IProgrammableCompletedGraphAdoptionRouterV2_1.GraphEdgeV1[] edges;
        IProgrammableCompletedGraphAdoptionRouterV2_1.StampRequestV2_1 request;
        IProgrammableCompletedGraphAdoptionRouterV2_1.LaunchPermitV2_1 permit;
        bytes32 launchId;
        bytes32 planHash;
    }

    CompletedGraphAuthorityV2_1Mock internal authority;
    CompletedGraphCapabilityAdminV2_1Mock internal admin;
    CompletedGraphParentRouterV2Mock internal parent;
    ProgrammableCompletedGraphAdoptionRouterV2_1 internal router;
    bytes32 internal policyHash;
    bytes internal componentRuntime;
    bytes32 internal componentRuntimeHash;

    function setUp() public {
        string memory rpc = vm.envOr("ETHEREUM_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, SNAPSHOT_BLOCK);
        assertEq(block.chainid, 1);
        assertEq(POOL_MANAGER.codehash, POOL_MANAGER_RUNTIME);

        authority = new CompletedGraphAuthorityV2_1Mock();
        admin = new CompletedGraphCapabilityAdminV2_1Mock();
        parent = new CompletedGraphParentRouterV2Mock();
        router = new ProgrammableCompletedGraphAdoptionRouterV2_1(address(authority), address(admin), address(parent));
        policyHash = keccak256("normal-create-policy-v1");
        admin.register(
            router,
            router.NORMAL_CREATE_ADOPTION_PROFILE_ID_HASH(),
            router.NORMAL_CREATE_ADOPTION_PROFILE_VERSION_HASH(),
            router.NORMAL_CREATE_ADOPTION_SCHEMA_HASH(),
            policyHash
        );

        CompletedGraphComponentV1Mock template = new CompletedGraphComponentV1Mock();
        componentRuntime = address(template).code;
        componentRuntimeHash = address(template).codehash;
    }

    function test_oneGovernanceRegistrationAdoptsTwoDistinctApplicantPlans() public {
        ApplicantFixture memory first = _fixture(address(0xA11CE), 10, "applicant-one");
        ApplicantFixture memory second = _fixture(address(0xB0B), 20, "applicant-two");
        assertEq(admin.registrationCount(), 1);
        assertTrue(first.planHash != second.planHash);
        assertTrue(first.plan.componentGraphHash != second.plan.componentGraphHash);

        _approveAndAdopt(first);
        _approveAndAdopt(second);

        assertEq(admin.registrationCount(), 1);
        IProgrammableCompletedGraphAdoptionRouterV2_1.StampRecordV2_1 memory firstRecord =
            router.launchStamp(first.launchId);
        IProgrammableCompletedGraphAdoptionRouterV2_1.StampRecordV2_1 memory secondRecord =
            router.launchStamp(second.launchId);
        assertEq(firstRecord.launchWallet, first.plan.launchWallet);
        assertEq(secondRecord.launchWallet, second.plan.launchWallet);
        assertEq(firstRecord.reviewAdmissionHash, first.plan.reviewAdmissionHash);
        assertEq(secondRecord.currentPoolStateHash, second.request.currentPoolStateHash);
        assertEq(uint8(firstRecord.executionMode), 4);
        assertEq(uint8(secondRecord.executionMode), 4);
        assertEq(router.launchIdByGraphHash(first.plan.componentGraphHash), first.launchId);
        assertEq(router.launchIdByGraphHash(second.plan.componentGraphHash), second.launchId);
        assertTrue(router.nonceUsed(first.plan.launchWallet, first.launchId));
        assertTrue(router.nonceUsed(second.plan.launchWallet, second.launchId));
    }

    function test_hashGoldenMatchesFrozenFixture() public {
        ApplicantFixture memory fixture = _fixture(address(0xA11CE), 10, "applicant-one");

        assertEq(
            router.computeProfileKey(fixture.plan.profileIdHash, fixture.plan.profileVersionHash),
            0xad64eb396cc1561852954187fbd55dff806ddcdf892d3c3fdf5aabd68b5f84be
        );
        assertEq(fixture.components[0].account, 0x22fe506a68E8965F6e3f4FD9ff0F39d093a27B53);
        assertEq(fixture.components[1].account, 0x76E3BE981B98A2de7e83622a2E696C778ba98429);
        assertEq(fixture.components[2].account, 0xce256071B01BeA76332a09F725edAE909E242134);
        assertEq(
            router.computePoolKeyHash(fixture.plan.poolKey),
            0x846d2438a39c0b1b919819cde3440f168548be8bb0ad8523de1acde33cbe3c87
        );
        assertEq(fixture.plan.componentGraphHash, 0x64c9b3b9ce6ca34237557eec0dc29de90dbd6a430b4f307ab7c38723d74fee12);
        assertEq(fixture.plan.configurationHash, 0xf31ecea88ab27ffd06202139d1267e4bbbd2a25beb0fab6e977290f80080d78c);
        assertEq(fixture.plan.poolResultHash, 0xc5796c08590b5227b779aa4086da99793a346e2f257356bc8f10ca88c560b643);
        assertEq(
            fixture.request.currentPoolStateHash, 0x9baa6bc84fc98f93f8ba46cc601c30e4d9fd94f9d1d857ef4e993231109be456
        );
        assertEq(fixture.plan.resultHash, 0x82fec3c3c4d95d1469e56ed45700b48b266459e075c85deb9f5c1846f4b3525b);
        assertEq(fixture.planHash, 0xff5ad0abe49053c017b41b7c3a0788d7a98d0a7d922f6db3ec3e4284882f26a7);
        assertEq(fixture.launchId, 0xb203a8449aeadda754b80f77849db6bc452125b957c4b3f99e34c173c473f553);
        assertEq(
            PoolId.unwrap(fixture.plan.poolKey.toId()),
            0xdef0cbf06fe84fc21c894d2796ac5dd19d27f8ef046114cd67eebfc72b106b21
        );
        assertEq(fixture.permit.stampRequestHash, 0x234f0611749ad6d465d0859266335c4cd1c9084965301f3e21f240dd9a3e5da2);
    }

    function test_registrationRejectsAnyOtherProfileOrSchemaAndIsAddOnly() public {
        (CompletedGraphCapabilityAdminV2_1Mock otherAdmin, ProgrammableCompletedGraphAdoptionRouterV2_1 otherRouter) =
            _newRouter();
        bytes32 exactProfileIdHash = otherRouter.NORMAL_CREATE_ADOPTION_PROFILE_ID_HASH();
        bytes32 exactProfileVersionHash = otherRouter.NORMAL_CREATE_ADOPTION_PROFILE_VERSION_HASH();
        bytes32 exactSchemaHash = otherRouter.NORMAL_CREATE_ADOPTION_SCHEMA_HASH();
        vm.expectRevert(abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 6));
        otherAdmin.register(
            otherRouter, keccak256("arbitrary-profile"), exactProfileVersionHash, exactSchemaHash, policyHash
        );
        vm.expectRevert(abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 6));
        otherAdmin.register(
            otherRouter, exactProfileIdHash, exactProfileVersionHash, keccak256("wrong-schema"), policyHash
        );
        otherAdmin.register(otherRouter, exactProfileIdHash, exactProfileVersionHash, exactSchemaHash, policyHash);
        bytes32 profileKey = otherRouter.computeProfileKey(exactProfileIdHash, exactProfileVersionHash);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCompletedGraphAdoptionRouterV2_1.ProfileAlreadyRegistered.selector, profileKey
            )
        );
        otherAdmin.register(otherRouter, exactProfileIdHash, exactProfileVersionHash, exactSchemaHash, policyHash);
    }

    function test_reviewAdmissionIsMandatoryAndPermitBound() public {
        ApplicantFixture memory fixture = _fixture(address(0xCAFE), 30, "review-admission");
        bytes32 originalPlanHash = fixture.planHash;
        fixture.plan.reviewAdmissionHash = keccak256("different-review-admission");
        fixture = _rebind(fixture);
        assertTrue(fixture.planHash != originalPlanHash);
        _approveAndAdopt(fixture);

        ApplicantFixture memory missing = _fixture(address(0xD00D), 40, "missing-review-admission");
        missing.plan.reviewAdmissionHash = bytes32(0);
        missing = _rebind(missing);
        authority.setApproved(router.permitDigest(missing.permit), true);
        vm.prank(missing.plan.launchWallet);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 7));
        router.adoptCompletedGraphV1(
            missing.permit, missing.plan, missing.request, missing.components, missing.edges, "approved"
        );
    }

    function test_poolDriftLeavesImmutablePlanHashStableAndStaleJitCurrentnessFailsBeforePermitConsumption() public {
        ApplicantFixture memory fixture = _fixture(address(0xF00D), 50, "pool-currentness");
        bytes32 immutablePlanHash = fixture.planHash;
        bytes32 staleDigest = router.permitDigest(fixture.permit);
        _writeSlot0(fixture.plan.poolKey, START_SQRT_PRICE_X96 + 1, 0, 0, LP_FEE);
        assertEq(router.computePlanHash(fixture.plan), immutablePlanHash);
        authority.setApproved(staleDigest, true);
        vm.prank(fixture.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 17)
        );
        router.adoptCompletedGraphV1(
            fixture.permit, fixture.plan, fixture.request, fixture.components, fixture.edges, "approved"
        );
        assertFalse(router.permitDigestUsed(staleDigest));
        assertFalse(router.nonceUsed(fixture.plan.launchWallet, fixture.launchId));

        fixture.request.currentPoolStateHash =
            router.computePoolStateHash(fixture.plan.poolKey, START_SQRT_PRICE_X96 + 1, 0, 0, LP_FEE);
        fixture = _rebind(fixture);
        bytes32 freshDigest = router.permitDigest(fixture.permit);
        assertEq(fixture.planHash, immutablePlanHash);
        assertTrue(freshDigest != staleDigest);
        assertEq(admin.registrationCount(), 1);
        _approveAndAdopt(fixture);
        assertTrue(router.permitDigestUsed(freshDigest));
        assertEq(router.launchStamp(fixture.launchId).currentPoolStateHash, fixture.request.currentPoolStateHash);
        assertEq(admin.registrationCount(), 1);
    }

    function test_parentTokenAndPoolCollisionsFailClosed() public {
        ApplicantFixture memory tokenCollision = _fixture(address(0x1010), 60, "token-collision");
        bytes32 priorLaunch = keccak256("prior-token-launch");
        parent.setTokenLaunchId(tokenCollision.components[0].account, priorLaunch);
        authority.setApproved(router.permitDigest(tokenCollision.permit), true);
        vm.prank(tokenCollision.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCompletedGraphAdoptionRouterV2_1.ComponentAlreadyStamped.selector,
                tokenCollision.components[0].account,
                priorLaunch
            )
        );
        router.adoptCompletedGraphV1(
            tokenCollision.permit,
            tokenCollision.plan,
            tokenCollision.request,
            tokenCollision.components,
            tokenCollision.edges,
            "approved"
        );

        ApplicantFixture memory poolCollision = _fixture(address(0x2020), 70, "pool-collision");
        bytes32 priorPoolLaunch = keccak256("prior-pool-launch");
        parent.setPoolLaunchId(POOL_MANAGER, PoolId.unwrap(poolCollision.plan.poolKey.toId()), priorPoolLaunch);
        authority.setApproved(router.permitDigest(poolCollision.permit), true);
        vm.prank(poolCollision.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCompletedGraphAdoptionRouterV2_1.PoolAlreadyStamped.selector,
                POOL_MANAGER,
                PoolId.unwrap(poolCollision.plan.poolKey.toId()),
                priorPoolLaunch
            )
        );
        router.adoptCompletedGraphV1(
            poolCollision.permit,
            poolCollision.plan,
            poolCollision.request,
            poolCollision.components,
            poolCollision.edges,
            "approved"
        );
    }

    function test_parentComponentCollisionFailsClosedBeforePermitConsumption() public {
        ApplicantFixture memory fixture = _fixture(address(0x2525), 75, "parent-component-collision");
        bytes32 priorLaunch = keccak256("prior-parent-component-launch");
        parent.setComponentLaunchId(fixture.components[2].account, priorLaunch);
        bytes32 digest = router.permitDigest(fixture.permit);
        authority.setApproved(digest, true);

        vm.prank(fixture.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(
                ProgrammableCompletedGraphAdoptionRouterV2_1.ComponentAlreadyStamped.selector,
                fixture.components[2].account,
                priorLaunch
            )
        );
        router.adoptCompletedGraphV1(
            fixture.permit, fixture.plan, fixture.request, fixture.components, fixture.edges, "approved"
        );

        assertFalse(router.permitDigestUsed(digest));
        assertFalse(router.nonceUsed(fixture.plan.launchWallet, fixture.launchId));
    }

    function test_createAddressRuntimeAndPoolBindingMutationsFailClosed() public {
        ApplicantFixture memory badAddress = _fixture(address(0x3030), 80, "bad-create-address");
        badAddress.components[0].account = address(0xDEAD);
        authority.setApproved(router.permitDigest(badAddress.permit), true);
        vm.prank(badAddress.plan.launchWallet);
        vm.expectPartialRevert(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidCreateAddress.selector);
        router.adoptCompletedGraphV1(
            badAddress.permit, badAddress.plan, badAddress.request, badAddress.components, badAddress.edges, "approved"
        );

        ApplicantFixture memory badRuntime = _fixture(address(0x4040), 90, "bad-runtime");
        vm.etch(badRuntime.components[1].account, hex"60006000fd");
        authority.setApproved(router.permitDigest(badRuntime.permit), true);
        vm.prank(badRuntime.plan.launchWallet);
        vm.expectPartialRevert(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidComponent.selector);
        router.adoptCompletedGraphV1(
            badRuntime.permit, badRuntime.plan, badRuntime.request, badRuntime.components, badRuntime.edges, "approved"
        );

        ApplicantFixture memory badPoolBinding = _fixture(address(0x5050), 100, "bad-pool-binding");
        badPoolBinding.edges[0].relationHash = keccak256("wrong-pool-binding");
        badPoolBinding = _rebindGraph(badPoolBinding);
        authority.setApproved(router.permitDigest(badPoolBinding.permit), true);
        vm.prank(badPoolBinding.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 14)
        );
        router.adoptCompletedGraphV1(
            badPoolBinding.permit,
            badPoolBinding.plan,
            badPoolBinding.request,
            badPoolBinding.components,
            badPoolBinding.edges,
            "approved"
        );
    }

    function test_zeroValueZeroAllowanceAndShortPermitAreHardCaps() public {
        ApplicantFixture memory allowance = _fixture(address(0x6060), 110, "allowance-cap");
        allowance.plan.allowanceCapsHash = keccak256("non-empty-allowance");
        allowance = _rebind(allowance);
        authority.setApproved(router.permitDigest(allowance.permit), true);
        vm.prank(allowance.plan.launchWallet);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 7));
        router.adoptCompletedGraphV1(
            allowance.permit, allowance.plan, allowance.request, allowance.components, allowance.edges, "approved"
        );

        ApplicantFixture memory value = _fixture(address(0x7070), 120, "native-value");
        value.permit.value = 1;
        authority.setApproved(router.permitDigest(value.permit), true);
        vm.deal(value.plan.launchWallet, 1);
        vm.prank(value.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 15)
        );
        router.adoptCompletedGraphV1{ value: 1 }(
            value.permit, value.plan, value.request, value.components, value.edges, "approved"
        );

        ApplicantFixture memory longPermit = _fixture(address(0x8080), 130, "long-permit");
        longPermit.permit.deadline = longPermit.permit.validAfter + 1 hours + 1;
        authority.setApproved(router.permitDigest(longPermit.permit), true);
        vm.prank(longPermit.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 16)
        );
        router.adoptCompletedGraphV1(
            longPermit.permit, longPermit.plan, longPermit.request, longPermit.components, longPermit.edges, "approved"
        );
    }

    function test_configurationPoolResultAndResultMutationsFailBeforePermitConsumption() public {
        ApplicantFixture memory badComponentConfiguration =
            _fixture(address(0x8081), 132, "bad-component-configuration");
        bytes32 componentConfigurationDigest = router.permitDigest(badComponentConfiguration.permit);
        badComponentConfiguration.components[1].configurationHash = keccak256("wrong-component-configuration");
        authority.setApproved(componentConfigurationDigest, true);
        vm.prank(badComponentConfiguration.plan.launchWallet);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 9));
        router.adoptCompletedGraphV1(
            badComponentConfiguration.permit,
            badComponentConfiguration.plan,
            badComponentConfiguration.request,
            badComponentConfiguration.components,
            badComponentConfiguration.edges,
            "approved"
        );
        assertFalse(router.permitDigestUsed(componentConfigurationDigest));

        ApplicantFixture memory badConfiguration = _fixture(address(0x8181), 135, "bad-configuration");
        bytes32 configurationDigest = router.permitDigest(badConfiguration.permit);
        badConfiguration.plan.configurationHash = keccak256("wrong-configuration");
        authority.setApproved(configurationDigest, true);
        vm.prank(badConfiguration.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 10)
        );
        router.adoptCompletedGraphV1(
            badConfiguration.permit,
            badConfiguration.plan,
            badConfiguration.request,
            badConfiguration.components,
            badConfiguration.edges,
            "approved"
        );
        assertFalse(router.permitDigestUsed(configurationDigest));

        ApplicantFixture memory badPoolResult = _fixture(address(0x8282), 145, "bad-pool-result");
        bytes32 poolResultDigest = router.permitDigest(badPoolResult.permit);
        badPoolResult.plan.poolResultHash = keccak256("wrong-pool-result");
        authority.setApproved(poolResultDigest, true);
        vm.prank(badPoolResult.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 11)
        );
        router.adoptCompletedGraphV1(
            badPoolResult.permit,
            badPoolResult.plan,
            badPoolResult.request,
            badPoolResult.components,
            badPoolResult.edges,
            "approved"
        );
        assertFalse(router.permitDigestUsed(poolResultDigest));

        ApplicantFixture memory badResult = _fixture(address(0x8383), 155, "bad-result");
        bytes32 resultDigest = router.permitDigest(badResult.permit);
        badResult.plan.resultHash = keccak256("wrong-result");
        authority.setApproved(resultDigest, true);
        vm.prank(badResult.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 12)
        );
        router.adoptCompletedGraphV1(
            badResult.permit, badResult.plan, badResult.request, badResult.components, badResult.edges, "approved"
        );
        assertFalse(router.permitDigestUsed(resultDigest));
    }

    function test_unapprovedErc1271PermitFailsClosedWithoutReplayConsumption() public {
        ApplicantFixture memory fixture = _fixture(address(0x8484), 165, "unapproved-permit");
        bytes32 digest = router.permitDigest(fixture.permit);

        vm.prank(fixture.plan.launchWallet);
        vm.expectRevert(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidPermitSignature.selector);
        router.adoptCompletedGraphV1(
            fixture.permit, fixture.plan, fixture.request, fixture.components, fixture.edges, "not-approved"
        );

        assertFalse(router.permitDigestUsed(digest));
        assertFalse(router.nonceUsed(fixture.plan.launchWallet, fixture.launchId));
    }

    function test_replayIsOneWinnerAndDoesNotConsumeOnFailedCurrentness() public {
        ApplicantFixture memory fixture = _fixture(address(0x9090), 140, "one-winner");
        bytes32 digest = router.permitDigest(fixture.permit);
        _approveAndAdopt(fixture);
        assertTrue(router.permitDigestUsed(digest));
        assertTrue(router.nonceUsed(fixture.plan.launchWallet, fixture.launchId));

        vm.prank(fixture.plan.launchWallet);
        vm.expectPartialRevert(ProgrammableCompletedGraphAdoptionRouterV2_1.ComponentAlreadyStamped.selector);
        router.adoptCompletedGraphV1(
            fixture.permit, fixture.plan, fixture.request, fixture.components, fixture.edges, "approved"
        );

        ApplicantFixture memory currentness = _fixture(address(0x9191), 150, "failed-currentness");
        bytes32 currentnessDigest = router.permitDigest(currentness.permit);
        _writeSlot0(currentness.plan.poolKey, START_SQRT_PRICE_X96 + 2, 0, 0, LP_FEE);
        authority.setApproved(currentnessDigest, true);
        vm.prank(currentness.plan.launchWallet);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableCompletedGraphAdoptionRouterV2_1.InvalidBinding.selector, 17)
        );
        router.adoptCompletedGraphV1(
            currentness.permit,
            currentness.plan,
            currentness.request,
            currentness.components,
            currentness.edges,
            "approved"
        );
        assertFalse(router.permitDigestUsed(currentnessDigest));
        assertFalse(router.nonceUsed(currentness.plan.launchWallet, currentness.launchId));
    }

    function testFuzz_planHashBindsReviewAdmissionButNotJitPoolState(bytes32 reviewHash, bytes32 poolStateHash) public {
        ApplicantFixture memory fixture = _fixture(address(0xA0A0), 160, "hash-fuzz");
        bytes32 baseline = fixture.planHash;
        fixture.request.currentPoolStateHash = poolStateHash;
        assertEq(router.computePlanHash(fixture.plan), baseline);
        if (reviewHash != fixture.plan.reviewAdmissionHash) {
            fixture.plan.reviewAdmissionHash = reviewHash;
            assertTrue(router.computePlanHash(fixture.plan) != baseline);
        }
    }

    function _fixture(address creator, uint64 nonceBase, string memory seed)
        private
        returns (ApplicantFixture memory fixture)
    {
        fixture.components = new IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentV1[](3);
        fixture.edges = new IProgrammableCompletedGraphAdoptionRouterV2_1.GraphEdgeV1[](2);

        address token = LibRLP.computeAddress(creator, nonceBase);
        address hook = LibRLP.computeAddress(creator, nonceBase + 1);
        address nft = LibRLP.computeAddress(creator, nonceBase + 2);
        vm.etch(token, componentRuntime);
        vm.etch(hook, componentRuntime);
        vm.etch(nft, componentRuntime);

        fixture.components[0] = _component(
            token, IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentKindV2_1.Token, nonceBase, seed, "token"
        );
        fixture.components[1] = _component(
            hook, IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentKindV2_1.Hook, nonceBase + 1, seed, "hook"
        );
        fixture.components[2] = _component(
            nft, IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentKindV2_1.Nft, nonceBase + 2, seed, "nft"
        );

        fixture.plan.profileIdHash = router.NORMAL_CREATE_ADOPTION_PROFILE_ID_HASH();
        fixture.plan.profileVersionHash = router.NORMAL_CREATE_ADOPTION_PROFILE_VERSION_HASH();
        fixture.plan.routeSchemaHash = router.NORMAL_CREATE_ADOPTION_SCHEMA_HASH();
        fixture.plan.sourceCommitHash = _hash(seed, "source-commit");
        fixture.plan.sourceTreeHash = _hash(seed, "source-tree");
        fixture.plan.manifestHash = _hash(seed, "manifest");
        fixture.plan.policyHash = policyHash;
        fixture.plan.reviewAdmissionHash = _hash(seed, "review-admission");
        fixture.plan.launchWallet = creator;
        fixture.plan.creator = creator;
        fixture.plan.creationEvidenceHash = _hash(seed, "creation-evidence-bundle");
        fixture.plan.poolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
        bytes32 poolKeyHash = router.computePoolKeyHash(fixture.plan.poolKey);
        fixture.edges[0] = IProgrammableCompletedGraphAdoptionRouterV2_1.GraphEdgeV1({
            fromIndex: 0,
            toIndex: 1,
            kind: IProgrammableCompletedGraphAdoptionRouterV2_1.EdgeKindV1.PoolBinds,
            relationHash: keccak256(abi.encode(router.POOL_BINDING_RELATION_TYPEHASH(), poolKeyHash))
        });
        fixture.edges[1] = IProgrammableCompletedGraphAdoptionRouterV2_1.GraphEdgeV1({
            fromIndex: 1,
            toIndex: 2,
            kind: IProgrammableCompletedGraphAdoptionRouterV2_1.EdgeKindV1.Mints,
            relationHash: _hash(seed, "hook-mints-nft")
        });
        fixture.plan.componentGraphHash = router.computeComponentGraphHash(creator, fixture.components, fixture.edges);
        fixture.plan.configurationHash =
            router.computeConfigurationHash(fixture.plan.componentGraphHash, policyHash, poolKeyHash);
        fixture.plan.initializedSqrtPriceX96 = START_SQRT_PRICE_X96;
        fixture.plan.poolInitializationEvidenceHash = _hash(seed, "pool-initialization-evidence");
        fixture.plan.poolResultHash = router.computePoolResultHash(
            fixture.plan.poolKey, fixture.plan.initializedSqrtPriceX96, fixture.plan.poolInitializationEvidenceHash
        );
        _writeSlot0(fixture.plan.poolKey, START_SQRT_PRICE_X96, 0, 0, LP_FEE);
        fixture.request.currentPoolStateHash =
            router.computePoolStateHash(fixture.plan.poolKey, START_SQRT_PRICE_X96, 0, 0, LP_FEE);
        fixture.plan.resultHash = router.computeResultHash(
            fixture.plan.componentGraphHash, fixture.plan.configurationHash, fixture.plan.poolResultHash
        );
        fixture.plan.maxNativeValueWei = 0;
        fixture.plan.allowanceCapsHash = router.EMPTY_ALLOWANCE_CAPS_HASH();
        fixture = _rebind(fixture);
    }

    function _rebindGraph(ApplicantFixture memory fixture) private view returns (ApplicantFixture memory) {
        fixture.plan.componentGraphHash =
            router.computeComponentGraphHash(fixture.plan.creator, fixture.components, fixture.edges);
        bytes32 poolKeyHash = router.computePoolKeyHash(fixture.plan.poolKey);
        fixture.plan.configurationHash =
            router.computeConfigurationHash(fixture.plan.componentGraphHash, fixture.plan.policyHash, poolKeyHash);
        fixture.plan.resultHash = router.computeResultHash(
            fixture.plan.componentGraphHash, fixture.plan.configurationHash, fixture.plan.poolResultHash
        );
        return _rebind(fixture);
    }

    function _rebind(ApplicantFixture memory fixture) private view returns (ApplicantFixture memory) {
        fixture.planHash = router.computePlanHash(fixture.plan);
        bytes32 profileKey = router.computeProfileKey(fixture.plan.profileIdHash, fixture.plan.profileVersionHash);
        fixture.launchId = router.computeLaunchId(fixture.plan.launchWallet, profileKey, fixture.planHash);
        fixture.request = IProgrammableCompletedGraphAdoptionRouterV2_1.StampRequestV2_1({
            launchId: fixture.launchId,
            profileKey: profileKey,
            componentGraphHash: fixture.plan.componentGraphHash,
            poolId: PoolId.unwrap(fixture.plan.poolKey.toId()),
            poolKeyHash: router.computePoolKeyHash(fixture.plan.poolKey),
            resultHash: fixture.plan.resultHash,
            currentPoolStateHash: fixture.request.currentPoolStateHash
        });
        fixture.permit = IProgrammableCompletedGraphAdoptionRouterV2_1.LaunchPermitV2_1({
            chainId: 1,
            router: address(router),
            launchWallet: fixture.plan.launchWallet,
            routeIdHash: router.ROUTE_ID_HASH(),
            routeVersionHash: router.ROUTE_VERSION_HASH(),
            profileKey: profileKey,
            routePayloadHash: fixture.planHash,
            expectedResultHash: fixture.plan.resultHash,
            stampRequestHash: router.computeStampRequestHash(fixture.request),
            nonce: fixture.launchId,
            validAfter: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 1 hours),
            value: 0
        });
        return fixture;
    }

    function _component(
        address account,
        IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentKindV2_1 kind,
        uint64 nonce,
        string memory seed,
        string memory label
    ) private view returns (IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentV1 memory) {
        return IProgrammableCompletedGraphAdoptionRouterV2_1.ComponentV1({
                account: account,
                kind: kind,
                createNonce: nonce,
                creationCodeHash: _hash(seed, string.concat(label, "-creation-code")),
                runtimeCodeHash: componentRuntimeHash,
                configurationHash: _hash(seed, string.concat(label, "-configuration")),
                creationEvidenceHash: _hash(seed, string.concat(label, "-creation-evidence"))
            });
    }

    function _approveAndAdopt(ApplicantFixture memory fixture) private {
        authority.setApproved(router.permitDigest(fixture.permit), true);
        vm.prank(fixture.plan.launchWallet);
        router.adoptCompletedGraphV1(
            fixture.permit, fixture.plan, fixture.request, fixture.components, fixture.edges, "approved"
        );
    }

    function _newRouter()
        private
        returns (
            CompletedGraphCapabilityAdminV2_1Mock otherAdmin,
            ProgrammableCompletedGraphAdoptionRouterV2_1 otherRouter
        )
    {
        otherAdmin = new CompletedGraphCapabilityAdminV2_1Mock();
        otherRouter = new ProgrammableCompletedGraphAdoptionRouterV2_1(
            address(new CompletedGraphAuthorityV2_1Mock()),
            address(otherAdmin),
            address(new CompletedGraphParentRouterV2Mock())
        );
    }

    function _writeSlot0(PoolKey memory poolKey, uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
        private
    {
        bytes32 poolStateSlot = keccak256(abi.encodePacked(PoolId.unwrap(poolKey.toId()), bytes32(uint256(6))));
        // Test fixtures use only non-negative ticks that fit the PoolManager's signed 24-bit slot.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 packed = uint256(sqrtPriceX96) | (uint256(uint24(tick)) << 160) | (uint256(protocolFee) << 184)
            | (uint256(lpFee) << 208);
        vm.store(POOL_MANAGER, poolStateSlot, bytes32(packed));
    }

    function _hash(string memory seed, string memory label) private pure returns (bytes32) {
        return keccak256(abi.encode(seed, label));
    }
}
