// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

import { ProgrammableLaunchPermitAuthorityV1 } from "../src/ProgrammableLaunchPermitAuthorityV1.sol";
import { ProgrammableLaunchPermitVerifierV1 } from "../src/ProgrammableLaunchPermitVerifierV1.sol";
import { IProgrammableLaunchPermitAuthorityV1 } from "../src/interfaces/IProgrammableLaunchPermitAuthorityV1.sol";
import { IProgrammableLaunchPermitVerifierV1 } from "../src/interfaces/IProgrammableLaunchPermitVerifierV1.sol";
import { IProgrammablePermitBoundRouteV1 } from "../src/interfaces/IProgrammablePermitBoundRouteV1.sol";

contract MockPermitBoundRegistryV1 {
    bytes32 public constant WRITER_ROLE = keccak256("programmable.custom-registry.writer.v1");
    uint64 public immutable REGISTRY_GENERATION;
    bytes32 public immutable CHAIN_PROFILE_HASH;
    address public immutable LAUNCH_PERMIT_AUTHORITY;
    address private _launchRoute;
    mapping(address account => bool authorized) private _writers;

    constructor(uint64 generation, bytes32 chainProfileHash, address launchPermitAuthority) {
        REGISTRY_GENERATION = generation;
        CHAIN_PROFILE_HASH = chainProfileHash;
        LAUNCH_PERMIT_AUTHORITY = launchPermitAuthority;
    }

    function grantWriter(address account) external {
        require(_launchRoute == address(0) || _launchRoute == account, "sole-writer");
        _launchRoute = account;
        _writers[account] = true;
    }

    function LAUNCH_ROUTE() external view returns (address) {
        return _launchRoute;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return role == WRITER_ROLE && _writers[account];
    }
}

