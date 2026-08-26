// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableDirectNativeHookGraphProfileV1 } from "../src/ProgrammableDirectNativeHookGraphProfileV1.sol";

contract ProgrammableDirectNativeHookGraphProfileV1Test is Test {
    ProgrammableDirectNativeHookGraphProfileV1 internal profile;

    uint160 internal constant REFERENCE_MASK = 0x20cc;
    address internal constant TOKEN = address(0x10000);
    address internal constant REFERENCE_HOOK = address(uint160(0x100000) + REFERENCE_MASK);
    address internal constant ROUTER = address(0x20000);
    address internal constant GRAPH_FACTORY = address(0x30000);
    address internal constant POOL_MANAGER = address(0x40000);
    address internal constant PROJECT_FEE_OWNER = address(0x50000);
    address internal constant INITIALIZER = address(0x60000);

    function setUp() public {
        profile = new ProgrammableDirectNativeHookGraphProfileV1();
    }

    function test_targetManifestBindsEveryReviewedSourceBuildAndRuntimeAxis() public view {
        ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1[] memory targets = _targets();
        bytes32 baseline = profile.computeTargetManifestHash(targets);

        targets[1].sourceArtifactHash = keccak256("changed-source");
        assertNotEq(profile.computeTargetManifestHash(targets), baseline);
        targets = _targets();
        targets[1].compilerBuildHash = keccak256("changed-build");
        assertNotEq(profile.computeTargetManifestHash(targets), baseline);
        targets = _targets();
        targets[1].runtimeCodeHash = keccak256("changed-runtime");
        assertNotEq(profile.computeTargetManifestHash(targets), baseline);
        targets = _targets();
        targets[1].initializerAbiHash = keccak256("changed-initializer-abi");
        assertNotEq(profile.computeTargetManifestHash(targets), baseline);
    }

    function test_targetManifestRequiresDistinctTokenHookInitializerAndCanonicalTargets() public {
        ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1[] memory targets = _targets();
        targets[1].role = ProgrammableDirectNativeHookGraphProfileV1.TargetRoleV1.Token;
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidTarget.selector, uint256(1))
        );
        profile.computeTargetManifestHash(targets);

        targets = _targets();
        targets[2].role = ProgrammableDirectNativeHookGraphProfileV1.TargetRoleV1.Other;
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 2));
        profile.computeTargetManifestHash(targets);

        targets = _targets();
        targets[1].targetIndex = 0;
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidTarget.selector, uint256(1))
        );
        profile.computeTargetManifestHash(targets);

        targets = _targets();
        targets[1].expectedAddress = targets[0].expectedAddress;
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidTarget.selector, uint256(1))
        );
        profile.computeTargetManifestHash(targets);
    }

    function test_reviewAdmissionBindsExactCompilerAndConformanceEvidence() public view {
        ProgrammableDirectNativeHookGraphProfileV1.ReviewAdmissionV1 memory review = _review();
        bytes32 baseline = profile.computeReviewAdmissionHash(review);

        review.compilerInputHash = keccak256("different-standard-json-input");
        assertNotEq(profile.computeReviewAdmissionHash(review), baseline);
        review = _review();
        review.feeConformanceEvidenceHash = keccak256("different-fee-proof");
        assertNotEq(profile.computeReviewAdmissionHash(review), baseline);
        review = _review();
        review.securityReviewHash = keccak256("different-review");
        assertNotEq(profile.computeReviewAdmissionHash(review), baseline);
    }

    function test_reviewAdmissionRejectsHalfBoundInitializer() public {
        ProgrammableDirectNativeHookGraphProfileV1.ReviewAdmissionV1 memory review = _review();
        review.initializerRuntimeCodeHash = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 3));
        profile.computeReviewAdmissionHash(review);

        review.initializerCreationCodeHash = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 3));
        profile.computeReviewAdmissionHash(review);
    }

    function test_marketSupportsNativeAndErc20QuoteAndBindsPoolKey() public view {
        ProgrammableDirectNativeHookGraphProfileV1.MarketBindingV1 memory market = _market();
        bytes32 nativeQuoteHash = profile.computePoolKeyHash(market);

        market.quoteCurrency = TOKEN;
        assertEq(profile.computePoolKeyHash(market), nativeQuoteHash, "quote side is fee policy, not PoolKey");

        market.currency0 = address(0x8000);
        market.currency1 = TOKEN;
        market.token = TOKEN;
        market.quoteCurrency = address(0x8000);
        assertNotEq(profile.computePoolKeyHash(market), nativeQuoteHash);
    }

    function test_marketRejectsUnorderedCurrenciesAndForeignQuote() public {
        ProgrammableDirectNativeHookGraphProfileV1.MarketBindingV1 memory market = _market();
        market.currency0 = TOKEN;
        market.currency1 = address(0);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 8));
        profile.computePoolKeyHash(market);

        market = _market();
        market.quoteCurrency = address(0xdead);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 8));
        profile.computePoolKeyHash(market);
    }

    function test_permissionMasksAreVariableButDependencyChecked() public {
        profile.validateHookPermissions(REFERENCE_HOOK, REFERENCE_MASK);

        uint160 beforeOnly = 0x88;
        profile.validateHookPermissions(address(uint160(0x200000) + beforeOnly), beforeOnly);
        uint160 afterOnly = 0x44;
        profile.validateHookPermissions(address(uint160(0x300000) + afterOnly), afterOnly);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidHookPermissions.selector, 0x08)
        );
        profile.validateHookPermissions(address(uint160(0x400000) + 0x08), 0x08);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidHookPermissions.selector, 0x80)
        );
        profile.validateHookPermissions(address(uint160(0x500000) + 0x80), 0x80);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidHookPermissions.selector, 0x88)
        );
        profile.validateHookPermissions(address(uint160(0x600000) + 0x44), 0x88);
    }

    function test_inclusiveTenBpsAccountingNeverAddsOnTopOfSelectedTotal() public view {
        (uint32 effective, uint32 projectShare, uint32 programmableShare) = profile.feeSplit(30_000);
        assertEq(effective, 30_000);
        assertEq(projectShare, 29_000);
        assertEq(programmableShare, 1000);
        assertEq(projectShare + programmableShare, effective);

        (effective, projectShare, programmableShare) = profile.feeSplit(500);
        assertEq(effective, 1000);
        assertEq(projectShare, 0);
        assertEq(programmableShare, 1000);
        assertEq(projectShare + programmableShare, effective);
    }

    function test_feePolicyBindsRuntimeMaskRatesAndExactReview() public view {
        ProgrammableDirectNativeHookGraphProfileV1.FeePolicyV1 memory policy = _feePolicy();
        bytes32 baseline = profile.computeFeePolicyHash(policy);

        policy.selectedBuyHundredthsOfBip = 30_001;
        assertNotEq(profile.computeFeePolicyHash(policy), baseline);
        policy = _feePolicy();
        policy.hookRuntimeCodeHash = keccak256("different-hook-runtime");
        assertNotEq(profile.computeFeePolicyHash(policy), baseline);
        policy = _feePolicy();
        policy.reviewAdmissionHash = keccak256("different-review-admission");
        assertNotEq(profile.computeFeePolicyHash(policy), baseline);
    }

    function test_topologyHashIsPreGraphAndPermitBoundWithoutGraphCommitmentCycle() public view {
        ProgrammableDirectNativeHookGraphProfileV1.TopologyBindingV1 memory topology = _topology();
        bytes32 baseline = profile.computeTopologyHash(topology);

        topology.routeNonce = keccak256("different-route-nonce");
        assertNotEq(profile.computeTopologyHash(topology), baseline);
        topology = _topology();
        topology.feePolicyHash = keccak256("different-fee-policy");
        assertNotEq(profile.computeTopologyHash(topology), baseline);
        topology = _topology();
        topology.fundingIntentHash = keccak256("different-launch-intent-bound-funding");
        assertNotEq(profile.computeTopologyHash(topology), baseline);
    }

    function test_topologyRequiresRouterAsGraphAuthorizedLauncherAndThreeToSixteenTargets() public {
        ProgrammableDirectNativeHookGraphProfileV1.TopologyBindingV1 memory topology = _topology();
        topology.authorizedLauncher = address(0xbeef);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 5));
        profile.computeTopologyHash(topology);

        topology = _topology();
        topology.targetCount = 2;
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 5));
        profile.computeTopologyHash(topology);

        topology = _topology();
        topology.targetCount = 16;
        profile.computeTopologyHash(topology);

        topology = _topology();
        topology.routeNamespace = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidBinding.selector, 5));
        profile.computeTopologyHash(topology);
    }

    function test_eip3009NonceBindsLaunchIntentAndUsesSeparatePublicNonceDomain() public view {
        assertEq(
            profile.FUNDING_INTENT_DOMAIN_HASH(), 0xa511b4d24d73d4905b0a9b50873a89978bd950d8bac23485ec98a43a0dd4c85c
        );
        assertEq(
            profile.FUNDING_NONCE_DOMAIN_HASH(), 0xe64de4316449729c8e063e150d279ac2c159605f54d1ecbe52687fd4c639eb04
        );
        ProgrammableDirectNativeHookGraphProfileV1.FundingIntentV1 memory intent = _fundingIntent();
        bytes32 expected = keccak256(
            abi.encode(
                profile.FUNDING_INTENT_DOMAIN_HASH(),
                intent.chainId,
                intent.token,
                intent.router,
                intent.graphFactory,
                intent.routeNamespace,
                intent.routeNonce,
                intent.launchIntentCommitment,
                intent.from,
                intent.to,
                intent.value,
                intent.validAfter,
                intent.validBefore
            )
        );
        bytes32 intentHash = profile.computeFundingIntentHash(intent);
        assertEq(intentHash, expected);
        assertEq(
            profile.computeFundingNonce(intentHash),
            keccak256(abi.encode(profile.FUNDING_NONCE_DOMAIN_HASH(), intentHash))
        );
    }

    function test_fundingIntentAndNonceMatchCrossRepoGoldenVector() public view {
        ProgrammableDirectNativeHookGraphProfileV1.FundingIntentV1 memory intent =
            ProgrammableDirectNativeHookGraphProfileV1.FundingIntentV1({
                chainId: 1,
                token: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48,
                router: 0x8622DD5bAb44185f2A458ac90384Ac99248f8d56,
                graphFactory: 0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887,
                routeNamespace: 0x1111111111111111111111111111111111111111111111111111111111111111,
                routeNonce: 0x2222222222222222222222222222222222222222222222222222222222222222,
                launchIntentCommitment: 0xfa398b12434bb4bf785612fc68530d9ba2af6db99eca93afea9ea93fe7bb82f4,
                from: 0x0000000000000000000000000000000000004000,
                to: 0x0000000000000000000000000000000000005000,
                value: 30_000_000,
                validAfter: 900,
                validBefore: 1200
            });

        bytes32 fundingIntentHash = profile.computeFundingIntentHash(intent);
        assertEq(fundingIntentHash, 0x0db785d5e4a05390c7c2361be45a8db78ad29c11162057ba443c78cb661a1ea4);
        assertEq(
            profile.computeFundingNonce(fundingIntentHash),
            0x7b2fd24feab532b315eb5ce709950578f57d509bb12fe2ddde70417f1808c9bc
        );
    }

    function test_fundingIntentRejectsMissingLaunchIntentCommitment() public {
        ProgrammableDirectNativeHookGraphProfileV1.FundingIntentV1 memory intent = _fundingIntent();
        intent.launchIntentCommitment = bytes32(0);
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidFundingIntent.selector, 0)
        );
        profile.computeFundingIntentHash(intent);
    }

    function test_staticSignaturePatchTemplateProducesFullAbiEncodingExactly() public view {
        bytes4 selector = bytes4(keccak256("initialize(bytes32,bytes32,uint8)"));
        bytes memory unsignedCalldata = abi.encodeWithSelector(selector, bytes32(0), bytes32(0), uint8(0));
        assertEq(profile.validateFundingSignaturePatchTemplate(unsignedCalldata, 4, 36, 68), sha256(unsignedCalldata));

        bytes32 r = keccak256("r");
        bytes32 s = keccak256("s");
        uint8 v = 27;
        bytes memory patched = bytes.concat(unsignedCalldata);
        _writeWord(patched, 4, r);
        _writeWord(patched, 36, s);
        patched[99] = bytes1(v);
        assertEq(keccak256(patched), keccak256(abi.encodeWithSelector(selector, r, s, v)));
    }

    function test_staticSignaturePatchRejectsRawUnalignedDuplicateOrNonzeroSlots() public {
        bytes4 selector = bytes4(keccak256("initialize(bytes32,bytes32,uint8)"));
        bytes memory unsignedCalldata = abi.encodeWithSelector(selector, bytes32(0), bytes32(0), uint8(0));

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidSignaturePatch.selector, 3)
        );
        profile.validateFundingSignaturePatchTemplate(unsignedCalldata, 5, 36, 68);

        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidSignaturePatch.selector, 2)
        );
        profile.validateFundingSignaturePatchTemplate(unsignedCalldata, 4, 4, 68);

        unsignedCalldata[4] = 0x01;
        vm.expectRevert(
            abi.encodeWithSelector(ProgrammableDirectNativeHookGraphProfileV1.InvalidSignaturePatch.selector, 4)
        );
        profile.validateFundingSignaturePatchTemplate(unsignedCalldata, 4, 36, 68);
    }

    function _targets()
        internal
        pure
        returns (ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1[] memory targets)
    {
        targets = new ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1[](3);
        targets[0] = ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1({
            targetIndex: 0,
            role: ProgrammableDirectNativeHookGraphProfileV1.TargetRoleV1.Token,
            targetIdHash: keccak256("token-target"),
            expectedAddress: TOKEN,
            sourceArtifactHash: keccak256("token-source"),
            compilerBuildHash: keccak256("token-build"),
            initCodeHash: keccak256("token-init-code"),
            initializerAbiHash: keccak256("empty-initializer"),
            runtimeCodeHash: keccak256("token-runtime")
        });
        targets[1] = ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1({
            targetIndex: 1,
            role: ProgrammableDirectNativeHookGraphProfileV1.TargetRoleV1.Hook,
            targetIdHash: keccak256("hook-target"),
            expectedAddress: REFERENCE_HOOK,
            sourceArtifactHash: keccak256("hook-source"),
            compilerBuildHash: keccak256("hook-build"),
            initCodeHash: keccak256("hook-init-code"),
            initializerAbiHash: keccak256("hook-initializer-abi"),
            runtimeCodeHash: keccak256("hook-runtime")
        });
        targets[2] = ProgrammableDirectNativeHookGraphProfileV1.TargetBindingV1({
            targetIndex: 2,
            role: ProgrammableDirectNativeHookGraphProfileV1.TargetRoleV1.Initializer,
            targetIdHash: keccak256("initializer-target"),
            expectedAddress: INITIALIZER,
            sourceArtifactHash: keccak256("initializer-source"),
            compilerBuildHash: keccak256("initializer-build"),
            initCodeHash: keccak256("initializer-init-code"),
            initializerAbiHash: keccak256("initializer-function-abi"),
            runtimeCodeHash: keccak256("initializer-runtime")
        });
    }

    function _review()
        internal
        view
        returns (ProgrammableDirectNativeHookGraphProfileV1.ReviewAdmissionV1 memory review)
    {
        review = ProgrammableDirectNativeHookGraphProfileV1.ReviewAdmissionV1({
            sourceRepositoryHash: keccak256("source-repository"),
            sourceCommitHash: keccak256("source-commit"),
            sourceTreeHash: keccak256("source-tree"),
            compilerInputHash: keccak256("compiler-input"),
            compilerOutputHash: keccak256("compiler-output"),
            targetManifestHash: profile.computeTargetManifestHash(_targets()),
            hookCreationCodeHash: keccak256("hook-creation-code"),
            hookRuntimeCodeHash: keccak256("hook-runtime"),
            initializerCreationCodeHash: keccak256("initializer-creation-code"),
            initializerRuntimeCodeHash: keccak256("initializer-runtime"),
            feeConformanceEvidenceHash: keccak256("four-quadrant-fee-conformance"),
            securityReviewHash: keccak256("security-review")
        });
    }

    function _market()
        internal
        pure
        returns (ProgrammableDirectNativeHookGraphProfileV1.MarketBindingV1 memory market)
    {
        market = ProgrammableDirectNativeHookGraphProfileV1.MarketBindingV1({
                currency0: address(0),
                currency1: TOKEN,
                lpFeePips: 3000,
                tickSpacing: 60,
                token: TOKEN,
                hook: REFERENCE_HOOK,
                quoteCurrency: address(0),
                hookPermissions: REFERENCE_MASK
            });
    }

    function _feePolicy() internal view returns (ProgrammableDirectNativeHookGraphProfileV1.FeePolicyV1 memory policy) {
        policy = ProgrammableDirectNativeHookGraphProfileV1.FeePolicyV1({
            chainId: 1,
            poolManager: POOL_MANAGER,
            poolManagerRuntimeCodeHash: keccak256("pool-manager-runtime"),
            poolKeyHash: profile.computePoolKeyHash(_market()),
            quoteCurrency: address(0),
            hook: REFERENCE_HOOK,
            hookRuntimeCodeHash: keccak256("hook-runtime"),
            hookPermissions: REFERENCE_MASK,
            projectFeeOwner: PROJECT_FEE_OWNER,
            selectedBuyHundredthsOfBip: 30_000,
            selectedSellHundredthsOfBip: 30_000,
            reviewAdmissionHash: profile.computeReviewAdmissionHash(_review())
        });
    }

    function _topology()
        internal
        view
        returns (ProgrammableDirectNativeHookGraphProfileV1.TopologyBindingV1 memory topology)
    {
        topology = ProgrammableDirectNativeHookGraphProfileV1.TopologyBindingV1({
            chainId: 1,
            router: ROUTER,
            graphFactory: GRAPH_FACTORY,
            authorizedLauncher: ROUTER,
            routeNamespace: keccak256("source-bundle+wallet+router+graph-factory"),
            routeNonce: keccak256("route-nonce"),
            targetCount: 3,
            tokenTargetIndex: 0,
            hookTargetIndex: 1,
            initializerTargetIndex: 2,
            token: TOKEN,
            hook: REFERENCE_HOOK,
            initializer: INITIALIZER,
            initializerTargetIdHash: keccak256("initializer-target"),
            poolKeyHash: profile.computePoolKeyHash(_market()),
            hookPermissions: REFERENCE_MASK,
            targetManifestHash: profile.computeTargetManifestHash(_targets()),
            reviewAdmissionHash: profile.computeReviewAdmissionHash(_review()),
            feePolicyHash: profile.computeFeePolicyHash(_feePolicy()),
            fundingIntentHash: profile.computeFundingIntentHash(_fundingIntent()),
            topologyEdgesHash: keccak256("topology-edges")
        });
    }

    function _fundingIntent()
        internal
        pure
        returns (ProgrammableDirectNativeHookGraphProfileV1.FundingIntentV1 memory intent)
    {
        intent = ProgrammableDirectNativeHookGraphProfileV1.FundingIntentV1({
            chainId: 1,
            token: address(0x9000),
            router: ROUTER,
            graphFactory: GRAPH_FACTORY,
            routeNamespace: keccak256("source-bundle+wallet+router+graph-factory"),
            routeNonce: keccak256("route-nonce"),
            launchIntentCommitment: keccak256("raw-sha256-launch-intent"),
            from: address(0x71000),
            to: INITIALIZER,
            value: 1_000_000,
            validAfter: 1000,
            validBefore: 2000
        });
    }

    function _writeWord(bytes memory data, uint256 offset, bytes32 value) internal pure {
        assembly ("memory-safe") {
            mstore(add(add(data, 0x20), offset), value)
        }
    }
}
