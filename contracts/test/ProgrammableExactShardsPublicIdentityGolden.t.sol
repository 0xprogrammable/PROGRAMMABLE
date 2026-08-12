// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";

/// @dev Independent EVM consumer of contracts/spec/exact-shards-public-identity-golden.json.
///      The Website SHA-256 values are recomputed from literal canonical UTF-8 bytes, then bound
///      to the Registry's typed Keccak identity mapping without importing the JavaScript helper.
contract ProgrammableExactShardsPublicIdentityGoldenTest is Test {
    error PublicIdentityMappingMismatch(bytes32 actual, bytes32 expected);

    string private constant PROJECT_DOMAIN = "programmable.custom-launch-project-id.v2";
    string private constant PROJECT_CANONICAL_JSON =
        '{"grantBindingHash":"sha256:f34c6d9d683f81ac44f9966fcbd2529c036f94f261cbdd60245677f4e2e87ec8","grantId":"11111111-1111-4111-8111-111111111111","launchFamily":"custom"}';
    string private constant LAUNCH_DOMAIN = "programmable.custom-launch-id.v2";
    string private constant LAUNCH_CANONICAL_JSON =
        '{"chainId":"1","launchFamily":"custom","launchIdentity":{"namespace":"eip155:1:contract","value":"0xcccccccccccccccccccccccccccccccccccccccc"},"projectId":"sha256:e33d0fb2770fef54416133287dac2bc43bdb88a0391775b07ce19287039035c2"}';
    string private constant PUBLIC_IDENTITY_TYPE_STRING =
        "ExactShardsPublicIdentityBindingV1(bytes32 websiteProjectIdSha256,bytes32 websiteLaunchIdSha256,bytes32 registryProjectId,bytes32 registryApprovalId,bytes32 registryLaunchId,uint64 githubRepositoryId,uint64 approvalGeneration,uint256 chainId,address registry,uint64 registryGeneration,bytes32 routeId,address primaryContract)";

    bytes32 private constant WEBSITE_PROJECT_ID_SHA256 =
        0xe33d0fb2770fef54416133287dac2bc43bdb88a0391775b07ce19287039035c2;
    bytes32 private constant WEBSITE_LAUNCH_ID_SHA256 =
        0xb87d5eac727a56d93f9f53a8f02f54dc1a67b3bca2f00694ec46d1f83500cc26;
    bytes32 private constant PROJECT_ID_DOMAIN = 0x4fa0ae35da6b43ca2e5bd51635b32c072bcd2e4cfb9f65c03b1b6b6069e841b4;
    bytes32 private constant APPROVAL_ID_DOMAIN = 0x5e9f160793c808ca3f7bdcad892fda47ff40df23f6003434dfe04b04a4b94413;
    bytes32 private constant LAUNCH_ID_DOMAIN = 0x43422cb1e64441d3e905301f644720cc17c297817130fde0bbcf3318f8c97b52;
    bytes32 private constant REPOSITORY_KEY = 0x02ed38e86a7c41d5dea93cf5e3f829420837c4d351d9f4675929c6ce0041e835;
    bytes32 private constant TECHNICAL_APPROVAL_HASH =
        0x51117b520b79582e79c9152c7a7a9bf675fa64f5441c4d62e63a96e5fc768bc5;
    bytes32 private constant REGISTRY_PROJECT_ID = 0xb11d95a57cbb89efa14a7554610bcd18338125f7cccea1c5861dd0cf19665002;
    bytes32 private constant REGISTRY_APPROVAL_ID = 0x83a06f241ab7c70c53c5818506502a35a577534cecbcbe84d1d6638f225401e9;
    bytes32 private constant REGISTRY_LAUNCH_ID = 0xee922fb508355bd1b097d4588bdcee9b1a2929c62513e67b1afeaf81e670f497;
    bytes32 private constant ROUTE_ID = 0xe82ee94c42c7b2173be0d7915d887f813837a51b40af7fe20c1d2accb6f10db8;
    bytes32 private constant IDENTITY_MAPPING_HASH = 0xcbf79bbad2b430f2abab9daf294c77b370789d2061fc4df8faa7379e38362ac0;
    bytes32 private constant MUTATED_WEBSITE_LAUNCH_ID_SHA256 =
        0xb87d5eac727a56d93f9f53a8f02f54dc1a67b3bca2f00694ec46d1f83500cc27;
    bytes32 private constant MUTATED_IDENTITY_MAPPING_HASH =
        0x483d42cffc85c33b57e15efffb32a71c041ee8c3b62e09c084e84b9c57b54ad9;

    address private constant REGISTRY = 0x3000000000000000000000000000000000000003;
    address private constant PRIMARY_CONTRACT = 0x5000000000000000000000000000000000000005;

    function test_approvalCanonicalSha256ProjectAndLaunchIdsMatchLiteralBytes() public pure {
        bytes32 projectDigest = sha256(abi.encodePacked(PROJECT_DOMAIN, bytes1(0), PROJECT_CANONICAL_JSON));
        bytes32 launchDigest = sha256(abi.encodePacked(LAUNCH_DOMAIN, bytes1(0), LAUNCH_CANONICAL_JSON));

        assertEq(projectDigest, WEBSITE_PROJECT_ID_SHA256);
        assertEq(launchDigest, WEBSITE_LAUNCH_ID_SHA256);
    }

    function test_exactShardsIdentityMappingMatchesLiteralVector() public pure {
        assertEq(keccak256(abi.encode("programmable.github.repository.v1", uint256(1_329_073_878))), REPOSITORY_KEY);
        assertEq(keccak256(abi.encode(PROJECT_ID_DOMAIN, REPOSITORY_KEY)), REGISTRY_PROJECT_ID);
        assertEq(
            keccak256(
                abi.encode(
                    APPROVAL_ID_DOMAIN,
                    REGISTRY_PROJECT_ID,
                    uint64(4),
                    TECHNICAL_APPROVAL_HASH,
                    uint256(1),
                    REGISTRY,
                    uint64(3),
                    ROUTE_ID
                )
            ),
            REGISTRY_APPROVAL_ID
        );
        assertEq(keccak256(abi.encode(LAUNCH_ID_DOMAIN, REGISTRY_PROJECT_ID, REGISTRY_APPROVAL_ID)), REGISTRY_LAUNCH_ID);
        assertEq(
            keccak256(bytes(PUBLIC_IDENTITY_TYPE_STRING)),
            0x498832eeb344297e6fe6a4ca913f12e0905a46029de4db75a154328c57427b94
        );
        assertEq(_identityMappingHash(WEBSITE_PROJECT_ID_SHA256, WEBSITE_LAUNCH_ID_SHA256), IDENTITY_MAPPING_HASH);
    }

    function test_oneBitWebsiteLaunchIdMutationFailsClosed() public {
        bytes32 mutated = WEBSITE_LAUNCH_ID_SHA256 ^ bytes32(uint256(1));
        assertEq(mutated, MUTATED_WEBSITE_LAUNCH_ID_SHA256);
        assertEq(_identityMappingHash(WEBSITE_PROJECT_ID_SHA256, mutated), MUTATED_IDENTITY_MAPPING_HASH);
        assertNotEq(MUTATED_IDENTITY_MAPPING_HASH, IDENTITY_MAPPING_HASH);

        vm.expectPartialRevert(PublicIdentityMappingMismatch.selector);
        this.requireGoldenIdentityMapping(WEBSITE_PROJECT_ID_SHA256, mutated);
    }

    function requireGoldenIdentityMapping(bytes32 websiteProjectIdSha256, bytes32 websiteLaunchIdSha256)
        external
        pure
        returns (bytes32 actual)
    {
        actual = _identityMappingHash(websiteProjectIdSha256, websiteLaunchIdSha256);
        if (actual != IDENTITY_MAPPING_HASH) {
            revert PublicIdentityMappingMismatch(actual, IDENTITY_MAPPING_HASH);
        }
    }

    function _identityMappingHash(bytes32 websiteProjectIdSha256, bytes32 websiteLaunchIdSha256)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256(bytes(PUBLIC_IDENTITY_TYPE_STRING)),
                websiteProjectIdSha256,
                websiteLaunchIdSha256,
                REGISTRY_PROJECT_ID,
                REGISTRY_APPROVAL_ID,
                REGISTRY_LAUNCH_ID,
                uint64(1_329_073_878),
                uint64(4),
                uint256(1),
                REGISTRY,
                uint64(3),
                ROUTE_ID,
                PRIMARY_CONTRACT
            )
        );
    }
}