contract MockPermitBoundConsumerRouteV1 is IProgrammablePermitBoundRouteV1 {
    IProgrammableLaunchPermitAuthorityV1 public immutable AUTHORITY;
    address public immutable REGISTRY;
    bytes32 public immutable override ROUTE_ID;
    address public immutable PROFILE;
    bytes32 public immutable PROFILE_ID;
    bytes32 public immutable EXECUTION_AUTHORITY_HASH;
    IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1 public immutable KERNEL_MODE;

    constructor(
        IProgrammableLaunchPermitAuthorityV1 authority,
        address registry,
        bytes32 routeId,
        bytes32 profileId,
        bytes32 executionAuthorityHash,
        IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1 kernelMode
    ) {
        AUTHORITY = authority;
        REGISTRY = registry;
        ROUTE_ID = routeId;
        PROFILE = address(this);
        PROFILE_ID = profileId;
        EXECUTION_AUTHORITY_HASH = executionAuthorityHash;
        KERNEL_MODE = kernelMode;
    }

    function consume(
        IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 calldata permit,
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 calldata releaseBinding,
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 calldata kernelEnvelope,
        bytes calldata signature,
        IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 calldata actualExecution
    ) external returns (bytes32 permitDigest, bytes32 repositoryKey, uint256 nonce) {
        return AUTHORITY.consumePermit(permit, releaseBinding, kernelEnvelope, signature, actualExecution);
    }

    function permitProfile() external view returns (address) {
        return PROFILE;
    }

    function permitProfileId() external view returns (bytes32) {
        return PROFILE_ID;
    }

    function permitProfileBindingHash() external view returns (bytes32) {
        return EXECUTION_AUTHORITY_HASH;
    }

    function permitLaunchRegistry() external view returns (address) {
        return REGISTRY;
    }

    function permitKernelEnvelopeMode()
        external
        view
        returns (IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1)
    {
        return KERNEL_MODE;
    }

    function permitExecutionAuthorityHash() external view returns (bytes32) {
        return EXECUTION_AUTHORITY_HASH;
    }
}

    contract ContractSignerV1 { }

    contract ProgrammableLaunchPermitAuthorityV1Test is Test {
        uint256 internal constant SIGNER_KEY = 0xA11CE;
        uint256 internal constant NEXT_SIGNER_KEY = 0xB0B;
        uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        address internal constant SIGNER_GOVERNOR = address(0x1001);
        address internal constant RELEASE_GOVERNOR = address(0x1002);
        address internal constant PAUSER = address(0x1003);
        address internal constant CANCELLER = address(0x1004);
        address internal constant APPLICANT = address(0xA9911CA7);
        uint64 internal constant SHARDS_GITHUB_REPOSITORY_ID = 1_329_073_878;
        uint64 internal constant HOOKEMON_GITHUB_REPOSITORY_ID = 1_324_982_531;
        bytes32 internal constant SHARDS_REPOSITORY_KEY =
            0x02ed38e86a7c41d5dea93cf5e3f829420837c4d351d9f4675929c6ce0041e835;
        bytes32 internal constant HOOKEMON_REPOSITORY_KEY =
            0x85af67313879b9844f94b66f3eb6bdc2f200e2647507f73f43242a576580961b;
        bytes32 internal constant MIN_REPOSITORY_KEY =
            0x84f907641e97fb220312430fcf0f98c1d513664a984d99df24aee57c226d174c;
        bytes32 internal constant MAX_REPOSITORY_KEY =
            0x97316281428a106b570b0e26031c4ae18b9e959742ea4cc41c1e7cd43b921dfb;

        ProgrammableLaunchPermitVerifierV1 internal verifier;
        ProgrammableLaunchPermitAuthorityV1 internal authority;
        MockPermitBoundRegistryV1 internal registry;
        MockPermitBoundConsumerRouteV1 internal route;
        IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 internal release;
        IProgrammableLaunchPermitAuthorityV1.KernelExecutionEnvelopeV1 internal emptyKernel;

        function setUp() public {
            vm.warp(1_000_000);
            vm.roll(1000);
            verifier = new ProgrammableLaunchPermitVerifierV1();
            authority = _newAuthority(vm.addr(SIGNER_KEY), 900);
            registry = new MockPermitBoundRegistryV1(1, keccak256("chain-profile"), address(authority));
            route = _newRoute(bytes32("route-a"), bytes32("profile-a"));
            authority.grantRole(authority.CONSUMER_ROLE(), address(route));
            release = _releaseFor(route, 1);
            vm.prank(RELEASE_GOVERNOR);
            authority.activateReleaseBinding(release);
        }

        function test_repositoryKeyVectorsCoverFullUint64RangeAndBothCanaries() public view {
            assertEq(authority.computeRepositoryKey(1), MIN_REPOSITORY_KEY);
            assertEq(authority.computeRepositoryKey(SHARDS_GITHUB_REPOSITORY_ID), SHARDS_REPOSITORY_KEY);
            assertEq(authority.computeRepositoryKey(HOOKEMON_GITHUB_REPOSITORY_ID), HOOKEMON_REPOSITORY_KEY);
            assertEq(authority.computeRepositoryKey(type(uint64).max), MAX_REPOSITORY_KEY);
            assertEq(
                SHARDS_REPOSITORY_KEY,
                keccak256(abi.encode("programmable.github.repository.v1", uint256(SHARDS_GITHUB_REPOSITORY_ID)))
            );
        }

        function test_signedPermitConsumesCanonicalDigestAndHardRejectsReplay() public {
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("launch-a"));
            bytes32 digest = authority.hashPermit(permit);
            bytes memory signature = _sign(SIGNER_KEY, digest);

            (bytes32 consumedDigest, bytes32 repositoryKey, uint256 nonce) =
                route.consume(permit, release, emptyKernel, signature, _actual(permit));

            assertEq(consumedDigest, digest);
            assertEq(repositoryKey, SHARDS_REPOSITORY_KEY);
            assertEq(nonce, 0);
            assertTrue(authority.repositoryConsumed(repositoryKey));
            assertEq(
                uint8(authority.permitStatus(digest).state),
                uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.CONSUMED)
            );
            assertEq(authority.nextNonce(repositoryKey), 1);
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.NonceMismatch.selector);
            route.consume(permit, release, emptyKernel, signature, _actual(permit));
        }

        function test_cancelledAndExpiredGenerationsReuseNonceUntilOneSuccess() public {
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory cancelled =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("launch-cancelled"));
            bytes32 cancelledDigest = authority.hashPermit(cancelled);
            vm.prank(CANCELLER);
            authority.cancelPermit(cancelled, release, emptyKernel, bytes32("operator-cancel"));
            assertEq(
                uint8(authority.permitStatus(cancelledDigest).state),
                uint8(IProgrammableLaunchPermitAuthorityV1.PermitStateV1.CANCELLED)
            );
            assertEq(authority.nextNonce(SHARDS_REPOSITORY_KEY), 0);

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory expired =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 2, bytes32("launch-expired"));
            expired.deadline = uint64(block.timestamp + 10);
            expired.generationBindingHash = authority.computeGenerationBindingHash(expired);
            bytes memory expiredSignature = _sign(SIGNER_KEY, authority.hashPermit(expired));
            vm.warp(expired.deadline);
            vm.expectRevert();
            route.consume(expired, release, emptyKernel, expiredSignature, _actual(expired));
            assertEq(authority.nextNonce(SHARDS_REPOSITORY_KEY), 0);

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory replacement =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 3, bytes32("launch-replacement"));
            route.consume(
                replacement,
                release,
                emptyKernel,
                _sign(SIGNER_KEY, authority.hashPermit(replacement)),
                _actual(replacement)
            );
            assertEq(authority.nextNonce(SHARDS_REPOSITORY_KEY), 1);
        }

        function test_repositoryConsumptionSurvivesSignerAndReleaseRotation() public {
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory first =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("launch-first"));
            route.consume(first, release, emptyKernel, _sign(SIGNER_KEY, authority.hashPermit(first)), _actual(first));

            address nextSigner = vm.addr(NEXT_SIGNER_KEY);
            vm.prank(SIGNER_GOVERNOR);
            authority.createSignerEpoch(vm.addr(SIGNER_KEY), 1, nextSigner);
            MockPermitBoundConsumerRouteV1 routeTwo = _newRoute(bytes32("route-b"), bytes32("profile-b"));
            authority.grantRole(authority.CONSUMER_ROLE(), address(routeTwo));
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory releaseTwo = _releaseFor(routeTwo, 2);
            vm.prank(RELEASE_GOVERNOR);
            authority.activateReleaseBinding(releaseTwo);

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory second =
                _permit(routeTwo, releaseTwo, SHARDS_GITHUB_REPOSITORY_ID, 2, bytes32("launch-second"));
            second.signerEpoch = 2;
            second.generationBindingHash = authority.computeGenerationBindingHash(second);
            bytes memory secondSignature = _sign(NEXT_SIGNER_KEY, authority.hashPermit(second));
            vm.expectRevert();
            routeTwo.consume(second, releaseTwo, emptyKernel, secondSignature, _actual(second));
        }

        function test_signerRotationInvalidatesOldEpochAndNewEpochCanReissue() public {
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory oldPermit =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("old-signer"));
            bytes memory oldSignature = _sign(SIGNER_KEY, authority.hashPermit(oldPermit));
            address nextSigner = vm.addr(NEXT_SIGNER_KEY);
            vm.prank(SIGNER_GOVERNOR);
            authority.createSignerEpoch(vm.addr(SIGNER_KEY), 1, nextSigner);

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.SignerEpochNotCurrent.selector);
            route.consume(oldPermit, release, emptyKernel, oldSignature, _actual(oldPermit));

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory replacement =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 2, bytes32("new-signer"));
            replacement.signerEpoch = 2;
            replacement.generationBindingHash = authority.computeGenerationBindingHash(replacement);
            route.consume(
                replacement,
                release,
                emptyKernel,
                _sign(NEXT_SIGNER_KEY, authority.hashPermit(replacement)),
                _actual(replacement)
            );
            assertTrue(authority.repositoryConsumed(SHARDS_REPOSITORY_KEY));
            assertFalse(authority.signerEpochState(1).enabled);
            assertTrue(authority.signerEpochState(2).enabled);
        }

        function test_crossProductActivationDoesNotRetireAndExplicitRetirementHasExactBoundary() public {
            MockPermitBoundConsumerRouteV1 routeTwo = _newRoute(bytes32("route-b"), bytes32("profile-b"));
            authority.grantRole(authority.CONSUMER_ROLE(), address(routeTwo));
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory releaseTwo = _releaseFor(routeTwo, 2);
            vm.prank(RELEASE_GOVERNOR);
            authority.activateReleaseBinding(releaseTwo);

            bytes32 releaseHash = authority.computeReleaseBindingHash(release);
            assertEq(authority.releaseStatus(releaseHash).activeUntil, 0);
            vm.warp(block.timestamp + 901);
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory unaffected =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("cross-product-unaffected"));
            route.consume(
                unaffected,
                release,
                emptyKernel,
                _sign(SIGNER_KEY, authority.hashPermit(unaffected)),
                _actual(unaffected)
            );

            uint64 activeUntil = uint64(block.timestamp + 900);
            vm.prank(RELEASE_GOVERNOR);
            authority.scheduleReleaseRetirement(releaseHash, activeUntil);
            assertEq(authority.releaseStatus(releaseHash).activeUntil, activeUntil);

            vm.warp(activeUntil - 1);
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory withinOverlap =
                _permit(route, release, 777, 2, bytes32("within-overlap"));
            route.consume(
                withinOverlap,
                release,
                emptyKernel,
                _sign(SIGNER_KEY, authority.hashPermit(withinOverlap)),
                _actual(withinOverlap)
            );

            vm.warp(activeUntil);
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory atBoundary =
                _permit(route, release, 778, 3, bytes32("at-boundary"));
            bytes memory boundarySignature = _sign(SIGNER_KEY, authority.hashPermit(atBoundary));
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.ReleaseRetired.selector);
            route.consume(atBoundary, release, emptyKernel, boundarySignature, _actual(atBoundary));

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory otherProduct =
                _permit(routeTwo, releaseTwo, HOOKEMON_GITHUB_REPOSITORY_ID, 4, bytes32("other-product"));
            routeTwo.consume(
                otherProduct,
                releaseTwo,
                emptyKernel,
                _sign(SIGNER_KEY, authority.hashPermit(otherProduct)),
                _actual(otherProduct)
            );
        }

        function test_approvalGenerationCancellationUsesNumericRepositoryAndBlocksEveryPermitGeneration() public {
            bytes32 approvalId = bytes32("approval-id");
            vm.prank(CANCELLER);
            authority.cancelApprovalGeneration(SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("approval-revoked"));
            assertTrue(authority.approvalGenerationCancelled(SHARDS_GITHUB_REPOSITORY_ID, 1));
            assertFalse(authority.approvalGenerationCancelled(HOOKEMON_GITHUB_REPOSITORY_ID, 1));

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 9, bytes32("revoked-launch"));
            permit.approvalId = approvalId;
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
            bytes memory revokedSignature = _sign(SIGNER_KEY, authority.hashPermit(permit));
            vm.expectRevert();
            route.consume(permit, release, emptyKernel, revokedSignature, _actual(permit));

            // A different target projection/approvalId cannot reopen the revoked universal grant generation.
            permit.approvalId = keccak256("different-genuine-target-approval-id");
            permit.permitGeneration = 10;
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
            bytes memory substitutedApprovalSignature = _sign(SIGNER_KEY, authority.hashPermit(permit));
            vm.expectRevert(
                abi.encodeWithSelector(
                    ProgrammableLaunchPermitAuthorityV1.ApprovalGenerationIsCancelled.selector,
                    authority.computeRepositoryKey(SHARDS_GITHUB_REPOSITORY_ID),
                    uint64(1)
                )
            );
            route.consume(permit, release, emptyKernel, substitutedApprovalSignature, _actual(permit));

            // Explicit reapproval advances the durable generation and remains separately usable.
            permit.approvalGeneration = 2;
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
            route.consume(
                permit, release, emptyKernel, _sign(SIGNER_KEY, authority.hashPermit(permit)), _actual(permit)
            );
        }

        function test_releaseValidationRejectsKernelModeDowngradeAndEoaProfile() public {
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory wrongMode = release;
            wrongMode.releaseGeneration = 2;
            wrongMode.kernelEnvelopeMode = IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.REQUIRED;
            vm.prank(RELEASE_GOVERNOR);
            vm.expectRevert();
            authority.activateReleaseBinding(wrongMode);

            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory eoaProfile = release;
            eoaProfile.releaseGeneration = 2;
            eoaProfile.profile = address(0xE0A);
            eoaProfile.profileRuntimeCodeHash = address(0xE0A).codehash;
            vm.prank(RELEASE_GOVERNOR);
            vm.expectRevert();
            authority.activateReleaseBinding(eoaProfile);
        }

        function test_releaseValidationBindsExactProfileGraphAndRegistryAuthority() public {
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory wrongProfileBinding = release;
            wrongProfileBinding.releaseGeneration = 2;
            wrongProfileBinding.profileBindingHash = keccak256("substituted-profile-graph");
            assertTrue(
                authority.computeReleaseBindingHash(wrongProfileBinding) != authority.computeReleaseBindingHash(release)
            );
            vm.prank(RELEASE_GOVERNOR);
            vm.expectRevert();
            authority.activateReleaseBinding(wrongProfileBinding);

            MockPermitBoundRegistryV1 wrongRegistry =
                new MockPermitBoundRegistryV1(1, registry.CHAIN_PROFILE_HASH(), address(0xBAD));
            MockPermitBoundConsumerRouteV1 wrongRegistryRoute = new MockPermitBoundConsumerRouteV1(
                authority,
                address(wrongRegistry),
                bytes32("wrong-registry-route"),
                bytes32("wrong-registry-profile"),
                keccak256("wrong-registry-execution"),
                IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE
            );
            wrongRegistry.grantWriter(address(wrongRegistryRoute));
            authority.grantRole(authority.CONSUMER_ROLE(), address(wrongRegistryRoute));
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory wrongRegistryRelease = release;
            wrongRegistryRelease.releaseGeneration = 2;
            wrongRegistryRelease.launchRegistry = address(wrongRegistry);
            wrongRegistryRelease.launchRegistryRuntimeCodeHash = address(wrongRegistry).codehash;
            wrongRegistryRelease.profile = address(wrongRegistryRoute);
            wrongRegistryRelease.profileId = wrongRegistryRoute.PROFILE_ID();
            wrongRegistryRelease.profileRuntimeCodeHash = address(wrongRegistryRoute).codehash;
            wrongRegistryRelease.profileBindingHash = wrongRegistryRoute.permitProfileBindingHash();
            wrongRegistryRelease.route = address(wrongRegistryRoute);
            wrongRegistryRelease.routeId = wrongRegistryRoute.ROUTE_ID();
            wrongRegistryRelease.routeRuntimeCodeHash = address(wrongRegistryRoute).codehash;
            wrongRegistryRelease.executionAuthorityHash = wrongRegistryRoute.EXECUTION_AUTHORITY_HASH();
            vm.prank(RELEASE_GOVERNOR);
            vm.expectRevert();
            authority.activateReleaseBinding(wrongRegistryRelease);
        }

        function test_releaseCannotActivateBeforeExactRouteReceivesConsumerRole() public {
            MockPermitBoundConsumerRouteV1 ungranted = _newRoute(bytes32("ungranted"), bytes32("profile"));
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory ungrantedRelease = _releaseFor(ungranted, 2);
            vm.prank(RELEASE_GOVERNOR);
            vm.expectRevert();
            authority.activateReleaseBinding(ungrantedRelease);
        }

        function test_exactSignatureAndPermitPreimageAreRequired() public {
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("exact-signature"));
            bytes memory signature = _sign(SIGNER_KEY, authority.hashPermit(permit));
            permit.presentationBindingHash = keccak256("substituted-presentation");
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.InvalidSignature.selector);
            route.consume(permit, release, emptyKernel, signature, _actual(permit));

            permit.presentationBindingHash = keccak256("presentation");
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.InvalidSignature.selector);
            route.consume(permit, release, emptyKernel, hex"1234", _actual(permit));
        }

        function test_eoaSignatureRejectsHighSInvalidVWrongSignerAndMutation() public {
            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("signature-canonicality"));
            bytes32 digest = authority.hashPermit(permit);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);

            bytes memory highS = abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.InvalidSignature.selector);
            route.consume(permit, release, emptyKernel, highS, _actual(permit));

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.InvalidSignature.selector);
            route.consume(permit, release, emptyKernel, abi.encodePacked(r, s, uint8(29)), _actual(permit));

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.InvalidSignature.selector);
            route.consume(permit, release, emptyKernel, _sign(NEXT_SIGNER_KEY, digest), _actual(permit));

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.InvalidSignature.selector);
            route.consume(
                permit, release, emptyKernel, abi.encodePacked(bytes32(uint256(r) ^ 1), s, v), _actual(permit)
            );
        }

        function test_hardPermitLifetimeCeilingAndTimeBoundaries() public {
            vm.expectRevert();
            new ProgrammableLaunchPermitAuthorityV1(
                1,
                address(this),
                address(0x2001),
                address(0x2002),
                address(0x2003),
                address(0x2004),
                address(0x1234),
                901,
                verifier,
                address(verifier).codehash
            );

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory tooLong =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 1, bytes32("too-long"));
            tooLong.deadline = tooLong.notBefore + 901;
            bytes memory tooLongSignature = _sign(SIGNER_KEY, authority.hashPermit(tooLong));
            vm.expectRevert();
            route.consume(tooLong, release, emptyKernel, tooLongSignature, _actual(tooLong));

            IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory exactStart =
                _permit(route, release, SHARDS_GITHUB_REPOSITORY_ID, 2, bytes32("exact-start"));
            route.consume(
                exactStart,
                release,
                emptyKernel,
                _sign(SIGNER_KEY, authority.hashPermit(exactStart)),
                _actual(exactStart)
            );
        }

        function test_rolesStayDisjointIncludingDelayedDefaultAdminTransfer() public {
            address[5] memory forbidden = [vm.addr(SIGNER_KEY), SIGNER_GOVERNOR, RELEASE_GOVERNOR, PAUSER, CANCELLER];
            for (uint256 i; i < forbidden.length; ++i) {
                ProgrammableLaunchPermitAuthorityV1 candidate = _newAuthority(vm.addr(SIGNER_KEY), 900);
                candidate.beginDefaultAdminTransfer(forbidden[i]);
                vm.warp(block.timestamp + 2);
                vm.prank(forbidden[i]);
                vm.expectRevert();
                candidate.acceptDefaultAdminTransfer();
            }

            ProgrammableLaunchPermitAuthorityV1 neutralCandidate = _newAuthority(vm.addr(SIGNER_KEY), 900);
            address neutral = address(0xCAFE);
            neutralCandidate.beginDefaultAdminTransfer(neutral);
            vm.warp(block.timestamp + 2);
            vm.prank(neutral);
            neutralCandidate.acceptDefaultAdminTransfer();
            assertEq(neutralCandidate.defaultAdmin(), neutral);
        }

        function test_formerInitialAdminCanNeverBecomeOperationalAuthoritySignerOrConsumer() public {
            address formerAdmin = address(0xAD01);
            ProgrammableLaunchPermitAuthorityV1 candidate = new ProgrammableLaunchPermitAuthorityV1(
                1,
                formerAdmin,
                SIGNER_GOVERNOR,
                RELEASE_GOVERNOR,
                PAUSER,
                CANCELLER,
                vm.addr(0xC0DE),
                900,
                verifier,
                address(verifier).codehash
            );
            address successorAdmin = address(0xCAFE);
            vm.prank(formerAdmin);
            candidate.beginDefaultAdminTransfer(successorAdmin);
            vm.warp(block.timestamp + 2);
            vm.prank(successorAdmin);
            candidate.acceptDefaultAdminTransfer();
            assertEq(candidate.defaultAdmin(), successorAdmin);

            bytes32[4] memory operationalRoles = [
                candidate.SIGNER_GOVERNOR_ROLE(),
                candidate.RELEASE_GOVERNOR_ROLE(),
                candidate.PAUSER_ROLE(),
                candidate.CANCELLER_ROLE()
            ];
            bytes32 consumerRole = candidate.CONSUMER_ROLE();
            for (uint256 i; i < operationalRoles.length; ++i) {
                vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
                vm.prank(successorAdmin);
                candidate.grantRole(operationalRoles[i], formerAdmin);
            }

            vm.etch(formerAdmin, hex"00");
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            vm.prank(successorAdmin);
            candidate.grantRole(consumerRole, formerAdmin);

            vm.etch(formerAdmin, hex"");
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            vm.prank(SIGNER_GOVERNOR);
            candidate.createSignerEpoch(vm.addr(0xC0DE), 1, formerAdmin);
        }

        function test_formerConsumerAndDisabledSignerCanNeverBecomeAuthorityOrFreshSigner() public {
            authority.revokeRole(authority.CONSUMER_ROLE(), address(route));
            authority.beginDefaultAdminTransfer(address(route));
            vm.warp(block.timestamp + 2);
            vm.prank(address(route));
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.acceptDefaultAdminTransfer();

            vm.prank(SIGNER_GOVERNOR);
            authority.createSignerEpoch(vm.addr(SIGNER_KEY), 1, vm.addr(NEXT_SIGNER_KEY));
            vm.prank(SIGNER_GOVERNOR);
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.createSignerEpoch(vm.addr(NEXT_SIGNER_KEY), 2, vm.addr(SIGNER_KEY));
        }

        function test_formerAuthorityCannotReceiveAnyRoleConsumerOrSignerAfterRevocation() public {
            bytes32 pauserRole = authority.PAUSER_ROLE();
            bytes32 cancellerRole = authority.CANCELLER_ROLE();
            bytes32 consumerRole = authority.CONSUMER_ROLE();
            authority.revokeRole(pauserRole, PAUSER);

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.grantRole(cancellerRole, PAUSER);

            vm.prank(SIGNER_GOVERNOR);
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.createSignerEpoch(vm.addr(SIGNER_KEY), 1, PAUSER);

            vm.etch(PAUSER, hex"00");
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.grantRole(consumerRole, PAUSER);

            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.grantRole(pauserRole, PAUSER);
            assertFalse(authority.hasRole(pauserRole, PAUSER));
        }

        function test_zeroAddressCannotReceiveAnyAuthorityRole() public {
            bytes32 cancellerRole = authority.CANCELLER_ROLE();
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.IncompatibleAuthority.selector);
            authority.grantRole(cancellerRole, address(0));
        }

        function test_consumerMustBeExactContractAndSignerMustBeEoa() public {
            bytes32 consumerRole = authority.CONSUMER_ROLE();
            vm.expectRevert();
            authority.grantRole(consumerRole, address(0xBEEF));

            ContractSignerV1 contractSigner = new ContractSignerV1();
            vm.expectPartialRevert(ProgrammableLaunchPermitAuthorityV1.ContractSignerUnsupported.selector);
            _newAuthority(address(contractSigner), 900);
        }

        function test_constructorRejectsUnreviewedVerifierRuntimeBinding() public {
            IProgrammableLaunchPermitVerifierV1 candidateVerifier = verifier;
            bytes32 actualRuntimeCodeHash = address(candidateVerifier).codehash;
            vm.expectRevert();
            _newAuthorityWithVerifier(vm.addr(0xC001), 900, candidateVerifier, bytes32(0));
            vm.expectRevert();
            _newAuthorityWithVerifier(vm.addr(0xC002), 900, candidateVerifier, bytes32(uint256(1)));
            vm.expectRevert();
            _newAuthorityWithVerifier(
                vm.addr(0xC003), 900, IProgrammableLaunchPermitVerifierV1(address(0xDEAD)), actualRuntimeCodeHash
            );
        }

        function _newAuthority(address signer, uint64 maxLifetime)
            internal
            returns (ProgrammableLaunchPermitAuthorityV1 candidate)
        {
            return _newAuthorityWithVerifier(signer, maxLifetime, verifier, address(verifier).codehash);
        }

        function _newAuthorityWithVerifier(
            address signer,
            uint64 maxLifetime,
            IProgrammableLaunchPermitVerifierV1 candidateVerifier,
            bytes32 expectedRuntimeCodeHash
        ) internal returns (ProgrammableLaunchPermitAuthorityV1 candidate) {
            candidate = new ProgrammableLaunchPermitAuthorityV1(
                1,
                address(this),
                SIGNER_GOVERNOR,
                RELEASE_GOVERNOR,
                PAUSER,
                CANCELLER,
                signer,
                maxLifetime,
                candidateVerifier,
                expectedRuntimeCodeHash
            );
        }

        function _newRoute(bytes32 routeId, bytes32 profileId)
            internal
            returns (MockPermitBoundConsumerRouteV1 candidate)
        {
            MockPermitBoundRegistryV1 targetRegistry = registry;
            if (targetRegistry.LAUNCH_ROUTE() != address(0)) {
                targetRegistry = new MockPermitBoundRegistryV1(
                    registry.REGISTRY_GENERATION(), registry.CHAIN_PROFILE_HASH(), address(authority)
                );
            }
            candidate = new MockPermitBoundConsumerRouteV1(
                authority,
                address(targetRegistry),
                routeId,
                profileId,
                keccak256(abi.encode("execution-authority", routeId)),
                IProgrammableLaunchPermitAuthorityV1.KernelEnvelopeModeV1.NONE
            );
            targetRegistry.grantWriter(address(candidate));
        }

        function _releaseFor(MockPermitBoundConsumerRouteV1 target, uint64 generation)
            internal
            view
            returns (IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory binding)
        {
            MockPermitBoundRegistryV1 targetRegistry = MockPermitBoundRegistryV1(target.REGISTRY());
            binding = IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1({
                authorityGeneration: authority.AUTHORITY_GENERATION(),
                releaseGeneration: generation,
                permitAuthority: address(authority),
                permitAuthorityRuntimeCodeHash: address(authority).codehash,
                launchRegistry: address(targetRegistry),
                launchRegistryGeneration: targetRegistry.REGISTRY_GENERATION(),
                launchRegistryRuntimeCodeHash: address(targetRegistry).codehash,
                chainProfileHash: targetRegistry.CHAIN_PROFILE_HASH(),
                profile: target.PROFILE(),
                profileId: target.PROFILE_ID(),
                profileRuntimeCodeHash: target.PROFILE().codehash,
                profileBindingHash: target.permitProfileBindingHash(),
                route: address(target),
                routeId: target.ROUTE_ID(),
                routeRuntimeCodeHash: address(target).codehash,
                executionAuthorityHash: target.EXECUTION_AUTHORITY_HASH(),
                kernelEnvelopeMode: target.KERNEL_MODE()
            });
        }

        function _permit(
            MockPermitBoundConsumerRouteV1 target,
            IProgrammableLaunchPermitAuthorityV1.ReleaseBindingV1 memory releaseBinding,
            uint64 repositoryId,
            uint64 permitGeneration,
            bytes32 launchId
        ) internal view returns (IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit) {
            bytes32 repositoryKey = authority.computeRepositoryKey(repositoryId);
            permit.githubRepositoryId = repositoryId;
            permit.approvalGeneration = 1;
            permit.permitGeneration = permitGeneration;
            permit.notBefore = uint64(block.timestamp);
            permit.deadline = uint64(block.timestamp + 300);
            permit.signerEpoch = authority.currentSignerEpoch();
            permit.nonce = authority.nextNonce(repositoryKey);
            permit.chainId = block.chainid;
            permit.repositoryKey = repositoryKey;
            permit.route = address(target);
            permit.routeId = target.ROUTE_ID();
            permit.applicantWallet = APPLICANT;
            permit.launchId = launchId;
            permit.approvalId = bytes32("approval-id");
            permit.technicalApprovalHash = keccak256("technical-approval");
            permit.descriptorHash = keccak256("descriptor");
            permit.presentationBindingHash = keccak256("presentation");
            permit.configurationHash = keccak256("configuration");
            permit.walletOwnershipBindingHash = keccak256("wallet-ownership");
            permit.executionPlanHash = keccak256("execution-plan");
            permit.executionCoreHash = keccak256(abi.encode("execution-core", launchId));
            permit.executionCalldataKeccak256 = keccak256(abi.encode("inner-calldata", launchId));
            permit.releaseBindingHash = authority.computeReleaseBindingHash(releaseBinding);
            permit.kernelExecutionEnvelopeHash = authority.computeKernelExecutionEnvelopeHash(emptyKernel);
            permit.generationBindingHash = authority.computeGenerationBindingHash(permit);
        }

        function _actual(IProgrammableLaunchPermitAuthorityV1.LaunchPermitV1 memory permit)
            internal
            pure
            returns (IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1 memory)
        {
            return IProgrammableLaunchPermitAuthorityV1.ActualExecutionV1({
                applicantWallet: permit.applicantWallet,
                executionCoreHash: permit.executionCoreHash,
                executionCalldataKeccak256: permit.executionCalldataKeccak256,
                executionValue: permit.executionValue
            });
        }

        function _sign(uint256 signerKey, bytes32 digest) internal pure returns (bytes memory) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
            return abi.encodePacked(r, s, v);
        }
    }
